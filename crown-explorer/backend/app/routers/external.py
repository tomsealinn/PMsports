"""GET /api/external/* — read-only views over data/oddsapi.sqlite.

Populated by ``scripts/ingest_oddsapi.py`` (which calls odds-api.io). The
shape is deliberately kept distinct from /api/matches (Crown bet ledger
aggregations) so frontends can mix-and-match the two sources without ID
collisions:

    /api/matches/...               match_id  = Crown gnum_h (int as text)
    /api/external/events/...       event_id  = odds-api.io upstream id (int)

Endpoints:
    GET /api/external/leagues
    GET /api/external/events
    GET /api/external/events/{event_id}
    GET /api/external/events/{event_id}/markets
"""
from __future__ import annotations

import asyncio
import html as _html
import json
import logging
import re
import time
import unicodedata as _unicodedata
from contextlib import suppress

from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect

# Added by logo/inplay-events patch.
import hashlib as _logo_hashlib
import shutil as _logo_shutil
import time as _logo_time
import os as _logo_os
import urllib.error as _logo_urlerr
import urllib.request as _logo_urlreq
from pathlib import Path as _logo_Path
from fastapi.responses import FileResponse as _logo_FileResponse, Response as _logo_Response

# After the 2026-05-24 "PHP cron 主、Python cron 退阶" migration the
# /events, /events/{id}, /events/{id}/markets, and /leagues endpoints
# read directly from Crown's MySQL ``db_sports`` schema instead of
# ``oddsapi.sqlite``.  The legacy ``oddsdb`` (sqlite) module is no
# longer imported — see ``mysqldb`` for the connection layer and
# ``rcn_parser`` for the Python port of api_v2.php::parseRcnMarkets().
from .. import mysqldb
from .. import goalserve_inplay as _gs_live
from .. import goalserve_pregame as _gs_pre
from ..rcn_parser import parse_rcn_markets

# When on, Goalserve in-play + pregame events (keyed by Goalserve id) are
# merged into the /events list and resolvable via /events/{id}[/markets] as a
# fallback when the gid isn't in foot_match. Display-only — betting/settlement
# of these ids is a separate (foot_match + settlement) integration. Disable
# with INCLUDE_GOALSERVE=0 + restart.
import os as _gs_os
_INCLUDE_GS = _gs_os.environ.get("INCLUDE_GOALSERVE", "1").strip().lower() not in ("0", "false", "no", "")


def _esports_exclude_sql(prefix: str = "") -> str:
    """SQL predicate that excludes esports / simulated-football rows by league
    name — goalserve's English "Esoccer Battle / GT Leagues / … mins play" AND
    Crown's Chinese "电竞足球-…" — plus the "(Handle) Esports" team names.
    Shared by the events list, the league catalog and the daily-count
    aggregations so esports never surface anywhere on the real-football board.
    """
    p = prefix
    # NB: doubled %% — these SQL strings are run through pymysql's
    # ``query % params`` formatter, so a literal % must be escaped or it's
    # mistaken for a %s placeholder (→ "must be real number, not str").
    return (
        f"{p}league NOT REGEXP 'e-?soccer|e-?football|esports?|电竞|电子竞技' "
        f"AND {p}team_h NOT LIKE '%%Esports%%' AND {p}team_c NOT LIKE '%%Esports%%'"
    )


# --- Goalserve pregame↔in-play dedup (2026-06-05) --------------------------
# Goalserve exposes the SAME real fixture under two feeds that share no stable
# id: the pregame feed (small 7-digit gid, lid like 802026) and the in-play
# feed (big ~1.34e8 gid, lid like 800438).  Both land in foot_match, so the
# same match shows up twice on the board with divergent odds.  We collapse
# them at the display layer keyed on (normalized home, normalized away,
# EXACT kickoff ts).  Requiring an identical kickoff ts is the safety guard:
# it prevents merging genuinely different fixtures that share a club name
# (e.g. a senior game vs its reserves match at a different time).  Two clubs
# cannot kick off two matches simultaneously, so same-teams+same-ts is the
# same real match.  Within a duplicate group we keep the in-play copy when the
# match is live, otherwise the copy that actually carries odds.
_TEAM_SUFFIX_RE = re.compile(
    r"\b(fc|sc|cf|afc|ec|sk|fk|if|ik|ac|cd|ca|sv|cska|utd|united|club|"
    r"reserves?|res|team|the)\b"
)


def _norm_match_team(name: "str | None") -> str:
    s = _html.unescape(str(name or ""))
    s = _unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = s.lower()
    s = _TEAM_SUFFIX_RE.sub(" ", s)
    return re.sub(r"[^a-z0-9]", "", s)


_DEDUP_LIVE_WINDOW_SEC = 12 * 3600


def _dedup_same_match(items: "list[dict]") -> "list[dict]":
    """Collapse Goalserve pregame↔in-play duplicates of the same real match.

    The two feeds share no stable id, so we match on normalized team names.
    Two safety guards prevent merging genuinely different fixtures (e.g. a
    senior game vs its reserves match, or a future rematch of the same teams):

    * Phase 1 — events that carry a kickoff ts are grouped on
      (home, away, EXACT ts).  Two clubs cannot kick off two matches at the
      same instant, so an exact ts match is always the same real match.
    * Phase 2 — a LIVE (in-play) event reports ``commence_ts == 0`` (Goalserve's
      in-play frames drop the scheduled kickoff), so it can't key on ts.  We
      let it supersede a same-team pre-match/settled copy ONLY when that copy's
      kickoff is within ``_DEDUP_LIVE_WINDOW_SEC`` of now — a future rematch
      sits far outside that window and is left as its own row.

    Within a group the live copy wins; otherwise the copy that carries odds
    (in-play-feed gid as the final tiebreak).
    """
    def has_odds(e: dict) -> bool:
        mo = e.get("main_odds")
        return isinstance(mo, dict) and any(mo.values())

    def is_live(e: dict) -> bool:
        return (e.get("status") or "").lower() in ("inplay", "live")

    def rank(e: dict) -> tuple:
        return (1 if is_live(e) else 0, 1 if has_odds(e) else 0, int(e.get("id") or 0))

    now = time.time()
    best: "dict[tuple, dict]" = {}
    order: "list[tuple]" = []
    live_no_ts: "list[dict]" = []
    passthrough: "list[dict]" = []
    # Phase 1
    for e in items:
        h = _norm_match_team(e.get("home"))
        a = _norm_match_team(e.get("away"))
        ts = int(e.get("commence_ts") or 0)
        if not h or not a:
            passthrough.append(e)
            continue
        if is_live(e) and not ts:
            live_no_ts.append(e)
            continue
        key = (h, a, ts)
        cur = best.get(key)
        if cur is None:
            best[key] = e
            order.append(key)
        elif rank(e) > rank(cur):
            best[key] = e
    # Phase 2 — attach ts-less live events.
    for e in live_no_ts:
        h = _norm_match_team(e.get("home"))
        a = _norm_match_team(e.get("away"))
        cand = [
            k for k in order
            if k[0] == h and k[1] == a and abs(k[2] - now) <= _DEDUP_LIVE_WINDOW_SEC
        ]
        if cand:
            # Live event supersedes the nearest-kickoff pre-match/settled copy.
            best[min(cand, key=lambda kk: abs(kk[2] - now))] = e
        else:
            kk = (h, a, -1)
            if kk not in best:
                best[kk] = e
                order.append(kk)
    out = [best[k] for k in order] + passthrough
    return out


def _goalserve_merge_list(status, only_active, q, min_ts, max_ts) -> list[dict]:
    if not _INCLUDE_GS:
        return []
    try:
        evs = _gs_live.list_events() + _gs_pre.list_events()
    except Exception:  # noqa: BLE001 — never let GS break the core list
        return []
    wanted = None
    if only_active:
        wanted = {"pending", "inplay"}
    elif status:
        s = status.lower()
        if s in ("live", "inplay"):
            wanted = {"inplay"}
        elif s in ("pending", "pre", "early", "soon", "today", "hot"):
            wanted = {"pending"}
        elif s in ("settled", "finished", "cancelled"):
            wanted = {"finished"}
    from ..goalserve_dbwriter import is_esports_league
    out = []
    for e in evs:
        # Hide esports / simulated-football leagues everywhere.
        if is_esports_league(e.get("league_name")):
            continue
        if wanted is not None and e.get("status") not in wanted:
            continue
        ts = e.get("commence_ts") or 0
        if min_ts is not None and ts < min_ts:
            continue
        if max_ts is not None and ts > max_ts:
            continue
        if q:
            ql = q.lower()
            if (ql not in (e.get("home") or "").lower()
                    and ql not in (e.get("away") or "").lower()
                    and ql not in (e.get("league_name") or "").lower()):
                continue
        # Pregame book closes GS_PREGAME_CLOSE_LEAD_SEC before kickoff:
        # drop pregame snapshots once inside that window so they don't show
        # alongside (or instead of) the independent in-play card that the
        # WS feed creates under a different gid.
        if e.get("status") == "pending" and _pregame_closed(e.get("commence_ts")):
            continue
        out.append(e)
    return out


def _goalserve_event_full(event_id: int) -> "dict | None":
    if not _INCLUDE_GS:
        return None
    try:
        return _gs_live.read_event_full(event_id) or _gs_pre.read_event_full(event_id)
    except Exception:  # noqa: BLE001
        return None

def _normalise_event(row: "dict") -> None:
    """Mutate `row` in place so the H5 frontend always sees a consistent
    `is_finished` flag + the half-time score placeholders.

    The status text itself is set authoritatively by
    ``mysqldb.derive_status`` (which already applies the LIVE_WINDOW
    cron-lag heuristic before we get here), so this helper no longer
    second-guesses it — the previous status-promotion block was dead
    code, because by the time we run, `status` is already either
    "settled"/"inplay"/"pending" with the same LIVE_WINDOW logic baked
    in.  See ``mysqldb.is_inplay_event`` for the canonical in-play
    predicate.
    """
    raw = (row.get("status") or "").lower()
    row["is_finished"] = (raw == "settled")
    # Half-time scores aren't stored in our sqlite snapshot today; keep
    # the keys present so the H5 OddsEvent typedef stays satisfied.
    row.setdefault("score_home_ht", None)
    row.setdefault("score_away_ht", None)

log = logging.getLogger("external")
router = APIRouter()


# ---------------------------------------------------------------------------
# main_odds helpers — extract key market values for the list-card display.

_KEY_MARKETS = (
    "Spread", "ML", "Totals",
    "Both Teams To Score", "Both Teams to Score",
    "Half Time Result",
    "Spread HT", "Totals HT",
    "Both Teams To Score HT", "Both Teams to Score HT",
    "Double Chance", "Draw No Bet",
    # Corners — `Corners Totals` is the main over/under line. Frontend
    # consumes it as corners_over / corners_line / corners_under; without
    # this entry the 主要玩法 row hides the corner column entirely.
    "Corners Totals",
)

# Markets that share the structured key columns above. Used to compute the
# "+N 更多盘口" badge by excluding them from the extras-counter.
_INLINED_MARKETS = frozenset(_KEY_MARKETS)

# Shared with the FastAPI WS bridge (oddsapi_ws.py) and the PHP api_v2.php
# in-play handler.  When a match is in-play (status=inplay/live) we
# *strictly* serve `main_odds` and bookmakers from this directory rather
# than from oddsapi.sqlite.  The SQLite snapshot accumulates pre-match
# prices that don't get superseded the moment a match goes live, which
# would let stale numbers leak into the 滚球 view and worse, into bets.
import os as _os
import pathlib as _pathlib
# Goalserve tmpfs snap dirs.   Live + pregame poll loops in goalserve_*.py
# write one JSON per gid here every ~3-5s.   The snap's ``_markets`` array is
# the canonical multi-line book (every Asian Handicap / Goal Line option).
GS_LIVE_SHM_DIR    = _pathlib.Path(_os.environ.get("GS_LIVE_SHM_DIR")    or "/dev/shm/goalserve_live")
GS_PREGAME_SHM_DIR = _pathlib.Path(_os.environ.get("GS_PREGAME_SHM_DIR") or "/dev/shm/goalserve_pregame")
GS_SHM_STALE_AFTER_SEC = int(_os.environ.get("GS_SHM_STALE_AFTER_SEC") or 300)

# Goalserve competition-id base (mirrors goalserve_dbwriter.GS_LID_BASE).
# foot_match rows whose lid is at/above this came from a Goalserve feed —
# the only rows the pregame→inplay time-cutoff applies to (Crown-native
# rows keep the legacy `is_inplay_event` predicate).
_GS_LID_BASE = int(_os.environ.get("GS_LID_BASE") or 800000)
# Pregame book closes this many seconds before kickoff.  From kickoff −
# this lead onward, a Goalserve row's pre-match prices are no longer
# served or bookable; the live match resurfaces independently under its
# own in-play gid the moment the WS pushes a live snapshot.  This is the
# name-free decoupling of pregame vs in-play (the two never share a gid).
GS_PREGAME_CLOSE_LEAD_SEC = int(_os.environ.get("GS_PREGAME_CLOSE_LEAD_SEC") or 120)

# Back-compat alias — older code paths still spell it WS_SHM_CACHE_DIR.
WS_SHM_CACHE_DIR     = GS_LIVE_SHM_DIR
WS_CACHE_STALE_AFTER_SEC = GS_SHM_STALE_AFTER_SEC


def _load_full_market_book(event_id: int) -> list[dict]:
    """Read the goalserve snap's ``_markets`` array and project it into the
    canonical market-list shape used by ``parse_rcn_markets``.   Tries live
    first (in-play match) then pregame; returns ``[]`` when neither snap
    exists or is older than ``GS_SHM_STALE_AFTER_SEC``.

    This replaces the legacy ``_load_limitless_markets()`` which read the
    ``ingest_limitless.php`` cron output from ``/dev/shm/crown_limitless_mk``.
    Goalserve carries the same multi-line book under a different field name,
    so the projection below is a 1:1 rename (``selection`` / ``price`` /
    ``line`` keys stay identical) — downstream callers need no changes.
    """
    snap = None
    src_mtime: float | None = None
    for d in (GS_LIVE_SHM_DIR, GS_PREGAME_SHM_DIR):
        f = d / f"{event_id}.json"
        try:
            st = f.stat()
        except OSError:
            continue
        if (time.time() - st.st_mtime) > GS_SHM_STALE_AFTER_SEC:
            continue
        try:
            snap = json.loads(f.read_text(encoding="utf-8"))
            src_mtime = st.st_mtime
            break
        except (OSError, ValueError):
            continue
    if snap is None:
        return []
    raw_markets = snap.get("_markets") or snap.get("markets") or []
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(src_mtime or time.time()))
    now_ts = int(src_mtime or time.time())
    out: list[dict] = []
    for i, m in enumerate(raw_markets or [], start=1):
        if not isinstance(m, dict):
            continue
        name = m.get("market_name") or m.get("name")
        if not name:
            continue
        out.append({
            "market_id":      m.get("market_id") or f"{i:06d}",
            "market_id_int":  int(m.get("market_id_int") or i),
            "name":           name,
            "market_name":    name,
            "odds":           m.get("odds") or [],
            "updated_at_iso": m.get("updated_at_iso") or now_iso,
            "updated_at_ts":  int(m.get("updated_at_ts") or now_ts),
        })
    return out


# ---------------------------------------------------------------------------
# Model B — in-play Asian-Handicap neighbour synthesis.
#
# Goalserve's live feed carries a SINGLE handicap line per tick, so the 让球
# card shows just one rung (e.g. -0.25).  To present the conventional 3-line
# ladder (live ±0.25) we synthesise the two neighbours from the live prices
# using a FIXED empirical step table (no probability model), then floor the
# result to the odds ladder so synthetic prices are always house-favourable.
# The transform is deterministic, so the PHP validator (which re-fetches this
# same endpoint) reproduces identical neighbour prices and the bet validates /
# settles through the existing Spread (SP) path.
#
# Direction: raising the handicap (more negative for home) makes home HARDER
# to cover → home odds lengthen, away odds shorten; lowering it is the mirror.
_AH_STEP_FACTORS = [
    # (price_upper_bound, shorten_factor (<1), lengthen_factor (>1))
    (1.50, 0.94, 1.07),
    (2.00, 0.90, 1.12),
    (3.00, 0.86, 1.18),
    (5.00, 0.82, 1.25),
    (1e9,  0.78, 1.30),
]


def _ah_factors(price: float) -> "tuple[float, float]":
    for ub, sh, lg in _AH_STEP_FACTORS:
        if price <= ub:
            return sh, lg
    return 0.78, 1.30


def _snap_down_odds(p: float) -> float:
    """Floor a decimal price to the standard odds ladder (house-favourable)."""
    if p <= 1.01:
        return 1.01
    if p <= 2.0:    step = 0.01
    elif p <= 3.0:  step = 0.05
    elif p <= 5.0:  step = 0.10
    elif p <= 10.0: step = 0.25
    elif p <= 20.0: step = 0.5
    else:           step = 1.0
    v = int(p / step + 1e-9) * step
    return round(max(v, 1.01), 2)


def _synth_ah_neighbors(line: float, home: float, away: float) -> list[dict]:
    """Return 3 Spread rows [{hdp,home,away}] for line-0.25 / line / line+0.25.
    The middle rung keeps the real live prices; the neighbours are stepped via
    _AH_STEP_FACTORS and floored to the ladder."""
    h_sh, h_lg = _ah_factors(home)
    a_sh, a_lg = _ah_factors(away)
    lo = {  # line-0.25: home easier (shorter), away harder (longer)
        "hdp":  round(line - 0.25, 2),
        "home": _snap_down_odds(home * h_sh),
        "away": _snap_down_odds(away * a_lg),
    }
    mid = {"hdp": round(line, 2), "home": round(home, 2), "away": round(away, 2)}
    hi = {  # line+0.25: home harder (longer), away easier (shorter)
        "hdp":  round(line + 0.25, 2),
        "home": _snap_down_odds(home * h_lg),
        "away": _snap_down_odds(away * a_sh),
    }
    # Preserve monotonicity if ladder-snapping collided at very short prices,
    # never letting a synthesized price fall below the 1.01 floor.
    if not (lo["home"] < mid["home"] < hi["home"]):
        lo["home"] = round(max(1.01, min(lo["home"], mid["home"] - 0.01)), 2)
        hi["home"] = round(max(hi["home"], mid["home"] + 0.01), 2)
    if not (lo["away"] > mid["away"] > hi["away"]):
        lo["away"] = round(max(lo["away"], mid["away"] + 0.01), 2)
        hi["away"] = round(max(1.01, min(hi["away"], mid["away"] - 0.01)), 2)
    return [lo, mid, hi]


