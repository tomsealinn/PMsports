"""Goalserve Pregame (not-started) odds ingestion.

Polls the Goalserve pregame odds-comparison feed
(``getfeed/{key}/getodds/soccer?cat=soccer_10``) and projects every
*not-started* soccer match into the same ``OddsEvent`` / ``main_odds`` shape
the H5 frontend already consumes — so early-market cards render with no
frontend change.

Key facts (from the Goalserve docs + live probes)
--------------------------------------------------
* **getfeed requires a getfeed-enabled key.**  The private in-play key
  (``c74967…``) is *not* provisioned for getfeed (returns an ASP.NET page);
  the demo key works.  ``GS_GETFEED_KEY`` is configurable so it can be
  swapped for a dedicated production key without code changes.
* **Rate limit: 1 request / 10s per sport.**  We poll at
  ``GS_PREGAME_INTERVAL`` (default 12s) and back off on 429.
* **No started flag.**  The feed lists only not-started / cancelled
  statuses and never provides scores.  We compute kickoff from
  ``formatted_date`` + ``time`` (UTC) and *close betting at kickoff* — once
  a match starts it drops out of the pregame set (the in-play feed owns it).
* **gid == Goalserve id.**  We key each event by the pregame ``id``
  attribute (the id shared with the livescore + odds-comparison +
  inplay-mapping feeds).  ``static_id`` is kept alongside for cross-feed
  joins.
* Feed is GZIP-compressed XML; default query filters to bet365
  (``bm=16``) to keep each poll small and consistent with the in-play
  bet365 book.

Run standalone for systemd::

    python -m app.goalserve_pregame
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("goalserve_pregame")

# --------------------------------------------------------------------------
# Config
GS_GETFEED_KEY = os.environ.get("GS_GETFEED_KEY", "3416f409c2584c9e081c08debf8ab4bb")
GS_GETODDS_QUERY = os.environ.get("GS_GETODDS_QUERY", "cat=soccer_10&bm=16")
GS_GETODDS_URL = os.environ.get(
    "GS_GETODDS_URL",
    f"http://www.goalserve.com/getfeed/{GS_GETFEED_KEY}/getodds/soccer?{GS_GETODDS_QUERY}",
)
GS_PREGAME_DIR = Path(os.environ.get("GS_PREGAME_DIR", "/dev/shm/goalserve_pregame"))
GS_PREGAME_INTERVAL = float(os.environ.get("GS_PREGAME_INTERVAL", "15"))
GS_PREGAME_TIMEOUT = float(os.environ.get("GS_PREGAME_TIMEOUT", "40"))
GS_PREGAME_MAX_BACKOFF = float(os.environ.get("GS_PREGAME_MAX_BACKOFF", "60"))
# how long before kickoff betting stays open (0 = until kickoff)
GS_PREGAME_CLOSE_LEAD = float(os.environ.get("GS_PREGAME_CLOSE_LEAD", "0"))

# Goalserve livescore (results) feed — finalises PREGAME foot_match rows with
# the final score so pregame bets settle.  The pregame match leaves the
# getodds set at kickoff and the IN-PLAY feed owns it under a DIFFERENT id,
# so its 6.5M pregame row never gets a final score otherwise (see
# goalserve_dbwriter.finalize_results_from_livescore).  ``soccernew`` shares
# the getodds id space (gid == match id) so the writeback joins on gid.
GS_RESULTS_ENABLE = os.environ.get("GS_RESULTS_ENABLE", "1").strip().lower() not in ("0", "false", "no", "")
GS_RESULTS_BASE = os.environ.get(
    "GS_RESULTS_BASE",
    f"http://www.goalserve.com/getfeed/{GS_GETFEED_KEY}/soccernew",
)
GS_RESULTS_URL = os.environ.get("GS_RESULTS_URL", f"{GS_RESULTS_BASE}/home")
GS_RESULTS_INTERVAL = float(os.environ.get("GS_RESULTS_INTERVAL", "90"))
# Dated backstop feeds (yesterday / two days ago) sweep finals the live
# ``home`` feed may have already dropped; polled at a slower cadence.
GS_RESULTS_BACKFILL = [s.strip() for s in os.environ.get("GS_RESULTS_BACKFILL", "d-1,d-2").split(",") if s.strip()]
GS_RESULTS_BACKFILL_INTERVAL = float(os.environ.get("GS_RESULTS_BACKFILL_INTERVAL", "1800"))

# Preferred bookmaker order for the single-line main_odds projection.
_PREF_BM = [b.strip().lower() for b in os.environ.get("GS_PREGAME_PREF_BM", "bet365,bwin,pinnacle,1xbet").split(",")]

_TIME_RE = re.compile(r"^\d{1,2}:\d{2}$")


def _enabled() -> bool:
    return os.environ.get("GS_PREGAME_ENABLE", "1").strip().lower() not in ("0", "false", "no", "")


# Pregame market `value` (lowercased) -> canonical name consumed by
# external._main_odds_from_ws_snap().
PRE_CANON = {
    "match winner": "ML",
    "goals over/under": "Totals",
    "asian handicap": "Spread",
    "double chance": "Double Chance",
    "both teams to score": "Both Teams To Score",
    "draw no bet": "Draw No Bet",
    "halftime result": "Half Time Result",
    "half time result": "Half Time Result",
    "asian handicap first half": "Spread HT",
    "goals over/under first half": "Totals HT",
}

_INLINED = {
    "ML", "Spread", "Totals", "Draw No Bet", "Both Teams To Score",
    "Half Time Result", "Double Chance", "Spread HT", "Totals HT",
    "Corners Totals",
}


def _f(v) -> float:
    try:
        f = float(v)
        return f if f > 0 else 0.0
    except (TypeError, ValueError):
        return 0.0


def _stopped(el: "ET.Element | None") -> bool:
    return el is not None and str(el.get("stop")).lower() == "true"


def _pick_bookmaker(type_el: ET.Element) -> "ET.Element | None":
    """Choose one bookmaker for the single-line projection: preferred names
    first, skipping fully-suspended books when a live one exists."""
    bks = type_el.findall("bookmaker")
    if not bks:
        return None
    open_bks = [b for b in bks if not _stopped(b)]
    pool = open_bks or bks
    for pref in _PREF_BM:
        for b in pool:
            if (b.get("name") or "").strip().lower() == pref:
                return b
    return pool[0]


def _balance_score(ln: ET.Element) -> tuple:
    """Score a handicap/total line by how *balanced* its prices are.   The
    line whose two legs (home vs away, or over vs under) trade closest
    together is the "main" line a sharp book would post — pick'em or
    near-pick'em.   Lopsided lines (one leg at 1.02 and the other at
    10.0) are sharper-priced edge lines and must NOT be projected as
    the canonical main_odds.

    Returns a tuple sorted ascending by:
      1. |price_a - price_b|     (smaller = more balanced)
      2. max(price_a, price_b)   (tie-breaker: prefer flatter prices)
    Unusable lines (no opposing pair or both legs suspended → 0) get
    `inf` so they sort last.
    """
    pair: list[float] = []
    for o in ln.findall("odd"):
        nm = (o.get("name") or "").strip().lower()
        if nm in ("home", "away", "over", "under"):
            p = _f(o.get("value"))
            if p > 0:
                pair.append(p)
    if len(pair) < 2:
        return (float("inf"), float("inf"))
    pair.sort()
    return (pair[-1] - pair[0], pair[-1])


def _main_line(bk: ET.Element, child_tag: str) -> "ET.Element | None":
    """Pick the most price-balanced handicap/total line.

    Previously this trusted ``ismain="True"``, which Goalserve sometimes
    tags on lopsided edge lines (e.g. HT spread -1 @ 3.55/1.27 for a
    match where the balanced HT line is -0.5 @ 1.98/1.88).   The new
    rule is: among all *open* lines (or every line if all are stopped),
    pick the one with the smallest gap between its two opposing prices.
    See `_balance_score`.   `ismain` is now used only as a tie-breaker.
    """
    lines = bk.findall(child_tag)
    if not lines:
        return None
    open_lines = [ln for ln in lines if not _stopped(ln)] or lines
    # Tag each line with (balance, ismain-priority).   We sort by
    # balance ASC, then by ismain DESC (so ismain wins identical bal).
    def key(ln):
        bal = _balance_score(ln)
        ismain = 0 if str(ln.get("ismain")).lower() == "true" else 1
        return (bal[0], ismain, bal[1])
    open_lines.sort(key=key)
    return open_lines[0]


def _odds_map(container: ET.Element) -> "dict[str, ET.Element]":
    out: "dict[str, ET.Element]" = {}
    for o in container.findall("odd"):
        nm = (o.get("name") or "").strip().lower()
        if nm and nm not in out:
            out[nm] = o
    return out


def _price(o: "ET.Element | None", parent_stop: bool) -> float:
    if o is None:
        return 0.0
    if parent_stop or _stopped(o):
        return 0.0
    return _f(o.get("value"))


def _canon_row(canon: str, type_el: ET.Element, bk: ET.Element) -> "list[dict]":
    type_stop = _stopped(type_el)
    bk_stop = _stopped(bk) or type_stop

    if canon in ("ML",):
        om = _odds_map(bk)
        return [{
            "home": _price(om.get("home"), bk_stop),
            "draw": _price(om.get("draw"), bk_stop),
            "away": _price(om.get("away"), bk_stop),
        }]

    if canon == "Half Time Result":
        om = _odds_map(bk)
        return [
            {"home": _price(om.get("home"), bk_stop)},
            {"draw": _price(om.get("draw"), bk_stop)},
            {"away": _price(om.get("away"), bk_stop)},
        ]

    if canon in ("Spread", "Spread HT"):
        ln = _main_line(bk, "handicap")
        if ln is None:
            return []
        om = _odds_map(ln)
        ln_stop = bk_stop or _stopped(ln)
        try:
            hdp = float(str(ln.get("name")).replace("+", ""))
        except (TypeError, ValueError):
            hdp = ln.get("name") or 0
        return [{
            "home": _price(om.get("home"), ln_stop),
            "away": _price(om.get("away"), ln_stop),
            "hdp": hdp,
        }]

    if canon in ("Totals", "Totals HT", "Corners Totals"):
        ln = _main_line(bk, "total")
        if ln is None:
            return []
        om = _odds_map(ln)
        ln_stop = bk_stop or _stopped(ln)
        return [{
            "over": _price(om.get("over"), ln_stop),
            "under": _price(om.get("under"), ln_stop),
            "hdp": _f(ln.get("name")),
        }]

    if canon == "Draw No Bet":
        om = _odds_map(bk)
        return [{"home": _price(om.get("home"), bk_stop), "away": _price(om.get("away"), bk_stop)}]

    if canon == "Both Teams To Score":
        om = _odds_map(bk)
        return [{"yes": _price(om.get("yes"), bk_stop), "no": _price(om.get("no"), bk_stop)}]

    if canon == "Double Chance":
        rows = []
        for o in bk.findall("odd"):
            # "Home/Draw" -> "Home or Draw" so _main_odds_from_ws_snap matches
            label = (o.get("name") or "").replace("/", " or ")
            rows.append({"label": label, "under": _price(o, bk_stop)})
        return rows

    return []


def _passthrough_market(type_el: ET.Element, bk: ET.Element) -> dict:
    type_stop = _stopped(type_el) or _stopped(bk)
    odds = []
    # handle total/handicap children or flat odds
    containers = bk.findall("total") or bk.findall("handicap") or [bk]
    for c in containers:
        line = c.get("name") if c.tag in ("total", "handicap") else None
        for o in c.findall("odd"):
            row = {"selection": o.get("name"), "price": _price(o, type_stop or _stopped(c))}
            if line is not None:
                row["line"] = line
            odds.append(row)
    try:
        mid_int = int(type_el.get("id"))
    except (TypeError, ValueError):
        mid_int = 0
    return {
        "market_id": str(type_el.get("id") or "").zfill(6),
        "market_id_int": mid_int,
        "market_name": type_el.get("value") or str(type_el.get("id")),
        "odds": odds,
        "updated_at_iso": None,
        "updated_at_ts": int(bk.get("ts")) if (bk.get("ts") or "").isdigit() else None,
    }


def _kickoff_ts(match_el: ET.Element, default_date: "str | None") -> "int | None":
    fd = match_el.get("formatted_date") or default_date
    tm = match_el.get("time") or match_el.get("status")
    if not fd or not tm or not _TIME_RE.match(tm.strip()):
        return None
    try:
        dt = datetime.strptime(f"{fd.strip()} {tm.strip()}", "%d.%m.%Y %H:%M")
        return int(dt.replace(tzinfo=timezone.utc).timestamp())
    except ValueError:
        return None


def _iso(ts: "int | None") -> "str | None":
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    except (ValueError, OSError):
        return None


def normalize_match(cat: ET.Element, match_el: ET.Element, default_date: "str | None", now: int) -> "dict | None":
    status = (match_el.get("status") or "").strip()
    # only not-started (status is a HH:mm time); skip FT/Postp./Cancl./etc.
    if not _TIME_RE.match(status):
        return None
    kickoff = _kickoff_ts(match_el, default_date)
    if kickoff is None:
        return None
    # close betting at kickoff (minus optional lead)
    if now >= kickoff - GS_PREGAME_CLOSE_LEAD:
        return None

    try:
        ev_id = int(match_el.get("id"))
    except (TypeError, ValueError):
        return None

    lt = match_el.find("localteam")
    vt = match_el.find("visitorteam")
    home = lt.get("name") if lt is not None else None
    away = vt.get("name") if vt is not None else None
    # Goalserve numeric team ids — exposed for the /logos endpoint.
    # XML attribute is sometimes blank for unknown opponents; coerce
    # blank/non-int to None so callers don't have to special-case.
    def _int_or_none(v):
        try: return int(v) if v not in (None, "") else None
        except (TypeError, ValueError): return None
    home_gs_id = _int_or_none(lt.get("id")) if lt is not None else None
    away_gs_id = _int_or_none(vt.get("id")) if vt is not None else None

    # Side-effect: push (id, name) pairs into the team_directory.  The
    # pregame XML is THE most reliable source of Goalserve numeric team
    # IDs we have (the inplay-soccer.gz JSON doesn't expose them).  Every
    # 15s poll cycle therefore refreshes the directory for every event
    # with prematch odds — many thousands of teams over a day.   Wrapped
    # in try so a directory hiccup never breaks the snap pipeline.
    try:
        from . import goalserve_team_directory as _td
        _td.upsert_inline(
            teams=[(home_gs_id, home), (away_gs_id, away)],
            league_id=_int_or_none(cat.get("id")) if cat is not None else None,
            league_name=(cat.get("name") or None) if cat is not None else None,
        )
    except Exception:  # noqa: BLE001
        pass

    league_name = cat.get("name")

    canon_markets: "list[dict]" = []
    bookmaker_markets: "list[dict]" = []
    extra: "list[dict]" = []
    for t in match_el.findall(".//type"):
        bk = _pick_bookmaker(t)
        if bk is None:
            continue
        canon = PRE_CANON.get((t.get("value") or "").strip().lower())
        if canon:
            row = _canon_row(canon, t, bk)
            if row:
                canon_markets.append({"name": canon, "odds": row})
        bookmaker_markets.append(_passthrough_market(t, bk))
        nm = t.get("value") or canon or str(t.get("id"))
        if (canon or nm) not in _INLINED:
            extra.append({"name": nm, "outcomes": len(t.findall(".//odd"))})

    from .routers.external import _main_odds_from_ws_snap
    mo = _main_odds_from_ws_snap({"markets": canon_markets})
    if not (mo and any(mo.values())):
        mo = None

    return {
        "id": ev_id,
        "sport_slug": "soccer",
        "league_slug": str(cat.get("id") or ""),
        "league_name": league_name,
        "league_cn": None, "home_cn": None, "away_cn": None,
        "home": home, "away": away,
        "home_id": home, "away_id": away,
        "home_team_gs_id": home_gs_id,
        "away_team_gs_id": away_gs_id,
        "commence_iso": _iso(kickoff),
        "commence_ts": kickoff,
        "status": "pending",
        "score_home": None, "score_away": None,
        "is_finished": False,
        "fetched_at": now,
        "market_count": len(bookmaker_markets),
        "apisports_fixture_id": None,
        "apisports_match_iso": None,
        "elapsed_minute": None,
        "status_short": None,
        "main_odds": mo,
        "extra_markets": extra,
        "_markets": bookmaker_markets,
        "_bm": (_PREF_BM[0] if _PREF_BM else "bet365"),
        "_gs": {
            "static_id": match_el.get("static_id"),
            "gid_cat": cat.get("gid"),
            "venue": match_el.get("venue"),
        },
        "_updated_ts": now,
    }


# --------------------------------------------------------------------------
# Read helpers (used by the router)
def read_event_full(gid: int) -> "dict | None":
    import json
    p = GS_PREGAME_DIR / f"{int(gid)}.json"
    try:
        with p.open("rb") as fh:
            return json.load(fh)
    except (FileNotFoundError, ValueError, OSError):
        return None


def list_events() -> "list[dict]":
    import json
    out: "list[dict]" = []
    try:
        files = list(GS_PREGAME_DIR.glob("*.json"))
    except OSError:
        return out
    now = time.time()
    for f in files:
        if f.name.startswith("_"):
            continue
        try:
            with f.open("rb") as fh:
                snap = json.load(fh)
        except (ValueError, OSError):
            continue
        # safety: hide anything past kickoff even if pruning lagged
        if snap.get("commence_ts") and now >= snap["commence_ts"]:
            continue
        out.append({k: v for k, v in snap.items() if not k.startswith("_")})
    out.sort(key=lambda e: (e.get("commence_ts") or 0, e.get("id") or 0))
    return out


class RateLimited(Exception):
    pass


class GoalservePregamePoller:
    def __init__(self) -> None:
        self._task: "asyncio.Task | None" = None
        self._stop = False
        self._backoff = 0.0
        self.last_ok_ts: "float | None" = None
        self.last_event_count = 0
        self._last_results_ts = 0.0
        self._last_backfill_ts = 0.0
        self.last_results: "dict | None" = None

    def _fetch_url(self, url: str) -> bytes:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "pm-sports-goalserve/1.0", "Accept-Encoding": "gzip"},
        )
        try:
            with urllib.request.urlopen(req, timeout=GS_PREGAME_TIMEOUT) as resp:
                raw = resp.read()
                if (resp.headers.get("Content-Encoding") or "").lower() == "gzip":
                    import gzip
                    raw = gzip.decompress(raw)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500):
                raise RateLimited(f"HTTP {e.code}")
            raise
        # gzip magic even if header missing
        if raw[:2] == b"\x1f\x8b":
            import gzip
            raw = gzip.decompress(raw)
        if raw[:200].lstrip().lower().startswith(b"<!doctype html") or b"Too Many Requests" in raw[:300]:
            raise RateLimited("challenge/429 page")
        return raw

    def _fetch(self) -> bytes:
        return self._fetch_url(GS_GETODDS_URL)

    def _finalize_results(self, xml_bytes: bytes) -> dict:
        from . import goalserve_dbwriter as _gw
        return _gw.finalize_results_from_livescore(xml_bytes)

    async def _maybe_finalize_results(self) -> None:
        """Periodically pull the Goalserve livescore feed and write final
        scores back onto pregame foot_match rows so pregame bets settle.

        Runs inside the pregame loop (no separate task) at
        ``GS_RESULTS_INTERVAL``; the dated ``soccernew/d-N`` backstops run at
        ``GS_RESULTS_BACKFILL_INTERVAL``.  No-op unless GS_DB_WRITE is on."""
        nowt = time.time()
        if (nowt - self._last_results_ts) < GS_RESULTS_INTERVAL:
            return
        # Skip the network round-trip entirely when DB writes are off.
        try:
            from . import goalserve_dbwriter as _gw
            if not _gw.GS_DB_WRITE:
                self._last_results_ts = nowt
                return
        except Exception:  # noqa: BLE001
            return
        self._last_results_ts = nowt
        # Primary: today's live + finished matches.
        try:
            rb = await asyncio.to_thread(self._fetch_url, GS_RESULTS_URL)
            res = await asyncio.to_thread(self._finalize_results, rb)
            self.last_results = res
            if res.get("finalized") or res.get("errors"):
                log.info("results finalize home: %s", res)
        except RateLimited as e:
            log.warning("results fetch rate-limited: %s", e)
            return
        except Exception as e:  # noqa: BLE001
            log.warning("results fetch/finalize failed: %s", e)
            return
        # Backstop: dated feeds catch finals the live feed already dropped.
        if GS_RESULTS_BACKFILL and (nowt - self._last_backfill_ts) >= GS_RESULTS_BACKFILL_INTERVAL:
            self._last_backfill_ts = nowt
            for suffix in GS_RESULTS_BACKFILL:
                url = f"{GS_RESULTS_BASE}/{suffix}"
                try:
                    rb = await asyncio.to_thread(self._fetch_url, url)
                    res = await asyncio.to_thread(self._finalize_results, rb)
                    if res.get("finalized"):
                        log.info("results finalize %s: %s", suffix, res)
                except Exception as e:  # noqa: BLE001
                    log.warning("results backfill %s failed: %s", suffix, e)

    def _ensure_dir(self) -> None:
        try:
            GS_PREGAME_DIR.mkdir(parents=True, exist_ok=True)
            os.chmod(GS_PREGAME_DIR, 0o775)
        except OSError:
            pass

    def _write_snapshot(self, xml_bytes: bytes) -> int:
        import json
        self._ensure_dir()
        try:
            root = ET.fromstring(xml_bytes)
        except ET.ParseError as e:
            log.warning("xml parse failed: %s", e)
            return 0
        now = int(time.time())
        seen: "set[str]" = set()
        for cat in root.findall(".//category"):
            for matches_el in cat.findall("matches"):
                default_date = matches_el.get("formatted_date")
                for match_el in matches_el.findall("match"):
                    snap = normalize_match(cat, match_el, default_date, now)
                    if not snap:
                        continue
                    fid = str(snap["id"])
                    seen.add(fid)
                    tmp = GS_PREGAME_DIR / f".{fid}.json.tmp"
                    dst = GS_PREGAME_DIR / f"{fid}.json"
                    try:
                        with tmp.open("w", encoding="utf-8") as fh:
                            json.dump(snap, fh, ensure_ascii=False, separators=(",", ":"))
                        os.replace(tmp, dst)
                    except OSError as e:
                        log.warning("write %s failed: %s", dst, e)
                        continue
                    # Optional DB hook — GS_DB_WRITE-gated foot_match upsert
                    try:
                        from . import goalserve_dbwriter as _gw
                        if _gw.GS_DB_WRITE:
                            _gw.upsert_event(snap)
                    except Exception as e:  # noqa: BLE001
                        log.warning("dbwriter upsert %s failed: %s", fid, e)
            # some feeds nest match directly under category
            for match_el in cat.findall("match"):
                snap = normalize_match(cat, match_el, cat.get("formatted_date"), now)
                if not snap:
                    continue
                fid = str(snap["id"])
                seen.add(fid)
                dst = GS_PREGAME_DIR / f"{fid}.json"
                tmp = GS_PREGAME_DIR / f".{fid}.json.tmp"
                try:
                    with tmp.open("w", encoding="utf-8") as fh:
                        json.dump(snap, fh, ensure_ascii=False, separators=(",", ":"))
                    os.replace(tmp, dst)
                except OSError:
                    continue
                try:
                    from . import goalserve_dbwriter as _gw
                    if _gw.GS_DB_WRITE:
                        _gw.upsert_event(snap)
                except Exception as e:  # noqa: BLE001
                    log.warning("dbwriter upsert %s failed: %s", fid, e)
        # prune everything not seen this cycle (started / dropped / settled)
        for f in GS_PREGAME_DIR.glob("*.json"):
            if f.name.startswith("_") or f.stem in seen:
                continue
            try:
                f.unlink()
            except OSError:
                pass
        try:
            itmp = GS_PREGAME_DIR / "._index.json.tmp"
            with itmp.open("w", encoding="utf-8") as fh:
                json.dump({"updated_ts": now, "count": len(seen),
                           "ts": root.get("ts")}, fh)
            os.replace(itmp, GS_PREGAME_DIR / "_index.json")
        except OSError:
            pass
        return len(seen)

    async def _run(self) -> None:
        log.info("goalserve pregame poller starting url=%s interval=%.1fs dir=%s",
                 GS_GETODDS_URL, GS_PREGAME_INTERVAL, GS_PREGAME_DIR)
        while not self._stop:
            try:
                xml_bytes = await asyncio.to_thread(self._fetch)
            except RateLimited as e:
                self._backoff = min(GS_PREGAME_MAX_BACKOFF,
                                    max(GS_PREGAME_INTERVAL * 1.5, (self._backoff or GS_PREGAME_INTERVAL) * 1.5))
                log.warning("rate-limited (%s) — backing off %.1fs", e, self._backoff)
                await asyncio.sleep(self._backoff)
                continue
            except Exception as e:  # noqa: BLE001
                log.warning("fetch failed: %s", e)
                await asyncio.sleep(GS_PREGAME_INTERVAL)
                continue
            self._backoff = 0.0
            try:
                n = await asyncio.to_thread(self._write_snapshot, xml_bytes)
                self.last_ok_ts = time.time()
                self.last_event_count = n
                log.info("pregame snapshot: %d not-started events", n)
            except Exception as e:  # noqa: BLE001
                log.warning("write_snapshot failed: %s", e)
            # Pregame settlement writeback (interval-gated inside).
            if GS_RESULTS_ENABLE:
                await self._maybe_finalize_results()
            await asyncio.sleep(GS_PREGAME_INTERVAL)
        log.info("goalserve pregame poller stopped")

    async def start(self) -> None:
        if self._task is None:
            self._stop = False
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stop = True
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._task = None

    async def run_forever(self) -> None:
        await self._run()


def build_from_env() -> "GoalservePregamePoller | None":
    if not _enabled():
        log.info("goalserve pregame poller disabled (GS_PREGAME_ENABLE=0)")
        return None
    return GoalservePregamePoller()


def main() -> None:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        asyncio.run(GoalservePregamePoller().run_forever())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