def _canonical_markets_from_main_odds(mo: "dict | None", synth_neighbors: bool = False) -> list[dict]:
    """Project a live snapshot's pre-computed ``main_odds`` (9-column shape)
    into the canonical market-list shape that ``parse_rcn_markets`` emits and
    that the PHP place-bet validator (``locateMarketLine``) + the H5 detail
    view both consume: canonical English market_name ("ML"/"Spread"/...),
    field-keyed odds rows ({home,draw,away} / {over,under,hdp} / ...), and a
    canonical 6-digit market_id with **ML pinned to "000001"** — the id the
    H5 inline 主胜/平局/客胜 buttons hard-code.

    WHY: the in-play /markets endpoint otherwise serves Goalserve's RAW book
    ("Fulltime Result"/id "001777"/[{selection,price}] rows), which the PHP
    validator (built for the r_cn canonical shape) cannot match — so every
    in-play bet was rejected `market_not_open`.  main_odds is the SAME source
    the H5 list card shows + submits, so validating against it eliminates
    both the market_not_open and odds_changed false-rejects.
    """
    if not isinstance(mo, dict):
        return []

    def _p(v) -> float:
        try:
            f = float(v)
            return f if f > 0 else 0.0
        except (TypeError, ValueError):
            return 0.0

    def _h(v) -> float:
        if v in (None, ""):
            return 0.0
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    out: list[dict] = []

    def add(name: str, rows: list[dict]) -> None:
        if not rows:
            return
        idx = len(out) + 1
        out.append({
            "market_id":     f"{idx:06d}",
            "market_id_int": idx,
            "name":          name,
            "market_name":   name,
            "odds":          rows,
        })

    # ML first → market_id 000001 (the inline list buttons hard-code this id).
    if _p(mo.get("m_h")):
        add("ML", [{"home": _p(mo.get("m_h")), "draw": _p(mo.get("m_n")), "away": _p(mo.get("m_c"))}])
    if _p(mo.get("re_h")) and _p(mo.get("re_c")):
        _re_line = _h(mo.get("re_line"))
        _re_h, _re_c = _p(mo.get("re_h")), _p(mo.get("re_c"))
        if synth_neighbors:
            # Model B: live ±0.25 ladder (3 rungs) for in-play 让球.
            add("Spread", _synth_ah_neighbors(_re_line, _re_h, _re_c))
        else:
            add("Spread", [{"hdp": _re_line, "home": _re_h, "away": _re_c}])
    if _p(mo.get("ou_over")) and _p(mo.get("ou_under")):
        add("Totals", [{"hdp": _h(mo.get("ou_line")), "over": _p(mo.get("ou_over")), "under": _p(mo.get("ou_under"))}])
    if _p(mo.get("ht_h")):
        add("Half Time Result", [{"home": _p(mo.get("ht_h")), "draw": _p(mo.get("ht_n")), "away": _p(mo.get("ht_c"))}])
    if _p(mo.get("reh_h")) and _p(mo.get("reh_c")):
        add("Spread HT", [{"hdp": _h(mo.get("reh_line")), "home": _p(mo.get("reh_h")), "away": _p(mo.get("reh_c"))}])
    if _p(mo.get("ouh_over")) and _p(mo.get("ouh_under")):
        add("Totals HT", [{"hdp": _h(mo.get("ouh_line")), "over": _p(mo.get("ouh_over")), "under": _p(mo.get("ouh_under"))}])
    if _p(mo.get("dnb_h")) and _p(mo.get("dnb_c")):
        add("Draw No Bet", [{"home": _p(mo.get("dnb_h")), "away": _p(mo.get("dnb_c"))}])
    if _p(mo.get("btts_yes")) and _p(mo.get("btts_no")):
        add("Both Teams To Score", [{"yes": _p(mo.get("btts_yes")), "no": _p(mo.get("btts_no"))}])
    if _p(mo.get("btts_ht_yes")) and _p(mo.get("btts_ht_no")):
        add("Both Teams To Score HT", [{"yes": _p(mo.get("btts_ht_yes")), "no": _p(mo.get("btts_ht_no"))}])
    if _p(mo.get("corners_over")) and _p(mo.get("corners_under")):
        add("Corners Totals", [{"hdp": _h(mo.get("corners_line")), "over": _p(mo.get("corners_over")), "under": _p(mo.get("corners_under"))}])
    # NB: Double Chance + Correct Score are intentionally NOT projected here —
    # they don't fit the field-keyed render path cleanly (label-based), so we
    # leave Goalserve's own DC/Correct-Score markets in place for the detail
    # view + their native detail-page betting.
    return out




# Wall-clock minutes after kickoff at which the first half is almost certainly
# over (45 regulation + ~5 min stoppage buffer). Used as a fallback HT-expiry
# signal when the inball_h_hr / inball_c_hr (halftime score) columns haven't
# been written yet.  Conservative: real HT happens ~50 min into kickoff for
# most matches.
HT_EXPIRY_AFTER_KICKOFF_SEC = 50 * 60

_CORRECT_SCORE_LABEL_RE = re.compile(r"^\s*(\d+)\s*[-:]\s*(\d+)\s*$")


def _is_ht_market_name(name: str) -> bool:
    """Return True when ``name`` denotes a first-half-only market whose
    outcome is locked the moment the first half ends (so it shouldn't be
    bookable in the second half).

    Matches Crown's canonical market_name shapes used by both the limitless
    adapter and ``parseRcnMarkets``:
        - ``"Half Time Result"``
        - any ``"<base> HT"`` suffix (Spread HT, Totals HT, Corners Spread HT,
          Corners Totals HT, Both Teams To Score HT, Correct Score HT, …)
        - ``"1st Half ..."`` / ``"First Half ..."`` variants the upstream
          occasionally emits.
    """
    if not name:
        return False
    s = name.strip().lower()
    if s == "half time result":
        return True
    if s.endswith(" ht") or s.endswith(" half time"):
        return True
    if s.startswith("1st half ") or s.startswith("first half "):
        return True
    return False


def _is_first_half_over(event: dict) -> bool:
    """Decide whether the first half of an in-play match has ended.

    Three independent signals (any one suffices, listed in order of
    authority):
      1. api-sports.io ``status.short`` reports HT, 2H, ET, FT, AET, or
         PEN — the most accurate signal because it comes from the live
         broadcast feed.  Available when the ``--live-only`` cron has
         seen this fixture in api-sports.io's coverage.
      2. ``inball_h_hr`` / ``inball_c_hr`` populated — half-time score
         column, written by Crown's score ingest only after HT.
      3. Wall-clock elapsed since kickoff > ``HT_EXPIRY_AFTER_KICKOFF_SEC``
         (~50 min) — fallback for matches outside api-sports' coverage.

    Pre-match and settled events are out of scope and return False.
    """
    if not _is_inplay_row(event):
        return False
    short = (event.get("status_short") or "").upper()
    if short in {"HT", "2H", "ET", "BT", "INT", "FT", "AET", "PEN"}:
        return True
    sh_ht = event.get("score_home_ht")
    sa_ht = event.get("score_away_ht")
    if sh_ht is not None or sa_ht is not None:
        return True
    cts = event.get("commence_ts")
    try:
        cts = int(cts) if cts is not None else None
    except (TypeError, ValueError):
        cts = None
    if cts and (time.time() - cts) > HT_EXPIRY_AFTER_KICKOFF_SEC:
        return True
    return False


def _filter_expired_ht_markets(event: dict, markets: list[dict]) -> list[dict]:
    """Strip first-half-only markets once the first half is over. These
    markets settle at half-time, so leaving them bookable in the second
    half would let users place bets on already-determined outcomes —
    either a guaranteed loss (impossible line) or a guaranteed win
    (already-cleared spread). Same defensive copy pattern as the
    Correct Score filter.
    """
    if not markets:
        return markets
    if not _is_first_half_over(event):
        return markets
    out: list[dict] = []
    for m in markets:
        if not isinstance(m, dict):
            out.append(m)
            continue
        name = str(m.get("market_name") or m.get("name") or "")
        if _is_ht_market_name(name):
            continue  # drop entire market — outcome is locked
        out.append(m)
    return out


def _filter_impossible_correct_score(event: dict, markets: list[dict]) -> list[dict]:
    """Drop Correct Score outcomes that are mathematically impossible given
    the current live score (you can't *un-score* a goal). For pre-match,
    settled, or zero-zero matches every scoreline is still possible, so this
    helper short-circuits to the input list.

    Mutates a *copy* of the affected market so callers don't see surprises
    upstream. Markets without a numeric "<H>-<A>" label (e.g. "Any Other
    Home Win") fall through unmodified — better to leak one harmless row
    than to silently drop labelled-bucket fallbacks.
    """
    if not markets:
        return markets
    sh = event.get("score_home")
    sa = event.get("score_away")
    if sh is None or sa is None:
        return markets
    try:
        sh = int(sh)
        sa = int(sa)
    except (TypeError, ValueError):
        return markets
    if sh <= 0 and sa <= 0:
        return markets  # nothing is impossible yet
    out: list[dict] = []
    for m in markets:
        if not isinstance(m, dict):
            out.append(m)
            continue
        name = str(m.get("market_name") or m.get("name") or "").strip()
        n_lower = name.lower()
        # Only the FT correct-score grid: HT / 1H / 2H variants use a
        # different score baseline (halftime / second-half goals scored)
        # so it's wrong to filter them against the full-match score we
        # have here. If we ever surface HT correct score we can add a
        # parallel helper that takes (score_home_ht, score_away_ht).
        is_ft_correct_score = (
            n_lower == "correct score"
            or n_lower.startswith("correct score ft")
            or n_lower == "correct score full time"
        )
        if not is_ft_correct_score:
            out.append(m)
            continue
        odds = m.get("odds") or []
        kept: list = []
        dropped = 0
        for r in odds:
            if not isinstance(r, dict):
                kept.append(r)
                continue
            label = str(r.get("label") or r.get("score") or "")
            mt = _CORRECT_SCORE_LABEL_RE.match(label)
            if not mt:
                kept.append(r)
                continue
            h_final = int(mt.group(1))
            a_final = int(mt.group(2))
            if h_final < sh or a_final < sa:
                dropped += 1
                continue
            kept.append(r)
        if not kept:
            # Whole market becomes impossible (unusual: live score beyond every
            # listed line). Drop the entire market rather than emit an empty
            # block that would render as "no outcomes" in the UI.
            continue
        new_m = dict(m)
        new_m["odds"] = kept
        out.append(new_m)
    return out


# ---------------------------------------------------------------------------
# In-play "already decided" filters
#
# Several markets become bookable-but-determined the moment a goal/card/
# corner is recorded:
#   * Totals & Alternative Total Goals  — over wins once total > line
#   * Totals HT (pre-HT)                — same, against 1H goals
#   * Corners Totals                    — over wins once corners > line
#   * Bookings Totals                   — over wins once cards > line
#   * Both Teams To Score (+ HT)        — Yes wins once both have scored
#   * Anytime Goalscorer                — per-player Yes locks once scored
#
# Letting these stay in the market list lets users place a guaranteed-loss
# bet (Under 2.5 when score is 3-1) or a guaranteed-win bet (Over 2.5 in
# the same situation, which the book has to pay for free).  Both are bad
# UX and bad economics, so the whole bookmaking industry hides them.
# ---------------------------------------------------------------------------

def _safe_int_sum(*vals: object) -> int | None:
    """Sum of `vals` when EVERY entry is a non-null integer-coercible value;
    None when any input is missing.  Defensive — a missing data point must
    NEVER fire the auto-close, otherwise a transient cron pause would wipe
    all corner / card markets despite no real-world score change.
    """
    parts: list[int] = []
    for v in vals:
        if v is None:
            return None
        try:
            parts.append(int(v))
        except (TypeError, ValueError):
            return None
    return sum(parts)


def _row_over_decided(row: object, total: int | None) -> bool:
    """A single Over/Under row is over-decided when the live total has
    strictly crossed the row's `hdp` line.  Conservative on missing data
    and on push-eligible integer lines (we only fire on `>` not `>=` so
    a 3.0 line at total=3 stays bet-able as a push).
    """
    if total is None or not isinstance(row, dict):
        return False
    hdp = row.get("hdp")
    if hdp is None:
        return False
    try:
        line = float(hdp)
    except (TypeError, ValueError):
        return False
    return total > line


def _all_rows_over_decided(odds: list, total: int | None) -> bool:
    """True iff every priced row in `odds` is over-decided.  Single-line
    markets (Totals, Totals HT, Corners Totals, Bookings Totals) reduce to
    the one-row case; multi-row lists must have all rows decided before
    the whole market is dropped (use `_row_over_decided` per-row in the
    Alternative Total Goals path to drop only the decided rows instead).
    """
    if not odds:
        return False
    rows = [r for r in odds if isinstance(r, dict) and r.get("hdp") is not None]
    if not rows:
        return False
    return all(_row_over_decided(r, total) for r in rows)


def _filter_decided_total_markets(event: dict, markets: list[dict]) -> list[dict]:
    """Drop totals-family markets whose live tally has crossed the line.

    Source-of-truth per market type:
        Totals / Alternative Total Goals   → score_home + score_away
        Totals HT  (only pre-HT)           → 1H goals (= current total
                                              during 1H, since 2H goals
                                              are 0 by definition).
                                              Post-HT is dropped by
                                              `_filter_expired_ht_markets`.
        Corners Totals                     → corners_home + corners_away
                                              (auto-NULLed by FastAPI if
                                              the stats cron is stale, so
                                              we never fire on stale data)
        Bookings Totals                    → yc_h+_c + rc_h+_c
                                              (UNIT NOTE: counts cards as
                                              1-each.  If Crown's line is
                                              points-based, points = yc+2*rc
                                              → our trigger is conservative,
                                              fires only when actual count
                                              already exceeds line — never
                                              false-positives.)

    Single-line markets are dropped wholesale; Alternative Total Goals
    is filtered row-by-row so the higher (still-undecided) lines keep
    trading.
    """
    if not markets:
        return markets

    score_total   = _safe_int_sum(event.get("score_home"), event.get("score_away"))
    corners_total = _safe_int_sum(event.get("corners_home"), event.get("corners_away"))
    cards_total   = _safe_int_sum(
        event.get("yc_home"), event.get("yc_away"),
        event.get("rc_home"), event.get("rc_away"),
    )

    inplay = _is_inplay_row(event)
    pre_ht = inplay and not _is_first_half_over(event)

    out: list[dict] = []
    for m in markets:
        if not isinstance(m, dict):
            out.append(m)
            continue
        name = (m.get("market_name") or m.get("name") or "").strip().lower()
        odds = m.get("odds") or []

        if name == "totals":
            if _all_rows_over_decided(odds, score_total):
                continue
        elif name == "alternative total goals":
            kept = [r for r in odds if not _row_over_decided(r, score_total)]
            if not kept:
                # Every alternative line crossed — exceptional (would need a
                # double-digit blowout).  Drop the whole market rather than
                # render an empty body.
                continue
            if len(kept) != len(odds):
                m = {**m, "odds": kept}
        elif name == "totals ht":
            # Only the pre-HT case here; post-HT this market is removed
            # entirely by `_filter_expired_ht_markets` upstream.
            if pre_ht and _all_rows_over_decided(odds, score_total):
                continue
        elif name == "corners totals":
            if _all_rows_over_decided(odds, corners_total):
                continue
        elif name == "bookings totals":
            if _all_rows_over_decided(odds, cards_total):
                continue
        out.append(m)
    return out


def _filter_decided_btts(event: dict, markets: list[dict]) -> list[dict]:
    """Drop Both-Teams-To-Score markets once both sides have scored.

    Once Yes is locked, leaving the market visible is a trap: a user
    could place a No bet that has no path to win.  Drop the entire
    market — Yes bettors aren't penalised since the original row is
    now a guaranteed payout (their bet was placed before the lock and
    is unaffected by what we hide on subsequent loads).

    `Both Teams To Score HT` only auto-closes pre-HT here; after HT it's
    dropped wholesale by `_filter_expired_ht_markets`.
    """
    if not markets or not _is_inplay_row(event):
        return markets
    sh = event.get("score_home")
    sa = event.get("score_away")
    if sh is None or sa is None:
        return markets
    try:
        sh_i, sa_i = int(sh), int(sa)
    except (TypeError, ValueError):
        return markets
    if sh_i <= 0 or sa_i <= 0:
        return markets

    pre_ht = not _is_first_half_over(event)
    out: list[dict] = []
    for m in markets:
        if not isinstance(m, dict):
            out.append(m)
            continue
        name = (m.get("market_name") or m.get("name") or "").strip().lower()
        if name == "both teams to score":
            continue
        if name == "both teams to score ht" and pre_ht:
            # During 1H the current score IS the 1H score — so seeing
            # both > 0 right now means both scored in 1H.  Post-HT the
            # condition can't be assessed from current score alone, so
            # we let the HT-expiry filter handle dropping it.
            continue
        out.append(m)
    return out


_GOAL_OWN_RE     = re.compile(r"\bown\b",     re.IGNORECASE)
_GOAL_MISSED_RE  = re.compile(r"\bmissed\b",  re.IGNORECASE)
_NAME_PUNCT_RE   = re.compile(r"[^\w\s]", re.UNICODE)
_NAME_WS_RE      = re.compile(r"\s+")


def _normalise_player_name(name: str) -> str:
    """Lowercase + strip punctuation + collapse whitespace.  Used both for
    Crown's AGS_LIST entries and api-sports' `events[].p` so the two name
    formats ('J. Vasquez' vs 'Julian Vasquez') can be compared by their
    last word.  Returns "" for non-string / empty input.
    """
    if not isinstance(name, str):
        return ""
    s = _NAME_PUNCT_RE.sub(" ", name.lower())
    return _NAME_WS_RE.sub(" ", s).strip()


def _filter_decided_goalscorer(event: dict, markets: list[dict]) -> list[dict]:
    """Lock 'Anytime Goalscorer' rows whose player has already scored.

    Goal events come from `apisports_events` (populated by the live cron
    every minute).  We drop the player's row from the Anytime Goalscorer
    market — both Yes (guaranteed win) and No (guaranteed loss) sides
    are no longer bookable.

    Cross-source name matching uses last-word equality after
    normalisation, so 'J. Vasquez' (api-sports) matches both 'Julian
    Vasquez' and 'Vasquez' (Crown).  False positives in the rare
    same-last-name case drop a single bettable row early — preferable
    to leaving a guaranteed-loss bet visible.

    Own goals (`detail` contains 'own') do NOT credit the listed scorer
    in Anytime Goalscorer markets — a player whose deflection went in
    against them still has Anytime Goalscorer = No until they score
    properly.  Missed penalties similarly aren't goals.
    """
    if not markets or not _is_inplay_row(event):
        return markets
    events = event.get("apisports_events") or []
    if not events:
        return markets

    scored_norm: set[str] = set()
    for ev in events:
        if not isinstance(ev, dict):
            continue
        if ev.get("t") != "Goal":
            continue
        detail = ev.get("d") or ""
        if _GOAL_OWN_RE.search(detail) or _GOAL_MISSED_RE.search(detail):
            continue
        n = _normalise_player_name(ev.get("p") or "")
        if n:
            scored_norm.add(n)
    if not scored_norm:
        return markets

    last_words = {n.split()[-1] for n in scored_norm if n}

    out: list[dict] = []
    for m in markets:
        if not isinstance(m, dict):
            out.append(m)
            continue
        name = (m.get("market_name") or m.get("name") or "").strip().lower()
        if name != "anytime goalscorer":
            out.append(m)
            continue
        odds = m.get("odds") or []
        kept: list = []
        for r in odds:
            if not isinstance(r, dict):
                kept.append(r)
                continue
            label = r.get("label") or r.get("score") or ""
            n = _normalise_player_name(label) if isinstance(label, str) else ""
            if not n:
                kept.append(r)
                continue
            if n in scored_norm or n.split()[-1] in last_words:
                continue  # already scored — drop the row
            kept.append(r)
        if not kept:
            continue
        if len(kept) != len(odds):
            m = {**m, "odds": kept}
        out.append(m)
    return out


def _filter_decided_ht_ft(event: dict, markets: list[dict]) -> list[dict]:
    """Drop Half-Time/Full-Time combo outcomes whose half-time leg can no
    longer happen.

    Each HT/FT outcome is a ``HT/FT`` pair (raw ``selection`` like ``1/1``,
    ``x/1``, ``2/x`` — first token = half-time result: 1=home, x=draw,
    2=away; second = full-time result).  Once the half-time score is known
    (``score_home_ht`` / ``score_away_ht`` populated, which Goalserve only
    sends at/after HT), every outcome whose HT leg disagrees with the actual
    HT result is impossible and is dropped.  The full-time leg is still
    undecided, so the market itself stays bookable (e.g. a 0-0 half keeps
    only the ``x/*`` rows).  Mirrors the per-row drop pattern of
    ``_filter_decided_goalscorer``.
    """
    if not markets:
        return markets
    sh_ht = event.get("score_home_ht")
    sa_ht = event.get("score_away_ht")
    if sh_ht is None or sa_ht is None:
        return markets
    try:
        sh_ht, sa_ht = int(sh_ht), int(sa_ht)
    except (TypeError, ValueError):
        return markets
    ht_leg = "1" if sh_ht > sa_ht else ("2" if sh_ht < sa_ht else "x")
    out: list[dict] = []
    for m in markets:
        if not isinstance(m, dict):
            out.append(m)
            continue
        name = (m.get("market_name") or m.get("name") or "").strip().lower()
        if name not in ("half time/full time", "halftime/fulltime",
                        "half-time/full-time", "ht/ft"):
            out.append(m)
            continue
        odds = m.get("odds") or []
        kept: list = []
        for r in odds:
            if not isinstance(r, dict):
                kept.append(r)
                continue
            sel = str(r.get("selection") or r.get("label")
                      or r.get("score") or "").strip().lower()
            leg = sel.split("/", 1)[0].strip() if "/" in sel else ""
            if leg in ("1", "x", "2") and leg != ht_leg:
                continue  # half-time leg can no longer happen
            kept.append(r)
        if not kept:
            continue
        if len(kept) != len(odds):
            m = {**m, "odds": kept}
        out.append(m)
    return out


_NTH_GOAL_RE = re.compile(r"which team will score the\s+(\d+)(?:st|nd|rd|th)\s+goal", re.I)


def _norm_mkt_name(m: dict) -> str:
    """Lowercased market name with collapsed internal whitespace (some
    Goalserve names carry a stray double space, e.g.
    'Home Team  to Score in Both Halves')."""
    return _NAME_WS_RE.sub(" ", (m.get("market_name") or m.get("name") or "").strip().lower())


def _sel_of(r: object) -> str:
    """Lowercased outcome selection label."""
    if not isinstance(r, dict):
        return ""
    return str(r.get("selection") or r.get("label") or r.get("score") or "").strip().lower()


def _drop_selections(m: dict, dead) -> "dict | None":
    """Return a copy of market `m` with outcome rows whose selection is in
    `dead` removed.  Returns None when every row would be dropped (caller
    should drop the whole market) and the original `m` when nothing changed.
    `dead` may be a set of exact selections or a predicate callable."""
    odds = m.get("odds") or []
    pred = dead if callable(dead) else (lambda s: s in dead)
    kept = [r for r in odds if not (isinstance(r, dict) and pred(_sel_of(r)))]
    if not kept:
        return None
    if len(kept) == len(odds):
        return m
    return {**m, "odds": kept}


def _filter_decided_result_btts(event: dict, markets: list[dict]) -> list[dict]:
    """Result / Both-Teams-To-Score combo ('1/yes', 'x/no', ...): once BOTH
    teams have scored, BTTS=Yes is locked, so every '*/no' outcome is dead.
    The 1X2 leg is undecided until full time, so the '*/yes' rows stay."""
    if not markets:
        return markets
    try:
        sh, sa = int(event.get("score_home")), int(event.get("score_away"))
    except (TypeError, ValueError):
        return markets
    if sh <= 0 or sa <= 0:
        return markets  # BTTS not yet locked
    out: list[dict] = []
    for m in markets:
        if not isinstance(m, dict) or _norm_mkt_name(m) != "result / both teams to score":
            out.append(m)
            continue
        nm = _drop_selections(m, lambda s: s.endswith("/no"))
        if nm is not None:
            out.append(nm)
    return out


def _filter_decided_2h_yesno(event: dict, markets: list[dict]) -> list[dict]:
    """Drop the impossible leg of 2nd-half scoring Yes/No markets once the
    half-time score is known: a team that has scored after HT locks 'yes'
    (drop 'no').  Needs both the full-time and half-time scores."""
    if not markets:
        return markets
    try:
        sh, sa = int(event.get("score_home")), int(event.get("score_away"))
        hh, ha = int(event.get("score_home_ht")), int(event.get("score_away_ht"))
    except (TypeError, ValueError):
        return markets
    h2_home, h2_away = sh - hh, sa - ha
    out: list[dict] = []
    for m in markets:
        if not isinstance(m, dict):
            out.append(m)
            continue
        name = _norm_mkt_name(m)
        if name == "home team score a goal (2nd half)" and h2_home > 0:
            drop = "no"
        elif name == "away team score a goal (2nd half)" and h2_away > 0:
            drop = "no"
        elif name == "both teams to score (2nd half)" and h2_home > 0 and h2_away > 0:
            drop = "no"
        else:
            out.append(m)
            continue
        nm = _drop_selections(m, {drop})
        if nm is not None:
            out.append(nm)
    return out


def _filter_decided_both_halves(event: dict, markets: list[dict]) -> list[dict]:
    """'<Team> to Score in Both Halves' Yes/No: once HT is known, a team that
    was scoreless at the break can never satisfy Yes (drop 'yes'); a team
    that has scored in BOTH halves locks Yes (drop 'no')."""
    if not markets:
        return markets
    try:
        sh, sa = int(event.get("score_home")), int(event.get("score_away"))
        hh, ha = int(event.get("score_home_ht")), int(event.get("score_away_ht"))
    except (TypeError, ValueError):
        return markets

    def _drop_for(team_ht: int, team_2h: int) -> "str | None":
        if team_ht <= 0:
            return "yes"   # no first-half goal -> both-halves impossible
        if team_2h > 0:
            return "no"    # scored in both halves -> Yes locked
        return None

    out: list[dict] = []
    for m in markets:
        if not isinstance(m, dict):
            out.append(m)
            continue
        name = _norm_mkt_name(m)
        if name == "home team to score in both halves":
            drop = _drop_for(hh, sh - hh)
        elif name == "away team to score in both halves":
            drop = _drop_for(ha, sa - ha)
        else:
            out.append(m)
            continue
        if drop is None:
            out.append(m)
            continue
        nm = _drop_selections(m, {drop})
        if nm is not None:
            out.append(nm)
    return out


def _filter_decided_nth_goal(event: dict, markets: list[dict]) -> list[dict]:
    """'Which team will score the Nth goal?' is fully decided the moment N
    goals have been scored (the Nth-goal event has happened).  We don't carry
    the goal sequence here, so we can't say *which* team — drop the whole
    settled market, which removes the guaranteed-loss legs."""
    if not markets:
        return markets
    try:
        total = int(event.get("score_home")) + int(event.get("score_away"))
    except (TypeError, ValueError):
        return markets
    if total <= 0:
        return markets
    out: list[dict] = []
    for m in markets:
        if not isinstance(m, dict):
            out.append(m)
            continue
        mt = _NTH_GOAL_RE.search(_norm_mkt_name(m))
        if mt and total >= int(mt.group(1)):
            continue  # Nth goal already scored -> decided
        out.append(m)
    return out


def _filter_decided_last_to_score(event: dict, markets: list[dict]) -> list[dict]:
    """'Last Team to Score (3 way)': the 'draw' (= neither team scores) leg is
    dead the moment any goal is scored.  Home/Away stay live because the last
    scorer can still change."""
    if not markets:
        return markets
    try:
        total = int(event.get("score_home")) + int(event.get("score_away"))
    except (TypeError, ValueError):
        return markets
    if total <= 0:
        return markets
    out: list[dict] = []
    for m in markets:
        if not isinstance(m, dict) or _norm_mkt_name(m) != "last team to score (3 way)":
            out.append(m)
            continue
        nm = _drop_selections(m, {"draw"})
        if nm is not None:
            out.append(nm)
    return out


def _filter_decided_match_total(event: dict, markets: list[dict]) -> list[dict]:
    """Match-total Over/Under ('Match Goals', 'Over/Under Line'): the book is
    settled once the live total has crossed every listed line (Over
    guaranteed, Under impossible).  These carry the line under `handicap`
    (not `hdp`) and use names the canonical-totals filter doesn't match, so
    handle them here.  Drop only when EVERY line is crossed (conservative for
    multi-line books)."""
    if not markets:
        return markets
    try:
        total = int(event.get("score_home")) + int(event.get("score_away"))
    except (TypeError, ValueError):
        return markets
    out: list[dict] = []
    for m in markets:
        if not isinstance(m, dict) or _norm_mkt_name(m) not in ("match goals", "over/under line"):
            out.append(m)
            continue
        lines: list[float] = []
        for r in (m.get("odds") or []):
            if not isinstance(r, dict):
                continue
            ln = r.get("hdp")
            if ln is None:
                ln = r.get("handicap")
            if ln is None:
                continue
            try:
                lines.append(float(ln))
            except (TypeError, ValueError):
                pass
        if lines and all(total > ln for ln in lines):
            continue  # every line crossed -> Over decided, Under dead
        out.append(m)
    return out


def _apply_decided_filters(event: dict, markets: list[dict]) -> list[dict]:
    """Run all in-play "already decided" filters in sequence.

    Order matters only weakly — each filter targets a disjoint set of
    market_name strings — but we run the cheaper full-market drops first
    so the per-row scans see a smaller list.
    """
    markets = _filter_expired_ht_markets(event, markets)
    markets = _filter_decided_btts(event, markets)
    markets = _filter_decided_total_markets(event, markets)
    markets = _filter_decided_goalscorer(event, markets)
    markets = _filter_impossible_correct_score(event, markets)
    markets = _filter_decided_ht_ft(event, markets)
    markets = _filter_decided_result_btts(event, markets)
    markets = _filter_decided_2h_yesno(event, markets)
    markets = _filter_decided_both_halves(event, markets)
    markets = _filter_decided_nth_goal(event, markets)
    markets = _filter_decided_last_to_score(event, markets)
    markets = _filter_decided_match_total(event, markets)
    return markets


def _read_shm_cache(event_id: int) -> dict | None:
    """Read the latest merged WS snapshot for a single event.  Returns
    None if the file is missing (relay hasn't pushed this event yet),
    malformed, OR stale (mtime older than ``WS_CACHE_STALE_AFTER_SEC``).

    The freshness check protects the WS-only invariant from a class of
    failure where the ws-relay daemon dies mid-day: cache files persist
    on /dev/shm but stop being refreshed, so without this check the
    backend would happily serve hour-old "live" prices.  Threshold is
    intentionally generous (~2 min) because the upstream feed's
    bulk-snapshot cycle is ~38 s and we don't want to flap during the
    normal reconnect gaps documented in the ws-relay deploy notes.
    """
    f = WS_SHM_CACHE_DIR / f"{event_id}.json"
    try:
        st = f.stat()
    except (FileNotFoundError, IsADirectoryError, OSError):
        return None
    if time.time() - st.st_mtime > WS_CACHE_STALE_AFTER_SEC:
        return None
    try:
        with f.open("rb") as fp:
            return json.loads(fp.read())
    except (FileNotFoundError, IsADirectoryError):
        return None
    except (OSError, json.JSONDecodeError):
        return None


def _is_inplay_row(row: dict) -> bool:
    """Thin alias so existing call sites keep reading; the canonical
    in-play predicate lives in ``mysqldb.is_inplay_event``.
    """
    return mysqldb.is_inplay_event(row)


def _is_gs_event(event: dict) -> bool:
    """True when this event came from a Goalserve feed (its lid lives in
    the GS competition-id space).  Only GS rows are subject to the
    pregame→inplay time cutoff; Crown-native rows keep the legacy
    ``is_inplay_event`` predicate."""
    try:
        return int(event.get("lid") or 0) >= _GS_LID_BASE
    except (TypeError, ValueError):
        return False


def _gs_has_live(event_id: int) -> bool:
    """True iff a *fresh* /dev/shm live WS snapshot exists for this gid.
    This is the only proof that a Goalserve match is actually in-play —
    pregame gids (the low competition-id space) never get a live snap, so
    their stale pre-match prices can never be presented as ``ws_live``."""
    return _read_shm_cache(int(event_id)) is not None


def _pregame_closed(commence_ts) -> bool:
    """True once we're within ``GS_PREGAME_CLOSE_LEAD_SEC`` of kickoff:
    the pre-match book is closed from kickoff − lead onward, regardless of
    whether a live feed has started yet."""
    try:
        ts = int(commence_ts or 0)
    except (TypeError, ValueError):
        return False
    if ts <= 0:
        return False
    return time.time() >= (ts - GS_PREGAME_CLOSE_LEAD_SEC)


def _serve_inplay(event: dict) -> bool:
    """Whether to serve/label this event as bookable LIVE odds.

    Goalserve rows: live iff a fresh live WS snapshot exists (pregame gids
    never have one).  Crown-native rows: the legacy time-window predicate.
    """
    if _is_gs_event(event):
        return _gs_has_live(int(event.get("id") or 0))
    return _is_inplay_row(event)


def _gs_pregame_hidden(event: dict) -> bool:
    """A Goalserve row whose pre-match book has closed (kickoff − lead
    passed) but which has no live snap yet — hide it from the list and
    return ``closed`` from the markets endpoint so stale pre-match prices
    can't render in 滚球 or be bookable."""
    return (
        _is_gs_event(event)
        and not _gs_has_live(int(event.get("id") or 0))
        and _pregame_closed(event.get("commence_ts"))
    )


def _main_odds_from_ws_snap(snap: dict) -> dict:
    """Project a /dev/shm WS snapshot's `markets` list into the 9-column
    `main_odds` shape consumed by the H5 frontend's list view.  Mirrors
    PHP's `extractMainOddsFromWsCache()` and the TypeScript twin
    `projectMainOddsFromWs()` — keep all three in lockstep.
    """
    by_name: dict[str, list[dict]] = {}
    for m in (snap.get("markets") or []):
        if isinstance(m, dict) and m.get("name"):
            by_name[m["name"]] = list(m.get("odds") or [])

    def first(name: str) -> dict:
        rows = by_name.get(name) or []
        return rows[0] if rows and isinstance(rows[0], dict) else {}

    mo: dict = {}
    if "ML" in by_name:
        r = first("ML")
        mo["m_h"] = _get_float(r, "home")
        mo["m_n"] = _get_float(r, "draw")
        mo["m_c"] = _get_float(r, "away")
    if "Spread" in by_name:
        r = first("Spread")
        mo["re_h"]    = _get_float(r, "home")
        mo["re_c"]    = _get_float(r, "away")
        mo["re_line"] = r.get("hdp") or 0
    if "Totals" in by_name:
        r = first("Totals")
        mo["ou_over"]  = _get_float(r, "over")
        mo["ou_under"] = _get_float(r, "under")
        mo["ou_line"]  = r.get("hdp") or 0
    if "Draw No Bet" in by_name:
        r = first("Draw No Bet")
        mo["dnb_h"] = _get_float(r, "home")
        mo["dnb_c"] = _get_float(r, "away")
    btts_key = "Both Teams To Score" if "Both Teams To Score" in by_name else (
        "Both Teams to Score" if "Both Teams to Score" in by_name else None
    )
    if btts_key:
        r = first(btts_key)
        mo["btts_yes"] = _get_float(r, "yes")
        mo["btts_no"]  = _get_float(r, "no")
    if "Spread HT" in by_name:
        r = first("Spread HT")
        mo["reh_h"]    = _get_float(r, "home")
        mo["reh_c"]    = _get_float(r, "away")
        mo["reh_line"] = r.get("hdp") or 0
    if "Totals HT" in by_name:
        r = first("Totals HT")
        mo["ouh_over"]  = _get_float(r, "over")
        mo["ouh_under"] = _get_float(r, "under")
        mo["ouh_line"]  = r.get("hdp") or 0
    if "Half Time Result" in by_name:
        rows = by_name["Half Time Result"]
        if len(rows) >= 3:
            mo["ht_h"] = _get_float(rows[0], "home") or _get_float(rows[0], "under")
            mo["ht_n"] = _get_float(rows[1], "draw") or _get_float(rows[1], "under")
            mo["ht_c"] = _get_float(rows[2], "away") or _get_float(rows[2], "under")
    btts_ht_key = "Both Teams To Score HT" if "Both Teams To Score HT" in by_name else (
        "Both Teams to Score HT" if "Both Teams to Score HT" in by_name else None
    )
    if btts_ht_key:
        r = first(btts_ht_key)
        mo["btts_ht_yes"] = _get_float(r, "yes")
        mo["btts_ht_no"]  = _get_float(r, "no")
    if "Double Chance" in by_name:
        for o in by_name["Double Chance"]:
            if not isinstance(o, dict):
                continue
            lbl = str(o.get("label") or "").lower()
            price = _get_float(o, "under") or _get_float(o, "home") or _get_float(o, "over")
            if " or draw" in lbl and "dc_1x" not in mo:
                mo["dc_1x"] = price
            elif "draw or " in lbl and "dc_x2" not in mo:
                mo["dc_x2"] = price
            elif " or " in lbl and "draw" not in lbl and "dc_12" not in mo:
                mo["dc_12"] = price
    if "Corners Totals" in by_name:
        r = first("Corners Totals")
        mo["corners_over"]  = _get_float(r, "over")
        mo["corners_under"] = _get_float(r, "under")
        mo["corners_line"]  = r.get("hdp") or 0
    if "Correct Score" in by_name:
        # Carry the full scoreline list through main_odds so build_rcn() can
        # emit the <PD> block the r_cn parser / PHP render as 波胆.
        cs: list[dict] = []
        for o in by_name["Correct Score"]:
            if not isinstance(o, dict):
                continue
            price = _get_float(o, "price")
            label = str(o.get("label") or "")
            if price > 0 and label:
                cs.append({"label": label, "price": price})
        if cs:
            mo["cs"] = cs
    return mo


def _get_float(d: dict, key: str) -> float:
    v = d.get(key)
    if v is None:
        return 0.0
    try:
        f = float(v)
        return f if f > 0 else 0.0
    except (TypeError, ValueError):
        return 0.0


# ---------------------------------------------------------------------------
# Net-profit odds haircut
#
# Trims ~3% off the WINNINGS portion of every published decimal price:
#     new = 1 + (old - 1) * ODDS_HAIRCUT_FACTOR
# The result always stays > 1.0 (safe for short prices) and is never lifted
# above the raw price, so the house edge is monotonic.
#
# Applied ONLY at the serving boundaries — the /events list + detail, the
# /events/{id}/markets book, and the browser WebSocket fan-out — so every
# surface the punter sees AND the PHP place-bet validator (which reads the
# SAME /markets endpoint) stay in lockstep, and settlement (which uses the
# stake-time stored odds) inherits the cut automatically.  Internal snapshots
# / caches are left RAW; we only ever cut COPIES at egress, so a cached object
# can never be cut twice (which would compound the haircut on every request).
ODDS_HAIRCUT_FACTOR = 0.97

# Decimal-odds price fields across every market-row shape emitted by the canon
# projection (_canonical_markets_from_main_odds), the goalserve passthrough
# (_passthrough_market / _canon_row) and the r_cn parser (parse_rcn_markets).
# Handicap / line fields (hdp, handicap, *_line) and labels are NEVER cut.
_HAIRCUT_PRICE_KEYS = frozenset({
    "home", "draw", "away", "over", "under", "yes", "no", "price", "odds",
})


def _haircut_price(v):
    """Net-profit haircut for a single decimal-odds value.  Non-numeric or
    ``<= 1.0`` inputs pass through unchanged; the result is rounded to 2dp and
    never rounds up to / below 1.0 (a short price stays > 1.0 and is never
    lifted above the raw price)."""
    try:
        p = float(v)
    except (TypeError, ValueError):
        return v
    if p <= 1.0:
        return v
    new = round(1.0 + (p - 1.0) * ODDS_HAIRCUT_FACTOR, 2)
    return new if new > 1.0 else v


def _is_cs_market(name: "str | None") -> bool:
    """True for FT/HT correct-score markets (波胆)."""
    s = (name or "").strip().lower()
    return ("correct score" in s) or (s == "final score") or ("exact score" in s)


def _cs_price(v):
    """Correct-score price: 3% haircut + house-favourable rounding.
    <100 -> 1 decimal place; >=100 -> 0 decimal places (floor, never round up)."""
    try:
        p = float(v)
    except (TypeError, ValueError):
        return v
    if p <= 1.0:
        return v
    # Apply net-profit haircut first
    hc = 1.0 + (p - 1.0) * ODDS_HAIRCUT_FACTOR
    # House-favourable rounding (floor)
    if hc < 100:
        new = int(hc * 10) / 10.0  # floor to 1dp
    else:
        new = int(hc)  # floor to integer
    return new if new > 1.0 else v


def _haircut_market_rows(markets):
    """Return a NEW market list with every decimal-odds price field hair-cut.
    Builds fresh market + row dicts so a shared/cached snapshot object is never
    mutated (which would compound the cut on the next request).
    Correct-score markets (Final Score, Correct Score, etc.) use _cs_price
    which applies the 3% haircut + house-favourable rounding (1dp if <100, 0dp if >=100)."""
    if not markets:
        return markets
    out = []
    for m in markets:
        if not isinstance(m, dict) or not isinstance(m.get("odds"), list):
            out.append(m)
            continue
        name = str(m.get("market_name") or m.get("name") or "")
        is_cs = _is_cs_market(name)
        new_rows = []
        for r in m["odds"]:
            if isinstance(r, dict):
                nr = dict(r)
                for k in _HAIRCUT_PRICE_KEYS:
                    if k in nr:
                        if is_cs:
                            nr[k] = _cs_price(nr[k])
                        else:
                            nr[k] = _haircut_price(nr[k])
                new_rows.append(nr)
            else:
                new_rows.append(r)
        nm = dict(m)
        nm["odds"] = new_rows
        out.append(nm)
    return out


def _haircut_main_odds(mo):
    """Return a NEW 9-column main_odds dict with every decimal-odds value
    hair-cut.  ``*_line`` handicap keys are preserved verbatim; the ``cs``
    scoreline list has each row's ``price`` formatted with _cs_price (3%
    haircut + house-favourable rounding: 1dp if <100, 0dp if >=100)."""
    if not isinstance(mo, dict):
        return mo
    out = {}
    for k, v in mo.items():
        if k == "cs" and isinstance(v, list):
            out[k] = [
                ({**r, "price": _cs_price(r.get("price"))}
                 if isinstance(r, dict) else r)
                for r in v
            ]
        elif k.endswith("_line"):
            out[k] = v
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            out[k] = _haircut_price(v)
        else:
            out[k] = v
    return out


def _haircut_snap(snap):
    """Return a shallow COPY of a browser-WS snapshot with its inline
    ``main_odds`` (and any markets arrays) hair-cut, leaving the shared/queued
    source object untouched so a fan-out / replay can't double-cut it."""
    if not isinstance(snap, dict):
        return snap
    out = dict(snap)
    if isinstance(snap.get("main_odds"), dict):
        out["main_odds"] = _haircut_main_odds(snap["main_odds"])
    for mk in ("markets", "_markets"):
        if isinstance(snap.get(mk), list):
            out[mk] = _haircut_market_rows(snap[mk])
    if isinstance(snap.get("bookmakers"), list):
        out["bookmakers"] = [
            ({**bm, "markets": _haircut_market_rows(bm.get("markets"))}
             if isinstance(bm, dict) and isinstance(bm.get("markets"), list) else bm)
            for bm in snap["bookmakers"]
        ]
    return out


def _load_rcn_markets(event_ids: list[int]) -> "dict[int, list[dict]]":
    """Batch-load r_cn blobs from MySQL and decode each into the canonical
    market list.  Replaces the sqlite ``odds_market`` scan with a single
    ``IN`` query against ``foot_match_xml`` followed by per-event XML
    parse in Python.

    Returns ``{gid: parser_output}`` — empty dict when no event_ids
    given.  Missing/garbled r_cn for an event maps to ``[]``.
    """
    if not event_ids:
        return {}
    placeholders = ",".join(["%s"] * len(event_ids))
    rows = mysqldb.fetch_all(
        f"SELECT gid, r_cn FROM foot_match_xml WHERE gid IN ({placeholders})",
        tuple(event_ids),
    )
    out: "dict[int, list[dict]]" = {}
    for r in rows:
        gid = int(r["gid"])
        out[gid] = parse_rcn_markets(r.get("r_cn") or "")
    return out


def _batch_main_odds(
    event_ids: list[int],
    event_rows: "dict[int, dict] | None" = None,
) -> "dict[int, dict]":
    """Build the 9-column inline ``main_odds`` shape for every event_id by
    decoding r_cn from MySQL.

    When ``event_rows`` is supplied (mapping ``gid → row-dict``) each
    event's markets are first run through ``_apply_decided_filters`` so
    the inline list-card pill mirrors the detail-page lock state — i.e.
    a 大 2.5 / 小 2.5 chip vanishes from the list as soon as the third
    goal goes in, rather than dangling as a guaranteed-loss bet.

    ``_main_odds_from_ws_snap`` is reused unchanged — the parser emits
    each market with ``name`` + ``odds``, matching the WS-cache shape
    that helper consumes.
    """
    markets_by_event = _load_rcn_markets(event_ids)
    result: "dict[int, dict]" = {}
    for gid, markets in markets_by_event.items():
        if not markets:
            continue
        if event_rows is not None:
            ev_row = event_rows.get(gid)
            if ev_row is not None:
                markets = _apply_decided_filters(ev_row, markets)
                if not markets:
                    continue
        mo = _main_odds_from_ws_snap({"markets": markets})
        if mo and any(mo.values()):
            result[gid] = mo
    return result


def _batch_extra_markets(
    event_ids: list[int],
    event_rows: "dict[int, dict] | None" = None,
) -> "dict[int, list[dict]]":
    """For each event, return list of (name, outcome count) for markets
    NOT in ``_INLINED_MARKETS`` — used by the H5 frontend's
    "+N 更多盘口" badge.

    Same source + same per-event decided-filter as ``_batch_main_odds``,
    so the badge count drops in lockstep with the inline pill when an
    in-play market locks (e.g. a Both-Teams-To-Score row vanishing the
    moment both teams have scored).
    """
    markets_by_event = _load_rcn_markets(event_ids)
    out: "dict[int, list[dict]]" = {}
    for gid, markets in markets_by_event.items():
        if event_rows is not None:
            ev_row = event_rows.get(gid)
            if ev_row is not None:
                markets = _apply_decided_filters(ev_row, markets)
        extras = [
            {"name": m["name"], "outcomes": len(m.get("odds") or [])}
            for m in markets
            if isinstance(m, dict) and m.get("name") and m["name"] not in _INLINED_MARKETS
        ]
        if extras:
            out[gid] = extras
    return out


# ---------------------------------------------------------------------------
# Leagues

@router.get("/leagues")
def list_leagues() -> dict:
    """Distinct league_slug + name + counts. Useful for populating filters.

    Reads MySQL ``foot_match`` and projects each ``lid`` through
    ``mysqldb.lid_to_slug``.  Status counts derive from
    ``status``/``is_inball`` Crown columns since the MySQL schema
    doesn't carry the sqlite ``status`` text directly.
    """
    rows = mysqldb.fetch_all(
        f"""
        SELECT lid,
               MAX(league)                                              AS league_name,
               COUNT(*)                                                 AS events,
               SUM(CASE WHEN is_inball = 1 THEN 1 ELSE 0 END)           AS settled,
               SUM(CASE WHEN is_inball = 0 THEN 1 ELSE 0 END)           AS active,
               MIN(`datetime`)                                          AS first_ts,
               MAX(`datetime`)                                          AS last_ts
        FROM foot_match
        WHERE {mysqldb.enabled_lids_sql()} AND {_esports_exclude_sql()}
        GROUP BY lid
        ORDER BY active DESC, events DESC, lid
        """
    )
    items = []
    for r in rows:
        items.append({
            "league_slug": mysqldb.lid_to_slug(r.get("lid")),
            "league_name": r.get("league_name"),
            "events":      int(r.get("events") or 0),
            "active":      int(r.get("active") or 0),
            "settled":     int(r.get("settled") or 0),
            "first_ts":    int(r.get("first_ts") or 0) or None,
            "last_ts":     int(r.get("last_ts") or 0) or None,
        })
    return {"items": items, "total": len(items)}


@router.get("/leagues/daily_counts")
def list_leagues_daily_counts() -> dict:
    """Returns active match counts grouped by league and local date string (YYYY-MM-DD)."""
    rows = mysqldb.fetch_all(
        f"""
        SELECT lid,
               DATE_FORMAT(FROM_UNIXTIME(`datetime`), '%%Y-%%m-%%d') AS date_key,
               COUNT(*) AS active_count
        FROM foot_match
        WHERE {mysqldb.enabled_lids_sql()} AND is_inball = 0 AND {_esports_exclude_sql()}
        GROUP BY lid, date_key
        """
    )
    counts_map = {}
    for r in rows:
        slug = mysqldb.lid_to_slug(r.get("lid"))
        if not slug:
            continue
        if slug not in counts_map:
            counts_map[slug] = {}
        counts_map[slug][r.get("date_key")] = int(r.get("active_count") or 0)
    return {"counts": counts_map}


_CATALOG_TIER_MAP = {"top": 1, "core": 10, "major": 50, "all": 999}


@router.get("/leagues/catalog")
def list_leagues_catalog(tier: str | None = Query(None)) -> dict:
    """Region → country → leagues tree consumed by the H5 DiscoverScreen.

    Mirrors PHP `LeagueRegistry::getCatalog()` so pmppm.com/sports
    (FastAPI route) and /h5/sports (Apache PHP route) return the same
    payload shape.  ``tier`` filters by max priority — top=1 (UCL/UEL/WC),
    core=10 (legacy 9), major=50 (~80 mainstream), all=∞.
    """
    max_priority = _CATALOG_TIER_MAP.get((tier or "").lower())
    payload = mysqldb.build_catalog(max_priority)
    if tier:
        payload["tier"] = tier
    return payload


@router.get("/leagues/search")
def search_leagues(
    q: str = Query("", description="free-text search across slug/name_en/name_cn/country"),
    limit: int = Query(30, ge=1, le=100),
) -> dict:
    """Free-text registry lookup.  Matches PHP `LeagueRegistry::search()`."""
    rows = mysqldb.search_registry(q, limit)
    items = [{
        "lid":          int(r["lid"]),
        "slug":         r["slug"],
        "name_en":      r.get("name_en"),
        "name_cn":      r.get("name_cn") or "",
        "region":       r.get("region"),
        "country":      r.get("country"),
        "flag":         r.get("flag") or "",
        "priority":     int(r.get("priority") or 100),
        "events_count": int(r.get("events_count") or 0),
    } for r in rows]
    return {"items": items, "total": len(items), "q": q}


# ---------------------------------------------------------------------------
# Events

_MYSQL_EVENT_COLS = """
    m.gid, m.lid, m.league, m.team_h, m.team_c,
    m.team_h_en, m.team_c_en,
    m.gnum_h, m.gnum_c,
    m.`datetime`, m.status, m.is_inball,
    m.score_h, m.score_c, m.inball_h, m.inball_c,
    m.inball_h_hr, m.inball_c_hr
"""

# After this many seconds without a fresh stats write the corners columns
# are considered stale and dropped to None on the API surface.  Stats cron
# runs every 2 min, so 5 min = 2.5x grace window.
_APISPORTS_STATS_MAX_AGE_SEC = 5 * 60

_WC_LID = 108


_GS_LIVE_DIR   = _pathlib.Path(_os.environ.get("GS_LIVE_DIR",    "/dev/shm/goalserve_live"))
_GS_PREGAME_DIR= _pathlib.Path(_os.environ.get("GS_PREGAME_DIR", "/dev/shm/goalserve_pregame"))


def _gs_live_snap_for_row(gid: int) -> "dict | None":
    """Return the Goalserve snap for `gid` if one exists.   Tries the
    live tmpfs dir first (matches in progress), then the pregame dir
    (pre-match scheduled fixtures).   Returns None when neither has a
    file or the JSON fails to parse — callers then fall back to whatever
    Crown's foot_match row supplies for the field in question.

    This is the single funnel that replaces every legacy `apisports_*`
    column read.   Goalserve's poller writes elapsed_minute,
    status_short, half-time score, yc/rc/corners/fouls/shots and an
    `_inplay_events` timeline to each snap, so the entire api-sports
    surface has a Goalserve mirror.
    """
    if not gid:
        return None
    for d in (_GS_LIVE_DIR, _GS_PREGAME_DIR):
        try:
            p = d / f"{int(gid)}.json"
            if p.is_file():
                import json as _json
                with p.open("rb") as fh:
                    return _json.load(fh)
        except (OSError, ValueError, TypeError):
            continue
    return None



def _gs_td_safe_lookup(name):
    """Best-effort name -> Goalserve numeric team id; never raises."""
    if not name:
        return None
    try:
        return _gs_td.lookup_normalized(name)
    except Exception:                                                # noqa: BLE001
        return None


def _mysql_row_to_event(r: dict) -> dict:
    """Project a ``foot_match`` row into the API event shape that the
    sqlite-based code used to emit.  Status derivation mirrors
    ``mysqldb.derive_status``.
    """
    ts = int(r.get("datetime") or 0)
    gid = int(r.get("gid") or 0)
    # Goalserve snap is the single source of truth for every live field
    # (minute / period / HT score / yc / rc / corners / shots / fouls /
    # timeline).   We still consult `mysqldb.derive_status` for the
    # over-arching pending/inplay/settled bucket, but that helper now
    # also uses the snap (see mysqldb.py) so the two stay consistent.
    snap = _gs_live_snap_for_row(gid)
    derived = mysqldb.derive_status(r, snap=snap)
    is_finished = (int(r.get("is_inball") or 0) == 1)
    # Prefer the snap's live score when an inplay snap is available;
    # Crown's foot_match.score_h lags by up to a minute on goal events.
    if snap and not is_finished and snap.get("status") == "inplay":
        score_h = snap.get("score_home") if snap.get("score_home") is not None else r.get("score_h")
        score_a = snap.get("score_away") if snap.get("score_away") is not None else r.get("score_c")
    else:
        score_h = r.get("inball_h") if is_finished else r.get("score_h")
        score_a = r.get("inball_c") if is_finished else r.get("score_c")
    # World Cup fixtures: derive group letter from union-find on the
    # fixture graph (Crown's foot_match has no group column).  Other
    # leagues leave `group` as None so the frontend can decide whether
    # to render group headers at all.
    group_label = None
    if int(r.get("lid") or 0) == _WC_LID:
        try:
            t2g = mysqldb.world_cup_groups().get("team_to_group") or {}
            group_label = (
                t2g.get((r.get("team_h_en") or "").strip())
                or t2g.get((r.get("team_c_en") or "").strip())
            )
        except Exception:                                            # noqa: BLE001
            group_label = None
    return {
        "id":            int(r["gid"]),
        "lid":           int(r.get("lid") or 0),
        "sport_slug":    "football",
        "league_slug":   mysqldb.lid_to_slug(r.get("lid")),
        "league_name":   r.get("league"),
        "home":          r.get("team_h"),
        "away":          r.get("team_c"),
        "home_id":       str(r.get("gnum_h")) if r.get("gnum_h") else r.get("team_h"),
        "away_id":       str(r.get("gnum_c")) if r.get("gnum_c") else r.get("team_c"),
        "commence_iso":  time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)) if ts else None,
        "commence_ts":   ts,
        "status":        derived,
        "score_home":    int(score_h) if score_h is not None else None,
        "score_away":    int(score_a) if score_a is not None else None,
        # Half-time score: prefer the Goalserve snap (live `h1` field),
        # then Crown's `inball_*_hr` (settle_bets.php writes this late).
        "score_home_ht": (snap.get("score_home_ht") if snap and snap.get("score_home_ht") is not None
                          else (int(r["inball_h_hr"]) if r.get("inball_h_hr") not in (None, "") else None)),
        "score_away_ht": (snap.get("score_away_ht") if snap and snap.get("score_away_ht") is not None
                          else (int(r["inball_c_hr"]) if r.get("inball_c_hr") not in (None, "") else None)),
        # Authoritative game-state from Goalserve inplay-soccer.gz (was
        # api-sports.io).   Re-polled every 3s by goalserve_inplay.
        "elapsed_minute":     (snap.get("elapsed_minute") if snap else None),
        "status_short":       (snap.get("status_short")   if snap else None),
        # All physical-event counters come straight off the snap.   None
        # when no snap exists (pre-match or out-of-coverage match);
        # frontend hides the chip row in that case.
        "yc_home":            (snap.get("yc_home")        if snap else None),
        "yc_away":            (snap.get("yc_away")        if snap else None),
        "rc_home":            (snap.get("rc_home")        if snap else None),
        "rc_away":            (snap.get("rc_away")        if snap else None),
        "corners_home":       (snap.get("corners_home")   if snap else None),
        "corners_away":       (snap.get("corners_away")   if snap else None),
        "fouls_home":         (snap.get("fouls_home")     if snap else None),
        "fouls_away":         (snap.get("fouls_away")     if snap else None),
        "shots_home":         (snap.get("shots_home")     if snap else None),
        "shots_away":         (snap.get("shots_away")     if snap else None),
        # Live-event timeline (goals / cards / subs / VAR / corners)
        # parsed from Goalserve's per-fixture `extra` block — the same
        # list /api/external/events/{id}/inplay-events emits.   Empty
        # list when no snap exists.
        "apisports_events":   (snap.get("_inplay_events") or []) if snap else [],
        "group":         group_label,
        "fetched_at":    int(time.time()),
    }


def _looks_chinese(s: str) -> bool:
    """True when the string contains a CJK ideograph (already-Chinese)."""
    return any("\u4e00" <= ch <= "\u9fff" or "\u3400" <= ch <= "\u4dbf" for ch in (s or ""))


def _enrich_crown_with_gs_team_ids(rows: "list[dict]") -> None:
    """For every Crown row that lacks `home_team_gs_id`/`away_team_gs_id`,
    look up the matching Goalserve snap (same gid — Crown and Goalserve
    share an ID space for inplay/pregame matches) and copy the team ids
    over.   Cheap (one tmpfs read per row at worst) and idempotent.

    Used by the /events list + /events/{id} detail handlers so the H5
    frontend's <img src="/api/external/logos/teams/{id}.png"> crest tag
    has an id to substitute even for matches sourced from Crown.
    """
    try:
        from .. import goalserve_inplay as _gs_live  # type: ignore
        from .. import goalserve_pregame as _gs_pre  # type: ignore
    except ImportError:
        try:
            from app import goalserve_inplay as _gs_live  # type: ignore
            from app import goalserve_pregame as _gs_pre  # type: ignore
        except ImportError:
            return
    for r in rows:
        if r.get("home_team_gs_id") and r.get("away_team_gs_id"):
            continue
        try:
            gid = int(r.get("id") or 0)
        except (TypeError, ValueError):
            continue
        if gid <= 0:
            continue
        snap = None
        try:
            snap = _gs_pre.read_event_full(gid) or _gs_live.read_event_full(gid)
        except Exception:  # noqa: BLE001
            snap = None
        if not snap:
            continue
        if not r.get("home_team_gs_id") and snap.get("home_team_gs_id"):
            r["home_team_gs_id"] = snap["home_team_gs_id"]
        if not r.get("away_team_gs_id") and snap.get("away_team_gs_id"):
            r["away_team_gs_id"] = snap["away_team_gs_id"]

    # Name-based fallback via the Goalserve team directory.  Catches the
    # large legacy backlog whose gid never made it to /dev/shm but whose
    # team_h/team_c match (after suffix/case normalisation) a directory
    # entry — gives the crest <img> an id to load, falling back to the
    # initials badge on the onerror hook when the id 404s.
    try:
        from .. import goalserve_team_directory as _td
    except ImportError:
        return
    for r in rows:
        if r.get("home_team_gs_id") and r.get("away_team_gs_id"):
            continue
        if not r.get("home_team_gs_id"):
            tid = _td.lookup_normalized(r.get("home") or "")
            if tid:
                r["home_team_gs_id"] = tid
        if not r.get("away_team_gs_id"):
            tid = _td.lookup_normalized(r.get("away") or "")
            if tid:
                r["away_team_gs_id"] = tid


def _attach_cn(rows: list[dict]) -> None:
    """Attach home_cn / away_cn / league_cn from db_sports.name_cn_cache so
    the long tail of team/league names renders in Chinese on /sports too
    (parity with the PHP api_v2.php path used by /h5).  A missing translation
    leaves the field None; the frontend then uses its curated dict / English.
    """
    names: list[str] = []
    for r in rows:
        for k in ("home", "away", "league_name"):
            v = r.get(k)
            if v:
                names.append(str(v))
    cn = mysqldb.name_cn_map(names) if names else {}
    for r in rows:
        h, a, lg = r.get("home"), r.get("away"), r.get("league_name")
        r["home_cn"] = cn.get(str(h)) if h else None
        r["away_cn"] = cn.get(str(a)) if a else None
        if lg and _looks_chinese(str(lg)):
            r["league_cn"] = str(lg)          # registry already gave Chinese
        else:
            r["league_cn"] = cn.get(str(lg)) if lg else None


def _decode_events(raw: object) -> list[dict]:
    """Parse the JSON-encoded events column into a list of dicts.  Returns
    [] on null/empty/malformed payload — callers (the H5 timeline) rely on
    a list shape so they can ``.map()`` unconditionally.  The column is
    capped at 8KB by the ingest, but truncation can leave invalid JSON;
    we swallow the parse error rather than 500-ing the events endpoint.
    """
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except (ValueError, TypeError):
        return []


def _stats_or_none(r: dict, col: str) -> int | None:
    """Return the numeric column value only if ``apisports_stats_seen_at``
    is fresher than ``_APISPORTS_STATS_MAX_AGE_SEC``.  Hides corners
    that haven't been refreshed by the stats cron — protects the H5
    from displaying half-hour-old numbers when the cron dies.
    """
    val = r.get(col)
    if val in (None, ""):
        return None
    seen = r.get("apisports_stats_seen_at")
    if seen in (None, ""):
        return None
    if time.time() - int(seen) > _APISPORTS_STATS_MAX_AGE_SEC:
        return None
    return int(val)


# Crown ``status`` string → MySQL WHERE clauses for the ``status=`` filter
# parameter on /events.  Kept in one place so /events and /events/{id}
# can agree on what "settled" / "inplay" mean against the MySQL schema.
def _status_filter_sql(status_param: str) -> str:
    if status_param == "pending":
        return "m.is_inball = 0 AND m.status = 0"
    if status_param in ("inplay", "live"):
        return "m.is_inball = 0 AND m.status = 1"
    if status_param in ("settled", "cancelled"):
        return "m.is_inball = 1"
    return "1=1"


@router.get("/events")
def list_events(
    league: str | None = Query(None, description="filter by league_slug"),
    status: str | None = Query(None, description="pending / inplay / settled / cancelled"),
    q: str | None = Query(None, description="free-text on home/away/league_name"),
    min_ts: int | None = Query(None, description="only events with commence_ts >= this"),
    max_ts: int | None = Query(None, description="only events with commence_ts <= this"),
    only_active: bool = Query(False, description="shorthand for status in pending/inplay/live"),
    limit: int = Query(100, ge=1, le=2000),
    offset: int = Query(0, ge=0),
) -> dict:
    where: list[str] = [mysqldb.enabled_lids_sql("m.")]
    # Hide esports / simulated-football fixtures everywhere (the user does not
    # want these PvP-sim matches on the real-football board).  Filtering in SQL
    # keeps `total`/pagination correct; goalserve-merge + frontend isEsports are
    # backstops.  See _esports_exclude_sql for the pattern.
    where.append(_esports_exclude_sql("m."))
    params: list = []
    if league:
        lid = mysqldb.slug_to_lid(league)
        if lid is None:
            # Unknown league_slug → return empty rather than 500
            return {"total": 0, "items": []}
        where.append("m.lid = %s")
        params.append(lid)
    if status:
        where.append("(" + _status_filter_sql(status) + ")")
    if only_active:
        # is_inball=0 alone isn't enough — Crown occasionally leaves
        # rows with status=0/is_inball=0 but a kickoff hours in the past
        # (cron didn't get the settlement signal).  Without the
        # LIVE_WINDOW guard those "zombie" rows would surface here and
        # the frontend's first-item-wins selectedMatch logic would
        # latch onto one, locking the betslip for every match in the
        # list.  Mirror H5's eventStatus() 3h window.
        where.append("m.is_inball = 0")
        where.append(f"m.`datetime` > (UNIX_TIMESTAMP() - {mysqldb.LIVE_WINDOW_SEC})")
    if min_ts is not None:
        where.append("m.`datetime` >= %s")
        params.append(min_ts)
    if max_ts is not None:
        where.append("m.`datetime` <= %s")
        params.append(max_ts)
    if q:
        where.append("(m.team_h LIKE %s OR m.team_c LIKE %s OR m.league LIKE %s)")
        like = f"%{q}%"
        params += [like, like, like]
    where_sql = "WHERE " + " AND ".join(where)

    raw_rows = mysqldb.fetch_all(
        f"""
        SELECT {_MYSQL_EVENT_COLS}
        FROM foot_match m
        {where_sql}
        ORDER BY m.is_inball ASC,
                 (m.status = 1) DESC,
                 m.`datetime` ASC,
                 m.gid ASC
        LIMIT %s OFFSET %s
        """,
        tuple(params + [limit, offset]),
    )
    total_row = mysqldb.fetch_one(
        f"SELECT COUNT(*) AS n FROM foot_match m {where_sql}",
        tuple(params),
    )
    total = int(total_row["n"]) if total_row else 0
    rows = [_mysql_row_to_event(r) for r in raw_rows]
    # Batch English->Chinese display names from name_cn_cache (Wikidata +
    # FIFA + curated imports).  Frontend prefers home_cn/away_cn over its JS
    # dict, so this surfaces the full 4900+ entry translation table.
    try:
        _cn_names = []
        for _r in rows:
            _cn_names.append(_r.get("home"))
            _cn_names.append(_r.get("away"))
            _cn_names.append(_r.get("league_name"))
        _cn_map = mysqldb.name_cn_map(_cn_names)
        for _r in rows:
            _hc = _cn_map.get((_r.get("home") or "").strip())
            _ac = _cn_map.get((_r.get("away") or "").strip())
            _lc = _cn_map.get((_r.get("league_name") or "").strip())
            if _hc: _r["home_cn"] = _hc
            if _ac: _r["away_cn"] = _ac
            if _lc: _r["league_cn"] = _lc
    except Exception:                                                # noqa: BLE001
        pass
    # Normalise BEFORE deciding the data source so `_is_inplay_row`
    # sees the same status the frontend will.  Done in its own pass
    # because the next step needs to know which rows go to /dev/shm vs
    # r_cn so we can skip the wasted r_cn query for in-play rows.
    for row in rows:
        _normalise_event(row)
    # Pregame→inplay decoupling (time-based, name-free).  Probe the live
    # WS snapshot once per Goalserve row and cache it: it both (a) decides
    # which rows are truly in-play and (b) lets us hide a GS row whose
    # pre-match book has closed (kickoff − GS_PREGAME_CLOSE_LEAD_SEC passed)
    # but which has no live snap yet.  Hiding it stops stale pre-match
    # prices leaking into 滚球; the match resurfaces independently under its
    # in-play gid the moment the WS pushes a live snapshot.
    _gs_snap_by_id = {
        row["id"]: _read_shm_cache(row["id"]) for row in rows if _is_gs_event(row)
    }
    _kept = [
        row for row in rows
        if not (_is_gs_event(row)
                and _gs_snap_by_id.get(row["id"]) is None
                and _pregame_closed(row.get("commence_ts")))
    ]
    if len(_kept) != len(rows):
        total -= (len(rows) - len(_kept))
        rows = _kept
    # r_cn is loaded for every row: pre-match/settled rows consume it as
    # their canonical source, and in-play rows use it as a FALLBACK when
    # the /dev/shm goalserve_live snap is missing/stale (poller may have
    # lagged on this gid, but goalserve_dbwriter keeps r_cn current as
    # refreshes r_cn with the same live odds every 2 min).
    markets_by_event = _load_rcn_markets([r["id"] for r in rows])
    # Per-event "already decided" filter: drops Totals/BTTS/AGS rows
    # whose outcome is locked by the live score+events.  Keyed by gid
    # so each event is filtered against its own live state.  See
    # `_apply_decided_filters` for the full lock-rule catalog.
    rows_by_id = {row["id"]: row for row in rows}
    filtered_markets_by_event: "dict[int, list[dict]]" = {}
    for gid, ms in markets_by_event.items():
        if not ms:
            filtered_markets_by_event[gid] = ms
            continue
        ev_row = rows_by_id.get(gid)
        filtered_markets_by_event[gid] = (
            _apply_decided_filters(ev_row, ms) if ev_row is not None else ms
        )
    sqlite_mo = {
        gid: _main_odds_from_ws_snap({"markets": ms})
        for gid, ms in filtered_markets_by_event.items() if ms
    }
    ex_map = {
        gid: [
            {"name": m["name"], "outcomes": len(m.get("odds") or [])}
            for m in ms
            if isinstance(m, dict) and m.get("name") and m["name"] not in _INLINED_MARKETS
        ]
        for gid, ms in filtered_markets_by_event.items()
    }
    for row in rows:
        # Goalserve rows are in-play ONLY when a fresh live snap exists
        # (cached above); Crown-native rows keep the legacy predicate.
        _gs = _is_gs_event(row)
        _live = (_gs_snap_by_id.get(row["id"]) is not None) if _gs else _is_inplay_row(row)
        if _live:
            # In-play: prefer the /dev/shm WS snapshot; fall back to the
            # r_cn snapshot when the relay hasn't pushed this gid (the
            # goalserve_live snap missing for this gid).
            # goalserve_dbwriter keeps r_cn current with the same live
            # odds every 2 min, so this surfaces 滚球 instead of an empty row.
            snap = _gs_snap_by_id.get(row["id"]) if _gs else _read_shm_cache(row["id"])
            # The relay (goalserve_inplay_ws -> normalize_event) writes the
            # live snapshot with a PRE-COMPUTED `main_odds` (the exact 9-col
            # shape the H5 list view + the browser WS frames consume) and
            # stores the market list under `_markets` (raw goalserve
            # `market_name`).  The previous code recomputed main_odds from
            # `snap["markets"]`, but that key is now ALWAYS empty, so every
            # in-play row silently fell back to the r_cn snapshot (refreshed
            # only every ~2 min) — the cause of stale / "wrong" 滚球 odds,
            # including 首页独赢.   Use the precomputed main_odds directly,
            # exactly like the WS `update` frame does, so the list paint
            # matches the live socket updates instead of lagging them.
            ws_mo = (snap or {}).get("main_odds")
            ws_markets = (snap or {}).get("_markets") or (snap or {}).get("markets") or []
            if snap and isinstance(ws_mo, dict) and any(ws_mo.values()):
                row["main_odds"] = ws_mo
                row["market_count"] = sum(
                    1 for m in ws_markets
                    if isinstance(m, dict) and (m.get("market_name") or m.get("name"))
                )
                # The +N badge counts the drill-in markets; rebuild from the
                # WS payload (raw goalserve names live under `market_name`).
                row["extra_markets"] = [
                    {"name": (m.get("market_name") or m.get("name")),
                     "outcomes": len(m.get("odds") or [])}
                    for m in ws_markets
                    if isinstance(m, dict)
                    and (m.get("market_name") or m.get("name"))
                    and (m.get("market_name") or m.get("name")) not in _INLINED_MARKETS
                ]
            else:
                mo = sqlite_mo.get(row["id"])
                row["main_odds"] = mo if mo and any(mo.values()) else None
                row["extra_markets"] = ex_map.get(row["id"], [])
                row["market_count"] = len(filtered_markets_by_event.get(row["id"]) or [])
        else:
            # Pre-match (pending) — r_cn snapshot is canonical.
            # Settled / cancelled — r_cn still has the closing prices
            # but they're not bookable; that's enforced separately by
            # the place-bet handler's activeOddsContext check.
            mo = sqlite_mo.get(row["id"])
            row["main_odds"] = mo if mo and any(mo.values()) else None
            row["extra_markets"] = ex_map.get(row["id"], [])
            row["market_count"] = len(filtered_markets_by_event.get(row["id"]) or [])
    _attach_cn(rows)
    # Crown rows lack the goalserve numeric team ids that drive the
    # H5 <img> crest endpoint — populate them from the matching GS
    # snap when one exists for the same gid (most prematch matches do).
    _enrich_crown_with_gs_team_ids(rows)
    # Merge Goalserve events (keyed by Goalserve id) as additional items.
    # Only on the first page and when not filtering by a Crown league_slug.
    if _INCLUDE_GS and offset == 0 and not league:
        gs_items = _goalserve_merge_list(status, only_active, q, min_ts, max_ts)
        seen_ids = {r["id"] for r in rows}
        gs_items = [e for e in gs_items if e["id"] not in seen_ids]
        # Goalserve snapshots (in-play /dev/shm + pregame) carry
        # league_cn/home_cn/away_cn = None, and they are appended AFTER the
        # `_attach_cn(rows)` call above — so without this they would render in
        # English (the 滚球 board's untranslated league/team names).  Run the
        # SAME name_cn_cache lookup pregame DB rows already get so in-play
        # cards reference the identical translation source.  Operates only on
        # the merge-list items, so the pregame DB-row path is untouched.
        _attach_cn(gs_items)
        rows = rows + gs_items
        total += len(gs_items)
    # Name-based pregame↔in-play dedup RETIRED (2026-06): the pregame book
    # now closes GS_PREGAME_CLOSE_LEAD_SEC before kickoff (hidden above) and
    # the in-play row stands alone under its own gid, so there is no
    # same-match duplicate to collapse — and we never risk deleting a
    # legitimate independent row by fuzzy name match.  `_dedup_same_match`
    # is kept as dead code; re-enable only if a concrete case needs it.
    for _r in rows:
        if isinstance(_r.get("main_odds"), dict):
            _r["main_odds"] = _haircut_main_odds(_r["main_odds"])
    return {"total": total, "items": rows}


@router.get("/events/{event_id}")
def get_event(event_id: int) -> dict:
    raw = mysqldb.fetch_one(
        f"""
        SELECT {_MYSQL_EVENT_COLS}
        FROM foot_match m
        WHERE m.gid = %s
        """,
        (event_id,),
    )
    if not raw:
        gs = _goalserve_event_full(event_id)
        if gs:
            ev = {k: v for k, v in gs.items() if not k.startswith("_")}
            if isinstance(ev.get("main_odds"), dict):
                ev["main_odds"] = _haircut_main_odds(ev["main_odds"])
            return ev
        raise HTTPException(status_code=404, detail="event not found")
    row = _mysql_row_to_event(raw)
    # Normalise BEFORE main-odds projection so `_apply_decided_filters`
    # sees the same status the list endpoint uses.
    _normalise_event(row)
    # Pregame→inplay time cutoff: a Goalserve row whose pre-match book has
    # closed (kickoff − lead passed) with no live snap yet carries no
    # bookable odds — mark it closed so the detail card matches the list.
    if _gs_pregame_hidden(row):
        row["status"] = "closed"
        row["main_odds"] = None
        row["extra_markets"] = []
        _attach_cn([row])
        _enrich_crown_with_gs_team_ids([row])
        return row
    # Pass the row through so the in-play "already decided" filters
    # (Totals over 2.5 already reached, BTTS Yes locked, AGS player
    # already scored) can scrub the inline pill on the detail page too.
    rows_by_id = {row["id"]: row}
    mo_map = _batch_main_odds([row["id"]], rows_by_id)
    mo = mo_map.get(row["id"])
    row["main_odds"] = mo if mo and any(mo.values()) else None
    if isinstance(row.get("main_odds"), dict):
        row["main_odds"] = _haircut_main_odds(row["main_odds"])
    ex_map = _batch_extra_markets([row["id"]], rows_by_id)
    row["extra_markets"] = ex_map.get(row["id"], [])
    _attach_cn([row])
    _enrich_crown_with_gs_team_ids([row])
    return row


# ---------------------------------------------------------------------------
# Markets

@router.get("/events/{event_id}/markets")
def list_markets(event_id: int) -> dict:
    """Return markets grouped by bookmaker, with the raw ``odds`` array
    decoded to JSON so the frontend can render whatever variant it
    understands without re-parsing strings.

    Source dispatch by status (WS-only invariant for in-play):
      * settled / cancelled → empty bookmakers + ``source="finished"``
      * inplay / live       → /dev/shm WS cache only (``source="ws_live"``)
                              — pre-match prices must not leak through
                              and accidentally be bookable.
      * pre-match (pending) → MySQL ``r_cn`` (``source="r_cn_snapshot"``)
    """
    raw = mysqldb.fetch_one(
        f"""
        SELECT {_MYSQL_EVENT_COLS}
        FROM foot_match m
        WHERE m.gid = %s
        """,
        (event_id,),
    )
    if not raw:
        gs = _goalserve_event_full(event_id)
        if gs:
            ev = {k: v for k, v in gs.items() if not k.startswith("_")}
            finished = bool(gs.get("is_finished"))
            # Pregame→inplay time cutoff: within GS_PREGAME_CLOSE_LEAD_SEC
            # of kickoff with no live snap → pre-match book closed.  Report
            # closed so stale pre-match prices can't render or be booked.
            if not finished and not _gs_has_live(event_id) and _pregame_closed(ev.get("commence_ts")):
                ev["status"] = "closed"
                return {"event": ev, "bookmakers": [], "total_markets": 0, "source": "closed"}
            gmarkets = gs.get("_markets") or []
            # Apply the in-play "already decided" outcome/market filters here
            # too: this Goalserve-snapshot fallback (no foot_match row) serves
            # the raw book, which otherwise bypasses every decided filter —
            # leaving dead legs (settled HT/FT, decided totals, Nth-goal, …)
            # bookable for matches that exist only under their live GS gid.
            if not finished:
                gmarkets = _apply_decided_filters(ev, gmarkets)
                gmarkets = _haircut_market_rows(gmarkets)
            bms = [] if finished else [{
                "bookmaker": gs.get("_bm") or "bet365",
                "markets": gmarkets,
                "market_count": len(gmarkets),
            }]
            return {
                "event": ev,
                "bookmakers": bms,
                "total_markets": 0 if finished else len(gmarkets),
                "source": ("finished" if finished
                           else ("ws_live" if _gs_has_live(event_id) else "r_cn_snapshot")),
            }
        raise HTTPException(status_code=404, detail="event not found")
    event = _mysql_row_to_event(raw)
    _normalise_event(event)

    if event.get("is_finished"):
        return {"event": event, "bookmakers": [], "total_markets": 0, "source": "finished"}

    # Pregame→inplay time cutoff (Goalserve rows only): once within
    # GS_PREGAME_CLOSE_LEAD_SEC of kickoff with no live snap yet, the
    # pre-match book is closed.  Report it explicitly so stale pre-match
    # prices can't render in 滚球 or be booked — the PHP place-bet
    # validator maps event.status=closed / empty markets → reject, and the
    # live match resurfaces under its own in-play gid once the WS pushes.
    if _gs_pregame_hidden(event):
        event["status"] = "closed"
        return {"event": event, "bookmakers": [], "total_markets": 0, "source": "closed"}

    # Prefer the full multi-line goalserve book (every handicap / total line)
    # written by the goalserve_pregame / goalserve_inplay pollers. Falls back to single-
    # line r_cn below when unavailable. For in-play matches we keep the
    # "ws_live" source label so the frontend treats the lines as bookable
    # (the WS-only invariant is about freshness, and this file is ≤2 min old).
    full = _load_full_market_book(event_id)
    if full:
        full = _apply_decided_filters(event, full)
        live = _serve_inplay(event)
        # Prepend canonical field-keyed markets (ML pinned to id "000001",
        # {home,draw,away}/{over,under,hdp} rows) projected from main_odds so the
        # PHP place-bet validator (locateMarketLine — matches field-keyed rows,
        # NOT Goalserve's RAW {selection,price} passthrough) can validate the H5
        # main-market buttons.  Without it BOTH in-play and pregame main bets
        # reject `market_not_open`.  Raw twins of the emitted canon markets are
        # dropped so a main market isn't shown / booked twice; the rest (corner
        # races, interval 1x2, correct score, clean sheet, …) stay as drill-in
        # extras for the detail view.
        if live:
            # In-play: main_odds from the live /dev/shm snapshot; drop twins by
            # the Goalserve inplay market-id map (GS_CANON).
            snap = _read_shm_cache(event_id)
            canon = _canonical_markets_from_main_odds((snap or {}).get("main_odds"), synth_neighbors=True)
            if canon:
                try:
                    from ..goalserve_inplay import GS_CANON as _GS_CANON
                except Exception:                                    # noqa: BLE001
                    _GS_CANON = {}
                emitted = {m["market_name"] for m in canon}
                drop_ids = {gid for gid, cname in _GS_CANON.items() if cname in emitted}
                def _is_emitted_twin(m: dict) -> bool:
                    try:
                        return int(m.get("market_id_int") or 0) in drop_ids
                    except (TypeError, ValueError):
                        return False
                extras = [m for m in full if not _is_emitted_twin(m)]
                full = canon + extras
        else:
            # Pregame: main_odds from the pregame /dev/shm snapshot; drop twins
            # by the pregame market `value`→canonical map (PRE_CANON) AND any raw
            # market whose 6-digit id collides with a canon id — pregame feed ids
            # start at 000001 and overlap the canon sequence (unlike inplay ids),
            # so an un-dropped collision would shadow a canon market in the
            # validator and mis-match the bet.
            try:
                from ..goalserve_pregame import (
                    read_event_full as _pre_full, PRE_CANON as _PRE_CANON)
            except Exception:                                        # noqa: BLE001
                _pre_full, _PRE_CANON = (lambda _g: None), {}
            snap = _pre_full(event_id)
            canon = _canonical_markets_from_main_odds((snap or {}).get("main_odds"))
            if canon:
                emitted = {m["market_name"] for m in canon}
                canon_ids = {m["market_id"] for m in canon}
                def _is_pre_twin(m: dict) -> bool:
                    cname = _PRE_CANON.get((m.get("market_name") or "").strip().lower())
                    return (cname in emitted) or (str(m.get("market_id") or "") in canon_ids)
                extras = [m for m in full if not _is_pre_twin(m)]
                full = canon + extras
        full = _haircut_market_rows(full)
        return {
            "event":         event,
            "bookmakers":    [{"bookmaker": "Bet365", "markets": full, "market_count": len(full)}],
            "total_markets": len(full),
            "source":        "ws_live" if live else "r_cn_snapshot",
        }

    if _serve_inplay(event):
        # Prefer the /dev/shm WS snapshot; if it's missing/empty (the
        # goalserve_live snap missing for this gid) fall
        # through to the r_cn path below, which goalserve_dbwriter keeps
        # current with the same live odds every 2 min.
        snap = _read_shm_cache(event_id)
        ws_markets = (snap.get("markets") or []) if snap else []
        markets = []
        if snap:
            bookie = str(snap.get("bookie") or "Bet365")
            for idx, m in enumerate(ws_markets, start=1):
                if not isinstance(m, dict) or not m.get("name"):
                    continue
                updated_iso = m.get("updatedAt")
                markets.append({
                    "market_id":     f"{idx:06d}",
                    "market_id_int": idx,
                    "market_name":   m["name"],
                    "odds":          m.get("odds") or [],
                    "updated_at_iso": updated_iso,
                    "updated_at_ts":  _iso_to_epoch(updated_iso),
                })
        if markets:
            markets = _apply_decided_filters(event, markets)
            markets = _haircut_market_rows(markets)
            bookmakers = [{"bookmaker": bookie, "markets": markets, "market_count": len(markets)}]
            return {
                "event":         event,
                "bookmakers":    bookmakers,
                "total_markets": len(markets),
                "source":        "ws_live",
            }
        # else: drop into the r_cn path below (source="r_cn_snapshot")

    # Pre-match path — read r_cn from MySQL and decode.  The parser
    # emits a single canonical market list (matches what Crown PHP
    # ingest writes via OddsApiToCrownXml), so we surface it under the
    # single ``"Bet365"`` bookmaker key.  Multi-book pre-match views are
    # not currently produced by the upstream ingest (it writes one
    # bookmaker into r_cn); restore them by parsing additional snapshots
    # if that requirement returns.
    xml_row = mysqldb.fetch_one(
        "SELECT r_cn FROM foot_match_xml WHERE gid = %s",
        (event_id,),
    )
    markets = parse_rcn_markets((xml_row or {}).get("r_cn") or "")
    markets = _apply_decided_filters(event, markets)
    markets = _haircut_market_rows(markets)
    # Source label drives the H5 frontend's bookability gate:
    # `stalePrematch = isInplay && source !== "ws_live"` locks in-play bets.
    # goalserve_dbwriter refreshes r_cn with
    # LIVE odds every 2 min, so an in-play match served from r_cn carries
    # current, bookable prices — label it "ws_live" so betting isn't locked.
    # Pre-match keeps "r_cn_snapshot" (already bookable; isInplay=false).
    src = "ws_live" if _serve_inplay(event) else "r_cn_snapshot"
    if not markets:
        return {
            "event": event,
            "bookmakers": [],
            "total_markets": 0,
            "source": src,
        }
    bookmakers = [{
        "bookmaker":    "Bet365",
        "markets":      markets,
        "market_count": len(markets),
    }]
    return {
        "event": event,
        "bookmakers": bookmakers,
        "total_markets": len(markets),
        "source": src,
    }


def _iso_to_epoch(iso: str | None) -> int | None:
    """Parse an ISO-8601 string (with optional `Z` UTC suffix) into a
    Unix epoch second.  Used by the in-play markets path to attach an
    `updated_at_ts` to each WS-derived market for the H5 frontend's
    "x秒前更新" badge.
    """
    if not iso:
        return None
    s = iso.replace("Z", "+00:00") if iso.endswith("Z") else iso
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(s).timestamp())
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# WebSocket — push odds-api.io updates to the browser.

@router.get("/ws/status")
def ws_status(request: Request) -> dict:
    """Diagnostics for the realtime bridge.  Reports goalserve_inplay_ws
    state by default (the primary live odds source); falls back to the
    legacy oddsapi_ws bridge when goalserve is unavailable so existing
    callers don't break.  Field shape is stable across both backends."""
    gs = getattr(request.app.state, "gs_ws", None)
    if gs is not None:
        return {
            "enabled":             True,
            "source":              "goalserve",
            "connected":           getattr(gs, "connected", False),
            "reconnects":          getattr(gs, "connect_attempts", 0),
            "messages_received":   getattr(gs, "messages_received", 0),
            "messages_dispatched": getattr(gs, "messages_dispatched", 0),
            "last_message_at":     getattr(gs, "last_message_at", None),
            "subscribers":         len(getattr(gs, "_subs", [])),
        }
    bridge = getattr(request.app.state, "odds_ws", None)
    if bridge is None:
        return {"enabled": False, "reason": "ODDS_API_KEY not set on backend"}
    return {
        "enabled":             True,
        "source":              "oddsapi",
        "connected":           bridge.connected,
        "reconnects":          bridge.reconnects,
        "messages_received":   bridge.messages_received,
        "messages_dispatched": bridge.messages_dispatched,
        "last_message_at":     bridge.last_message_at,
        "subscribers":         len(bridge._subs),  # noqa: SLF001
    }


@router.websocket("/ws")
async def ws_endpoint(
    ws: WebSocket,
    eventIds: str | None = Query(None, description="comma-separated event ids to filter"),
):
    """Browser-facing WebSocket — gs_ws fan-out.

    Goalserve_inplay_ws is the primary source.  When it's enabled the WS
    pushes ``{type: 'update', id, snap}`` frames where ``snap`` is the
    same shape as ``/api/external/events/{id}/markets``.  Heartbeat
    ``ping`` frames every 25s keep Cloudflare happy.

    Falls back to the legacy oddsapi_ws bridge ONLY when goalserve is
    not configured (no GOALSERVE creds), so older clients pinned to the
    odds-api wire format keep working.
    """
    gs = getattr(ws.app.state, "gs_ws", None)
    if gs is not None and hasattr(gs, "subscribe"):
        bridge = gs
        source = "goalserve"
    else:
        bridge = getattr(ws.app.state, "odds_ws", None)
        source = "oddsapi"
    if bridge is None:
        await ws.accept()
        await ws.send_json({"type": "error", "error": "ws_bridge_disabled"})
        await ws.close(code=1011)
        return

    # Parse the optional event-id filter once.
    filter_ids: set[str] | None = None
    if eventIds:
        filter_ids = {s.strip() for s in eventIds.split(",") if s.strip()}

    await ws.accept()
    q = await bridge.subscribe()
    log.info("ws client connected (filter=%s, subs=%d)", filter_ids, len(bridge._subs))  # noqa: SLF001

    # Initial hello so the client knows the pipe is alive.
    import time
    await ws.send_json({
        "type":      "hello",
        "source":    source,
        "filter":    sorted(filter_ids) if filter_ids else None,
        "server_ts": int(time.time() * 1000),
    })

    try:
        # Two concurrent tasks: relay upstream → client, and read client →
        # upstream (so we notice a disconnect quickly).
        # Heartbeat: Cloudflare drops idle WS at ~100s. When the upstream is
        # quiet (no matching tick for the filter) we send a tiny `ping` every
        # 25s so the connection stays warm and the browser keeps `wsConnected`
        # truthy.
        async def relay():
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=25.0)
                except asyncio.TimeoutError:
                    await ws.send_json({
                        "type":      "ping",
                        "server_ts": int(time.time() * 1000),
                    })
                    continue
                if filter_ids is not None and str(msg.get("id") or "") not in filter_ids:
                    continue
                msg = dict(msg)
                if isinstance(msg.get("snap"), dict):
                    msg["snap"] = _haircut_snap(msg["snap"])
                msg["server_ts"] = int(time.time() * 1000)
                await ws.send_json(msg)

        async def reader():
            # We don't expect any inbound messages — just want to know
            # when the client closes the socket.
            while True:
                await ws.receive_text()

        relay_t  = asyncio.create_task(relay())
        reader_t = asyncio.create_task(reader())
        done, pending = await asyncio.wait(
            {relay_t, reader_t},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for t in pending:
            t.cancel()
            with suppress(asyncio.CancelledError):
                await t
        for t in done:
            exc = t.exception()
            if exc:
                raise exc
    except WebSocketDisconnect:
        pass
    except Exception as e:                                          # noqa: BLE001
        log.warning("ws relay error: %s", e)
    finally:
        await bridge.unsubscribe(q)
        with suppress(Exception):
            await ws.close()


# ────────────────────────────────────────────────────────────────────────
# Goalserve inplay events + logo proxy   (added by logo/events patch).
#
# `/api/external/events/{eid}/inplay-events`
#     Returns the timeline of goals/cards/corners/subs parsed from
#     Goalserve's `extra` block (see goalserve_inplay._extract_inplay_events).
#     Shape: { ok, source:"goalserve", events:[{type,label,minute,team,...}] }
#     For event ids the inplay poller hasn't seen yet, returns
#     `{ok:true, events:[]}` (NOT 404) so the frontend can render an
#     empty timeline without showing an error banner.
#
# `/api/external/logos/{cat}/{id}.png`
#     Server-side proxy + disk cache for Goalserve's logo CDN
#     (`http://data2.goalserve.com:8084/api/v1/logotips/soccer/{cat}?ids=`).
#     Cached forever at $LOGO_CACHE_DIR/{cat}/{id}.png; 404 responses are
#     also cached (as zero-byte files) for $LOGO_NEG_TTL seconds so we
#     don't hammer upstream for known-missing IDs.   Cache-Control headers
#     allow the browser AND Cloudflare to cache for a long time.

_LOGO_CACHE_DIR = _logo_Path(_logo_os.environ.get("LOGO_CACHE_DIR", "/var/lib/pmppm/logos"))
_LOGO_NEG_TTL = float(_logo_os.environ.get("LOGO_NEG_TTL", "21600"))   # 6h
_LOGO_UPSTREAM = _logo_os.environ.get(
    "LOGO_UPSTREAM_BASE",
    "http://data2.goalserve.com:8084/api/v1/logotips/soccer",
)
_LOGO_API_KEY = _logo_os.environ.get("GS_API_KEY", "3416f409c2584c9e081c08debf8ab4bb")
_LOGO_CATEGORIES = {"teams", "leagues", "players", "playerphoto"}
_LOGO_HTTP_TIMEOUT = float(_logo_os.environ.get("LOGO_HTTP_TIMEOUT", "8"))


def _logo_path(cat: str, gid: int) -> _logo_Path:
    return _LOGO_CACHE_DIR / cat / f"{int(gid)}.png"


def _logo_fetch(cat: str, gid: int) -> "bytes | None":
    """Pull one logo from Goalserve and return raw PNG bytes.

    The upstream endpoint speaks JSON — it never returns a binary
    image directly.   Wire shape per https://www.goalserve.com/en/blog/...
    is a one-element array containing a base64-encoded PNG:
        [{"id": 12825, "base64": "iVBORw0KGgoAAAA..."}]
    We parse the JSON, b64-decode the `base64` field, and verify the
    bytes start with the standard 8-byte PNG signature so we never
    cache garbage (e.g. when goalserve responds with `[]` for a missing
    logo).   Any failure returns None so the caller can negative-cache.
    """
    import base64 as _b64
    import json as _json
    url = f"{_LOGO_UPSTREAM}/{cat}?k={_LOGO_API_KEY}&ids={int(gid)}"
    try:
        req = _logo_urlreq.Request(url, headers={"User-Agent": "pmppm-logo-proxy/1.0"})
        with _logo_urlreq.urlopen(req, timeout=_LOGO_HTTP_TIMEOUT) as r:
            raw = r.read()
            ct = (r.headers.get("Content-Type") or "").lower()
            if not raw or "html" in ct:
                return None
    except _logo_urlerr.HTTPError as e:
        # 429 / 5xx are transient — signal caller via exception (don't neg-cache).
        if hasattr(e, "code") and (e.code == 429 or e.code >= 500):
            raise
        return None
    except (_logo_urlerr.URLError, TimeoutError, OSError):
        return None
    # Some upstream variants used to serve PNG directly; keep that path
    # working too by detecting the PNG signature first.
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return raw
    try:
        payload = _json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(payload, list) or not payload:
        return None
    item = payload[0] if isinstance(payload[0], dict) else None
    if not item:
        return None
    b64s = item.get("base64") or item.get("data") or ""
    if not isinstance(b64s, str) or not b64s:
        return None
    try:
        png = _b64.b64decode(b64s, validate=False)
    except (ValueError, Exception):  # noqa: BLE001
        return None
    if not png or png[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return png


def _logo_fetch_player_photo(pid: int) -> "bytes | None":
    """Player headshot from Goalserve's player-profile feed
    (`soccerstats/player/{id}` -> <image>base64 PNG</image>).  The logotips
    `players` category is rate-limited/empty on our key, but the profile feed
    carries a reliable photo.   Cached in /dev/shm via _gs_feed_get."""
    import base64 as _b64
    import re as _re2
    raw = _gs_feed_get(f"soccerstats/player/{int(pid)}", ttl=604800)   # 7d
    if not raw:
        return None
    try:
        text = raw.decode("utf-8", "ignore")
    except Exception:  # noqa: BLE001
        return None
    m = _re2.search(r"<image>\s*([^<\s][^<]*?)\s*</image>", text)
    if not m:
        return None
    try:
        png = _b64.b64decode(m.group(1).strip(), validate=False)
    except Exception:  # noqa: BLE001
        return None
    if not png or png[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return png


@router.get("/events/{event_id}/inplay-events")
def event_inplay_events(event_id: str) -> dict:
    """Goalserve-derived live event timeline.   Reads the cached snapshot
    written by goalserve_inplay; never blocks on upstream."""
    from pathlib import Path as _p
    import json as _json
    snap_file = _p(_logo_os.environ.get("GS_LIVE_DIR", "/dev/shm/goalserve_live")) / f"{event_id}.json"
    if not snap_file.is_file():
        # Try the pregame cache as a fallback (most pregame events have no
        # inplay events but the endpoint shape should be consistent).
        snap_file = _p(_logo_os.environ.get("GS_PREGAME_DIR", "/dev/shm/goalserve_pregame")) / f"{event_id}.json"
        if not snap_file.is_file():
            return {"ok": True, "source": "goalserve", "events": [], "reason": "no_snapshot"}
    try:
        with snap_file.open("r", encoding="utf-8") as fh:
            snap = _json.load(fh)
    except (OSError, ValueError):
        return {"ok": True, "source": "goalserve", "events": [], "reason": "snap_read_error"}
    events = snap.get("_inplay_events") or []
    return {
        "ok": True,
        "source": "goalserve",
        "mapped": True,
        "event_id": event_id,
        "home": snap.get("home"),
        "away": snap.get("away"),
        "events": events,
    }


# ===========================================================================
# Goalserve match-info panels:  标准的 standings / lineups / h2h / timeline
# powered by two getfeed endpoints (cached in /dev/shm):
#   * standings/{leagueId}.xml                        → 积分榜
#   * soccerfixtures/league/{leagueId}?date_start..   → 阵容 / 时间线 / 交锋历史
# leagueId is derived from foot_match.lid (lid − GS_LID_BASE).  Every
# endpoint returns the EXACT shape the H5 modal renderers already expect
# and degrades to {ok:True, mapped:False} (never 500) so the pane shows its
# graceful "暂无…" placeholder when data is missing.
# ===========================================================================
_GS_FEED_KEY  = _os.environ.get("GS_API_KEY", "3416f409c2584c9e081c08debf8ab4bb")
_GS_FEED_BASE = _os.environ.get("GS_FEED_BASE", "http://www.goalserve.com/getfeed")
_GS_FEED_CACHE = _pathlib.Path(_os.environ.get("GS_FEED_CACHE_DIR", "/dev/shm/gs_feedcache"))
_GS_FEED_TIMEOUT = float(_os.environ.get("GS_FEED_TIMEOUT", "10"))


def _gs_to_int(v):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def _gs_norm_team(s: "str | None") -> str:
    """Normalise a team name for cross-feed matching: lowercase, strip
    accents, drop punctuation + common suffixes (FC / CF / 2 …)."""
    import unicodedata as _ud
    import re as _re
    if not s:
        return ""
    t = _ud.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii").lower()
    t = _re.sub(r"[^a-z0-9 ]+", " ", t)
    t = _re.sub(r"\b(fc|cf|sc|afc|ac|ss|us|cd|club|de|the)\b", " ", t)
    return _re.sub(r"\s+", " ", t).strip()


def _gs_feed_get(path: str, ttl: float = 300.0) -> "bytes | None":
    """GET getfeed/{key}/{path} with a /dev/shm TTL cache.  Serves a stale
    cached copy on upstream failure.  Returns None when nothing is available."""
    safe = "".join(c if (c.isalnum() or c in "._-") else "_" for c in path)
    cache = _GS_FEED_CACHE / safe
    try:
        st = cache.stat()
        if (time.time() - st.st_mtime) < ttl:
            return cache.read_bytes()
    except OSError:
        pass
    url = f"{_GS_FEED_BASE}/{_GS_FEED_KEY}/{path}"
    try:
        req = _logo_urlreq.Request(url, headers={"User-Agent": "pmppm-matchinfo/1.0"})
        with _logo_urlreq.urlopen(req, timeout=_GS_FEED_TIMEOUT) as r:
            raw = r.read()
    except Exception:  # noqa: BLE001 — network/parse errors fall back to cache
        try:
            return cache.read_bytes()
        except OSError:
            return None
    if not raw:
        try:
            return cache.read_bytes()
        except OSError:
            return None
    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(raw)
    except OSError:
        pass
    return raw


def _gs_match_ctx(gid: int) -> "dict | None":
    """foot_match row + derived Goalserve league id for a gid."""
    try:
        r = mysqldb.fetch_one(
            "SELECT gid, team_h, team_c, league, lid, `datetime` "
            "FROM foot_match WHERE gid = %s LIMIT 1",
            (int(gid),),
        )
    except Exception:  # noqa: BLE001
        return None
    if not r:
        return None
    lid = int(r.get("lid") or 0)
    gsl = lid - _GS_LID_BASE
    # Hash-bucketed (non-numeric) GS slugs live at base+500000+ → invalid here.
    r["_gs_league_id"] = gsl if (0 < gsl < 500000) else None
    return r


def _gs_find_match(root, team_h: str, team_c: str):
    """Locate the <match> for our fixture inside a soccerfixtures feed.
    Returns (match_el, flipped) where flipped=True when the feed's
    localteam is actually our away side."""
    nh, nc = _gs_norm_team(team_h), _gs_norm_team(team_c)
    for mt in root.iter("match"):
        lt = mt.find("localteam")
        vt = mt.find("visitorteam")
        if lt is None or vt is None:
            continue
        ln, vn = _gs_norm_team(lt.get("name")), _gs_norm_team(vt.get("name"))
        if {ln, vn} == {nh, nc} and ln != vn:
            return mt, (ln != nh)
    return None, False


def _gs_fixture_dates(ts: int, span: int = 1) -> str:
    """date_start/date_end query (±span days around the kickoff)."""
    base = int(ts or time.time())
    d0 = time.strftime("%d.%m.%Y", time.gmtime(base - span * 86400))
    d1 = time.strftime("%d.%m.%Y", time.gmtime(base + span * 86400))
    return f"date_start={d0}&date_end={d1}"


@router.get("/events/{event_id}/standings")
def event_standings(event_id: int) -> dict:
    import xml.etree.ElementTree as _ET
    ctx = _gs_match_ctx(event_id)
    if not ctx:
        return {"ok": True, "mapped": False}
    league_name = ctx.get("league")
    gsl = ctx.get("_gs_league_id")
    if not gsl:
        return {"ok": True, "mapped": False, "league_name": league_name}
    raw = _gs_feed_get(f"standings/{gsl}.xml", ttl=900)
    if not raw:
        return {"ok": True, "mapped": False, "league_name": league_name}
    try:
        root = _ET.fromstring(raw)
    except _ET.ParseError:
        return {"ok": True, "mapped": False, "league_name": league_name}
    rows = []
    for tm in root.iter("team"):
        a = tm.attrib
        ov = tm.find("overall")
        tot = tm.find("total")
        o = ov.attrib if ov is not None else {}
        t = tot.attrib if tot is not None else {}
        pts = t.get("p") if t.get("p") not in (None, "") else a.get("points")
        rows.append({
            "rank": _gs_to_int(a.get("position")),
            "team_id": _gs_to_int(a.get("id")),
            "team_name": a.get("name") or "",
            "played": _gs_to_int(o.get("gp")),
            "win": _gs_to_int(o.get("w")),
            "draw": _gs_to_int(o.get("d")),
            "lose": _gs_to_int(o.get("l")),
            "goals_for": _gs_to_int(o.get("gs")),
            "goals_against": _gs_to_int(o.get("ga")),
            "points": _gs_to_int(pts),
            "form": (a.get("recent_form") or "").replace(" ", ""),
        })
    if not rows:
        return {"ok": True, "mapped": False, "league_name": league_name}
    nh, nc = _gs_norm_team(ctx.get("team_h")), _gs_norm_team(ctx.get("team_c"))
    home_id = away_id = None
    for r in rows:
        n = _gs_norm_team(r["team_name"])
        if n == nh:
            home_id = r["team_id"]
        elif n == nc:
            away_id = r["team_id"]
    # League name from the feed root when foot_match has none.
    if not league_name:
        tour = root.find(".//tournament")
        if tour is not None:
            league_name = tour.get("league") or tour.get("name")
    return {
        "ok": True, "mapped": True, "league_name": league_name,
        "home_team_id": home_id, "away_team_id": away_id, "standings": rows,
    }


# Goalserve numeric league id for the FIFA World Cup feed (standings carry one
# <tournament> per group; soccerleague/{id} carries per-player goals/assists).
# Override via env if Goalserve re-keys the competition.
_GS_WC_LEAGUE_ID = int(_os.environ.get("GS_WC_LEAGUE_ID") or 1056)


@router.get("/worldcup")
def world_cup_overview() -> dict:
    """World Cup group standings + top scorers, projected for the standalone
    /h5/worldcup.html page.  Reads two Goalserve getfeed endpoints (cached in
    /dev/shm) and always degrades to empty lists (never 500)."""
    import xml.etree.ElementTree as _ET
    import re as _re
    league_id = _GS_WC_LEAGUE_ID
    out = {
        "ok": True, "league_id": league_id, "league_name": "FIFA World Cup",
        "updated": "", "groups": [], "scorers": [],
    }

    # ---- Group standings (standings/{id}.xml; one <tournament> per group) ----
    raw = _gs_feed_get(f"standings/{league_id}.xml", ttl=600)
    if raw:
        try:
            root = _ET.fromstring(raw)
        except _ET.ParseError:
            root = None
        if root is not None:
            out["updated"] = root.get("timestamp") or ""
            for tour in root.iter("tournament"):
                gname = tour.get("group") or tour.get("name") or ""
                # Only group-stage tables (skip knockout brackets etc.).
                if "group" not in gname.lower():
                    continue
                teams = []
                for tm in tour.findall("team"):
                    a = tm.attrib
                    ov = tm.find("overall")
                    tot = tm.find("total")
                    o = ov.attrib if ov is not None else {}
                    t = tot.attrib if tot is not None else {}
                    pts = t.get("p") if t.get("p") not in (None, "") else a.get("points")
                    teams.append({
                        "rank": _gs_to_int(a.get("position")),
                        "team_id": _gs_to_int(a.get("id")),
                        "team_name": a.get("name") or "",
                        "played": _gs_to_int(o.get("gp")),
                        "win": _gs_to_int(o.get("w")),
                        "draw": _gs_to_int(o.get("d")),
                        "lose": _gs_to_int(o.get("l")),
                        "goals_for": _gs_to_int(o.get("gs")),
                        "goals_against": _gs_to_int(o.get("ga")),
                        "goals_diff": _gs_to_int(t.get("gd")),
                        "points": _gs_to_int(pts),
                        "form": (a.get("recent_form") or "").replace(" ", ""),
                    })
                if teams:
                    # Normalise group label to just "Group X" when possible.
                    label = gname
                    _m = _re.search(r"group\s*([0-9A-Za-z]+)", gname, _re.IGNORECASE)
                    if _m:
                        label = f"Group {_m.group(1).upper()}"
                    out["groups"].append({
                        "group": label,
                        "group_id": _gs_to_int(tour.get("groupId")),
                        "teams": teams,
                    })
            # Stable order by group label.
            out["groups"].sort(key=lambda g: g["group"])

    # ---- Top scorers: aggregated from REAL WC-finals goal scorers -----------
    # soccerfixtures goals carry player + playerid + assist; we tally goals per
    # scorer over the tournament window.  Own goals are excluded from the
    # scorer tally.  Empty until matches are actually played.
    d0 = time.strftime("%d.%m.%Y", time.gmtime(int(time.time()) - 45 * 86400))
    d1 = time.strftime("%d.%m.%Y", time.gmtime(int(time.time()) + 45 * 86400))
    raw2 = _gs_feed_get(
        f"soccerfixtures/league/{league_id}?date_start={d0}&date_end={d1}", ttl=300
    )
    if raw2:
        try:
            root2 = _ET.fromstring(raw2)
        except _ET.ParseError:
            root2 = None
        if root2 is not None:
            agg: dict = {}
            def _rec(key, pid, name, tname, tid):
                r = agg.get(key)
                if r is None:
                    r = {"player_id": pid, "name": name, "team_name": tname,
                         "team_id": tid, "goals": 0, "assists": 0}
                    agg[key] = r
                return r
            for mt in root2.iter("match"):
                lt = mt.find("localteam"); vt = mt.find("visitorteam")
                lt_name = (lt.get("name") if lt is not None else "") or ""
                vt_name = (vt.get("name") if vt is not None else "") or ""
                lt_id = _gs_to_int(lt.get("id")) if lt is not None else None
                vt_id = _gs_to_int(vt.get("id")) if vt is not None else None
                goals_el = mt.find("goals")
                if goals_el is None:
                    continue
                for g in goals_el.findall("goal"):
                    pname = (g.get("player") or "").strip()
                    if not pname:
                        continue
                    low = pname.lower()
                    if "o.g" in low or "own goal" in low:
                        continue
                    if (g.get("team") or "localteam") == "visitorteam":
                        tname, tid = vt_name, vt_id
                    else:
                        tname, tid = lt_name, lt_id
                    pid = _gs_to_int(g.get("playerid"))
                    _rec(pid or (pname + "|" + tname), pid, pname, tname, tid)["goals"] += 1
                    aname = (g.get("assist") or "").strip()
                    if aname:
                        aid = _gs_to_int(g.get("assistid"))
                        _rec(aid or (aname + "|" + tname), aid, aname, tname, tid)["assists"] += 1
            players = [r for r in agg.values() if r["goals"] > 0]
            players.sort(key=lambda x: (-(x["goals"]), -(x["assists"]), x["name"]))
            out["scorers"] = players[:50]

    # ---- Chinese display names for every team (standings + scorers) ---------
    names = set()
    for grp in out["groups"]:
        for t in grp["teams"]:
            if t.get("team_name"):
                names.add(t["team_name"])
    for s in out["scorers"]:
        if s.get("team_name"):
            names.add(s["team_name"])
    try:
        cn = mysqldb.name_cn_map(list(names)) if names else {}
    except Exception:  # noqa: BLE001
        cn = {}
    for grp in out["groups"]:
        for t in grp["teams"]:
            t["team_cn"] = cn.get(t.get("team_name") or "") or ""
    for s in out["scorers"]:
        s["team_cn"] = cn.get(s.get("team_name") or "") or ""

    return out


def _gs_players(side_el) -> list:
    if side_el is None:
        return []
    return [
        {"number": _gs_to_int(p.get("number")), "name": p.get("name") or "", "pos": ""}
        for p in side_el.findall("player") if (p.get("name") or "").strip()
    ]


def _gs_subs(subs_root, tag: str) -> list:
    """Bench players who came on, from <substitutions><localteam|visitorteam>."""
    if subs_root is None:
        return []
    side = subs_root.find(tag)
    if side is None:
        return []
    out = []
    for s in side.findall("substitution"):
        nm = s.get("player_in_name") or ""
        if nm.strip():
            out.append({"number": _gs_to_int(s.get("player_in_number")), "name": nm, "pos": ""})
    return out


@router.get("/events/{event_id}/lineups")
def event_lineups(event_id: int) -> dict:
    import xml.etree.ElementTree as _ET
    ctx = _gs_match_ctx(event_id)
    if not ctx:
        return {"ok": True, "mapped": False, "teams": []}
    gsl = ctx.get("_gs_league_id")
    if not gsl:
        return {"ok": True, "mapped": False, "teams": []}
    q = _gs_fixture_dates(int(ctx.get("datetime") or 0), span=1)
    raw = _gs_feed_get(f"soccerfixtures/league/{gsl}?{q}", ttl=300)
    if not raw:
        return {"ok": True, "mapped": False, "teams": []}
    try:
        root = _ET.fromstring(raw)
    except _ET.ParseError:
        return {"ok": True, "mapped": False, "teams": []}
    mt, flipped = _gs_find_match(root, ctx.get("team_h"), ctx.get("team_c"))
    if mt is None:
        return {"ok": True, "mapped": False, "teams": []}
    lu = mt.find("lineups")
    subs = mt.find("substitutions")
    if lu is None or (lu.find("localteam") is None and lu.find("visitorteam") is None):
        return {"ok": True, "mapped": False, "teams": []}
    lu_l, lu_v = lu.find("localteam"), lu.find("visitorteam")
    sc_l, sc_v = mt.find("localteam"), mt.find("visitorteam")
    home_side = {
        "team": {"name": (sc_l.get("name") if sc_l is not None else ctx.get("team_h"))},
        "formation": (lu_l.get("formation") if lu_l is not None else ""),
        "startXI": _gs_players(lu_l),
        "substitutes": _gs_subs(subs, "localteam"),
    }
    away_side = {
        "team": {"name": (sc_v.get("name") if sc_v is not None else ctx.get("team_c"))},
        "formation": (lu_v.get("formation") if lu_v is not None else ""),
        "startXI": _gs_players(lu_v),
        "substitutes": _gs_subs(subs, "visitorteam"),
    }
    # Upcoming matches carry an empty <lineups> block (XI posts ~1h pre-KO);
    # treat "no players on either side" as unmapped so the pane shows its
    # "暂无阵容数据" placeholder instead of an empty grid.
    if not (home_side["startXI"] or away_side["startXI"]):
        return {"ok": True, "mapped": False, "teams": []}
    teams = [away_side, home_side] if flipped else [home_side, away_side]
    return {"ok": True, "mapped": True, "teams": teams}


def _gs_fixture_row(mt) -> dict:
    lt, vt = mt.find("localteam"), mt.find("visitorteam")
    d = mt.get("date") or ""
    iso = ""
    if d:
        parts = d.split(".")
        if len(parts) == 3:
            iso = f"{parts[2]}-{parts[1]}-{parts[0]}"
    return {
        "home": (lt.get("name") if lt is not None else ""),
        "away": (vt.get("name") if vt is not None else ""),
        "score_home": (_gs_to_int(lt.get("score")) if lt is not None else None),
        "score_away": (_gs_to_int(vt.get("score")) if vt is not None else None),
        "date_iso": iso,
        "date_sort": d.split(".")[::-1] if d else [],
        "league": mt.get("_league") or "",
    }


@router.get("/events/{event_id}/h2h")
def event_h2h(event_id: int) -> dict:
    import xml.etree.ElementTree as _ET
    ctx = _gs_match_ctx(event_id)
    if not ctx:
        return {"ok": True, "mapped": False}
    gsl = ctx.get("_gs_league_id")
    if not gsl:
        return {"ok": True, "mapped": False}
    base = int(ctx.get("datetime") or time.time())
    d0 = time.strftime("%d.%m.%Y", time.gmtime(base - 300 * 86400))
    d1 = time.strftime("%d.%m.%Y", time.gmtime(base + 2 * 86400))
    raw = _gs_feed_get(f"soccerfixtures/league/{gsl}?date_start={d0}&date_end={d1}", ttl=3600)
    if not raw:
        return {"ok": True, "mapped": False}
    try:
        root = _ET.fromstring(raw)
    except _ET.ParseError:
        return {"ok": True, "mapped": False}
    nh, nc = _gs_norm_team(ctx.get("team_h")), _gs_norm_team(ctx.get("team_c"))
    finished, h2h = [], []
    home_form, away_form = [], []
    for mt in root.iter("match"):
        lt, vt = mt.find("localteam"), mt.find("visitorteam")
        if lt is None or vt is None:
            continue
        sh = _gs_to_int(lt.get("score"))
        if sh is None:  # not played yet
            continue
        ln, vn = _gs_norm_team(lt.get("name")), _gs_norm_team(vt.get("name"))
        row = _gs_fixture_row(mt)
        if {ln, vn} == {nh, nc}:
            h2h.append(row)
        if nh in (ln, vn):
            home_form.append(row)
        if nc in (ln, vn):
            away_form.append(row)
    if not (h2h or home_form or away_form):
        return {"ok": True, "mapped": False}
    def _recent(arr, n):
        arr.sort(key=lambda r: r.get("date_sort") or [], reverse=True)
        for r in arr:
            r.pop("date_sort", None)
        return arr[:n]
    return {
        "ok": True, "mapped": True,
        "home": {"name": ctx.get("team_h")},
        "away": {"name": ctx.get("team_c")},
        "h2h": _recent(h2h, 8),
        "home_form": _recent(home_form, 6),
        "away_form": _recent(away_form, 6),
    }


@router.get("/events/{event_id}/timeline")
def event_timeline(event_id: int) -> dict:
    """Post-match (or pre-snap) event timeline from soccerfixtures — the
    finished-match counterpart to /inplay-events.  Same wire shape so the
    H5 events pane renders it unchanged."""
    import xml.etree.ElementTree as _ET
    import re as _re
    ctx = _gs_match_ctx(event_id)
    if not ctx:
        return {"ok": True, "source": "goalserve", "mapped": False, "events": []}
    gsl = ctx.get("_gs_league_id")
    if not gsl:
        return {"ok": True, "source": "goalserve", "mapped": False, "events": []}
    q = _gs_fixture_dates(int(ctx.get("datetime") or 0), span=1)
    raw = _gs_feed_get(f"soccerfixtures/league/{gsl}?{q}", ttl=300)
    if not raw:
        return {"ok": True, "source": "goalserve", "mapped": False, "events": []}
    try:
        root = _ET.fromstring(raw)
    except _ET.ParseError:
        return {"ok": True, "source": "goalserve", "mapped": False, "events": []}
    mt, flipped = _gs_find_match(root, ctx.get("team_h"), ctx.get("team_c"))
    if mt is None:
        return {"ok": True, "source": "goalserve", "mapped": False, "events": []}

    def _side(team_attr: str) -> str:
        is_local = (team_attr == "localteam")
        if flipped:
            is_local = not is_local
        return "home" if is_local else "away"

    evs = []
    goals = mt.find("goals")
    if goals is not None:
        for g in goals.findall("goal"):
            evs.append({
                "type": "goal", "minute": _gs_to_int(g.get("minute")), "extra": None,
                "side": _side(g.get("team") or ""), "team": g.get("player") or "",
                "label": "进球",
            })
    # Cards come from each lineup player's booking="YC 76" / "RC 45".
    lu = mt.find("lineups")
    if lu is not None:
        for tag in ("localteam", "visitorteam"):
            side_el = lu.find(tag)
            if side_el is None:
                continue
            for p in side_el.findall("player"):
                bk = (p.get("booking") or "").strip()
                if not bk:
                    continue
                mm = _re.match(r"(YC|RC|YR)\s*(\d+)?", bk, _re.I)
                if not mm:
                    continue
                kind = mm.group(1).upper()
                typ = "red_card" if kind in ("RC", "YR") else "yellow_card"
                evs.append({
                    "type": typ, "minute": _gs_to_int(mm.group(2)), "extra": None,
                    "side": _side(tag), "team": p.get("name") or "",
                    "label": "红牌" if typ == "red_card" else "黄牌",
                })
    subs = mt.find("substitutions")
    if subs is not None:
        for tag in ("localteam", "visitorteam"):
            side_el = subs.find(tag)
            if side_el is None:
                continue
            for s in side_el.findall("substitution"):
                nm = s.get("player_in_name") or ""
                if not nm.strip():
                    continue
                evs.append({
                    "type": "substitution", "minute": _gs_to_int(s.get("minute")),
                    "extra": None, "side": _side(tag), "team": nm, "label": "换人",
                })
    evs.sort(key=lambda e: (e["minute"] if e["minute"] is not None else 999))
    return {"ok": True, "source": "goalserve", "mapped": True,
            "home": ctx.get("team_h"), "away": ctx.get("team_c"), "events": evs}


# ---------------------------------------------------------------------------
# `/api/external/events/{eid}/inplay-stats`
# ---------------------------------------------------------------------------
# Live match statistics derived from the Goalserve snapshot — replaces
# the api-sports.io `/match/{id}/statistics` route as the primary source
# for the H5 "实时数据" tab.    The snapshot's flat stats fields (yc_*,
# rc_*, corners_*, fouls_*, shots_*) come from goalserve's stats packet;
# when that packet hasn't arrived yet (new fixture) we backfill counters
# by tallying the parsed `_inplay_events` timeline.   This guarantees
# something useful is rendered immediately on kickoff instead of an
# empty "未映射" placeholder.
#
def _stats_from_events(events: "list[dict]", code: str) -> "tuple[int, int]":
    """Count timeline entries whose `code` field matches, splitting by side."""
    h = a = 0
    if not isinstance(events, list):
        return 0, 0
    for e in events:
        if not isinstance(e, dict):
            continue
        if str(e.get("code") or "").strip() != code:
            continue
        side = e.get("side")
        if side == "home":
            h += 1
        elif side == "away":
            a += 1
    return h, a


def _pick(snap_value, fallback_pair):
    """Prefer the snap's reported stat over the event-derived count; fall
    back to (0, 0) only when both are empty so the UI shows real zeros
    instead of em-dashes when the data simply hasn't fired yet."""
    if isinstance(snap_value, int):
        return snap_value
    return fallback_pair


@router.get("/events/{event_id}/inplay-stats")
def event_inplay_stats(event_id: str) -> dict:
    """Goalserve-derived live statistics.   Always returns 200 with an
    `ok:true` envelope so the frontend can decide what to render based
    on whether `stats` is empty."""
    from pathlib import Path as _p
    import json as _json
    snap_file = _p(_logo_os.environ.get("GS_LIVE_DIR", "/dev/shm/goalserve_live")) / f"{event_id}.json"
    if not snap_file.is_file():
        snap_file = _p(_logo_os.environ.get("GS_PREGAME_DIR", "/dev/shm/goalserve_pregame")) / f"{event_id}.json"
        if not snap_file.is_file():
            return {"ok": True, "source": "goalserve", "mapped": False,
                    "event_id": event_id, "stats": [], "reason": "no_snapshot"}
    try:
        with snap_file.open("r", encoding="utf-8") as fh:
            snap = _json.load(fh)
    except (OSError, ValueError):
        return {"ok": True, "source": "goalserve", "mapped": False,
                "event_id": event_id, "stats": [], "reason": "snap_read_error"}

    events = snap.get("_inplay_events") or []
    # Event-derived fallback counters by goalserve code:
    #   252 = corner, 253 = yellow card, 254 = red card, 255 = goal,
    #   158 = substitution.   Free-kick / offside / shot codes are not
    #   surfaced as discrete events by goalserve, so those rely entirely
    #   on the `stats` packet.
    ev_corner_h, ev_corner_a = _stats_from_events(events, "252")
    ev_yc_h,     ev_yc_a     = _stats_from_events(events, "253")
    ev_rc_h,     ev_rc_a     = _stats_from_events(events, "254")
    ev_goal_h,   ev_goal_a   = _stats_from_events(events, "255")

    corners_h = _pick(snap.get("corners_home"), ev_corner_h)
    corners_a = _pick(snap.get("corners_away"), ev_corner_a)
    yc_h      = _pick(snap.get("yc_home"),      ev_yc_h)
    yc_a      = _pick(snap.get("yc_away"),      ev_yc_a)
    rc_h      = _pick(snap.get("rc_home"),      ev_rc_h)
    rc_a      = _pick(snap.get("rc_away"),      ev_rc_a)
    score_h   = snap.get("score_home")
    score_a   = snap.get("score_away")
    if score_h is None and ev_goal_h:
        score_h = ev_goal_h
    if score_a is None and ev_goal_a:
        score_a = ev_goal_a

    # Snap shots / fouls — goalserve `stats.s` / `stats.f` pairs.   Show
    # as None (em-dash) when the upstream hasn't reported them, NOT as 0,
    # so the user can tell "not reported" apart from genuine "zero".
    shots_h  = snap.get("shots_home")
    shots_a  = snap.get("shots_away")
    fouls_h  = snap.get("fouls_home")
    fouls_a  = snap.get("fouls_away")

    def _row(key, label, h, a):
        return {"key": key, "label": label, "home": h, "away": a}

    # Build the stats list in display order.   We always include every
    # row even when values are None — the frontend then renders an em-
    # dash so the table layout stays consistent across matches.
    stats_rows = [
        _row("shots",   "射门",      shots_h,   shots_a),
        _row("corner",  "角球",      corners_h, corners_a),
        _row("yellow",  "黄牌",      yc_h,      yc_a),
        _row("red",     "红牌",      rc_h,      rc_a),
        _row("fouls",   "犯规",      fouls_h,   fouls_a),
        _row("goals",   "进球",      score_h,   score_a),
    ]

    # If literally every value is missing AND there are no timeline
    # events, signal that to the frontend so it can render a gentle
    # "尚未开始统计" message instead of an empty table.
    has_any = any(r["home"] is not None or r["away"] is not None for r in stats_rows)
    return {
        "ok": True,
        "source": "goalserve",
        "mapped": True,
        "event_id": event_id,
        "home": snap.get("home"),
        "away": snap.get("away"),
        "score": {
            "home": score_h, "away": score_a,
            "ht_home": snap.get("score_home_ht"),
            "ht_away": snap.get("score_away_ht"),
        },
        "minute": snap.get("elapsed_minute"),
        "period": snap.get("status_short"),
        "status": snap.get("status"),
        "stats": stats_rows,
        "has_any": has_any,
        "fetched_at": snap.get("fetched_at"),
    }


@router.get("/logos/{category}/{gid}.png")
def logo_proxy(category: str, gid: int):
    """Proxy + disk-cache logo PNGs from Goalserve's logotips CDN.
    Always returns either a real PNG (200) or a 1x1 transparent fallback
    (200 with Cache-Control:short-ttl) so the browser <img> never blank-
    boxes; the frontend's `onerror` then never has to fire either."""
    if category not in _LOGO_CATEGORIES:
        return _logo_Response(status_code=404, content=b"unknown category")
    if gid <= 0:
        return _logo_Response(status_code=404, content=b"bad id")
    cache_file = _logo_path(category, gid)
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    # Positive cache hit (non-empty file).
    if cache_file.is_file() and cache_file.stat().st_size > 0:
        return _logo_FileResponse(
            cache_file,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=2592000, immutable"},
        )
    # Negative cache hit (empty file, within TTL).
    if cache_file.is_file() and cache_file.stat().st_size == 0:
        age = _logo_time.time() - cache_file.stat().st_mtime
        if age < _LOGO_NEG_TTL:
            return _logo_Response(
                status_code=404,
                content=b"",
                headers={"Cache-Control": f"public, max-age={int(_LOGO_NEG_TTL)}"},
            )
        # Stale negative — retry upstream.
        cache_file.unlink(missing_ok=True)
    # Cold miss: fetch upstream.
    try:
        if category == "playerphoto":
            data = _logo_fetch_player_photo(gid)
        else:
            data = _logo_fetch(category, gid)
    except Exception:
        # Transient upstream error (429/5xx/timeout) — do NOT negative-cache.
        return _logo_Response(
            status_code=404,
            content=b"",
            headers={"Cache-Control": "public, max-age=60"},
        )
    if data is None or len(data) < 128:
        # Genuine "no logo" — negative-cache with full TTL.
        try:
            cache_file.write_bytes(b"")
        except OSError:
            pass
        return _logo_Response(
            status_code=404,
            content=b"",
            headers={"Cache-Control": f"public, max-age={int(_LOGO_NEG_TTL)}"},
        )
    # Atomic write so concurrent requesters don't see a partial file.
    tmp = cache_file.with_suffix(".png.tmp")
    try:
        tmp.write_bytes(data)
        tmp.replace(cache_file)
    except OSError:
        return _logo_Response(content=data, media_type="image/png")
    return _logo_FileResponse(
        cache_file,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=2592000, immutable"},
    )


@router.get("/logos/_stats")
def logo_stats() -> dict:
    """Diagnostics — count cached + sizes."""
    cats = {}
    for cat in _LOGO_CATEGORIES:
        d = _LOGO_CACHE_DIR / cat
        if not d.is_dir():
            cats[cat] = {"count": 0, "bytes": 0}
            continue
        n = 0; b = 0
        for f in d.glob("*.png"):
            n += 1
            try: b += f.stat().st_size
            except OSError: pass
        cats[cat] = {"count": n, "bytes": b}
    try:
        from .. import goalserve_team_directory as _td
        td = _td.stats()
    except Exception as e:  # noqa: BLE001
        td = {"error": f"td unavailable: {e!r}"}
    return {"ok": True, "categories": cats, "team_directory": td}

