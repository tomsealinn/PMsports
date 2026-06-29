"""Goalserve In-Play WebSocket client.

Primary real-time source for in-play soccer events.  Pairs with the existing
REST poller (`goalserve_inplay.py`) which now operates as a *standby* —
the REST poller checks the WS index freshness in `/dev/shm/goalserve_live`
and skips its upstream fetch while WS messages are flowing.

Per Goalserve docs <https://documentation.goalserve.com/v1/#inplay-websockets-api>:

* Whitelist your static IP with Goalserve (already done — server 107.151.247.80).
* POST {"apiKey": "..."} to ``http://live.goalserve.com/api/v1/auth/gettoken``.
  Token TTL = 60 min.  We refresh at 55 min.
* Connect to ``ws://live.goalserve.com/api/v1/{sport}?token=<JWT>``.
* Single connection per key.  Messages are JSON with ``mt`` field:
    - ``avl``  full snapshot — use to seed in-memory state
    - ``updt`` per-event delta (id, scores, odds, stats)

Output is identical to the REST poller: ``/dev/shm/goalserve_live/<id>.json``
(OddsEvent shape, including ``main_odds``) plus ``_index.json`` with a
``ws_updated_ts`` field for the standby coordinator.

Run standalone for systemd::

    python -m app.goalserve_inplay_ws
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

log = logging.getLogger("goalserve_inplay_ws")

# --------------------------------------------------------------------------
# Config (env-overridable)
GS_API_KEY = os.environ.get("GS_API_KEY", "c74967accb6a4acc791908de6ecd0c8e")
GS_TOKEN_URL = os.environ.get(
    "GS_TOKEN_URL", "http://live.goalserve.com/api/v1/auth/gettoken"
)
GS_WS_URL_TMPL = os.environ.get(
    "GS_WS_URL_TMPL", "ws://live.goalserve.com/ws/{sport}?tkn={token}"
)
GS_WS_SPORT = os.environ.get("GS_WS_SPORT", "soccer")
GS_TOKEN_CACHE = Path(os.environ.get("GS_TOKEN_CACHE", "/dev/shm/goalserve_token.json"))
GS_TOKEN_TTL = int(os.environ.get("GS_TOKEN_TTL", "3300"))  # 55 min, refresh before 60
GS_WS_PING_INTERVAL = float(os.environ.get("GS_WS_PING_INTERVAL", "25"))
GS_WS_PING_TIMEOUT = float(os.environ.get("GS_WS_PING_TIMEOUT", "20"))
GS_WS_MAX_BACKOFF = float(os.environ.get("GS_WS_MAX_BACKOFF", "60"))
GS_WS_AUTH_BACKOFF = float(os.environ.get("GS_WS_AUTH_BACKOFF", "600"))  # 10 min on 401
GS_WS_WRITE_DEBOUNCE = float(os.environ.get("GS_WS_WRITE_DEBOUNCE", "0.5"))
GS_WS_INDEX_INTERVAL = float(os.environ.get("GS_WS_INDEX_INTERVAL", "1.5"))
GS_LIVE_DIR = Path(os.environ.get("GS_LIVE_DIR", "/dev/shm/goalserve_live"))
# Finalizer sweep: flip finished-but-unfinalised GS matches to is_inball=1
# so they settle + leave 滚球.  GS drops finished matches from the live feed
# without always sending an FT frame, leaving status=1/is_inball=0 zombies.
GS_WS_FINALIZE_INTERVAL = float(os.environ.get("GS_WS_FINALIZE_INTERVAL", "120"))
GS_WS_FINALIZE_HEALTH_SEC = float(os.environ.get("GS_WS_FINALIZE_HEALTH_SEC", "150"))
GS_WS_FINALIZE_SILENCE_SEC = int(os.environ.get("GS_WS_FINALIZE_SILENCE_SEC", "900"))


def _enabled() -> bool:
    return os.environ.get("GS_WS_ENABLE", "1").strip().lower() not in ("0", "false", "no", "")


# --------------------------------------------------------------------------
# Outcome name -> role normalization (WS uses "1"/"X"/"2"/"Home"/"Over"/...).
_ROLE_MAP = {
    "1": "home", "x": "draw", "2": "away",
    "home": "home", "draw": "draw", "away": "away",
    "over": "over", "under": "under",
    "yes": "yes", "no": "no", "no goal": "draw",
    "1x": "1x", "x2": "x2", "12": "12",
    "odd": "odd", "even": "even",
}


def _role_for(name: str) -> str:
    if not name:
        return ""
    k = str(name).strip().lower()
    return _ROLE_MAP.get(k, k)


def _ha_for_outcome(mid: int, role: str, market_ha):
    """Goalserve sends a single market-level handicap (`ha`).  Mirror the
    convention used by the REST adapter so `goalserve_inplay._canon_row()`
    extracts the right per-side value:

    * Asian Handicap (12, 11, 29) — `ha` is signed home-perspective.  Home
      keeps it; away gets the negated value.
    * Totals (31, 90008, 90009, 421, 520) — `ha` is the line, applies to
      both Over and Under participants.
    """
    if market_ha is None:
        return None
    try:
        ha_f = float(market_ha)
    except (TypeError, ValueError):
        return None
    if mid in (12, 11, 29):
        if role == "home":
            return ha_f
        if role == "away":
            return -ha_f
        return None
    if mid in (31, 90008, 90009, 421, 520):
        return ha_f
    return None


def _ws_market_to_rest(mkt: dict) -> "dict | None":
    """Translate one WS odds-block into the REST-shaped market dict the
    existing `goalserve_inplay` adapter consumes."""
    if not isinstance(mkt, dict):
        return None
    try:
        mid = int(mkt.get("id"))
    except (TypeError, ValueError):
        return None
    market_ha = mkt.get("ha")
    susp_market = "1" if str(mkt.get("bl")) == "1" else "0"

    parts: "dict[str, dict]" = {}
    for i, oc in enumerate(mkt.get("o") or []):
        if not isinstance(oc, dict):
            continue
        raw_name = oc.get("n") or ""
        role = _role_for(raw_name) or raw_name
        try:
            v = float(oc.get("v")) if oc.get("v") not in (None, "") else 0.0
        except (TypeError, ValueError):
            v = 0.0
        parts[str(i)] = {
            "name": role,
            "value_eu": v,
            "handicap": _ha_for_outcome(mid, role, market_ha),
            "suspend": "1" if str(oc.get("b")) == "1" else "0",
            # raw upstream label kept for the detail/passthrough projection
            "short_name": raw_name,
        }
    return {
        "id": mid,
        "name": "",
        "suspend": susp_market,
        "participants": parts,
    }


def _period_short_from_stp(stp) -> "str | None":
    """Best-effort mapping from Goalserve `stp` (period state) to a
    short ticker code matching the existing UI.  Falls back to None when
    stp is unknown — the live ticker then uses the elapsed minute alone.
    """
    try:
        s = int(stp)
    except (TypeError, ValueError):
        return None
    return {
        1: "1H",   # 1st half
        2: "HT",   # half time / break
        3: "2H",   # 2nd half
        4: "ET",   # extra time (1st period)
        5: "ET",   # extra time (2nd period)
        6: "P",    # penalty shoot-out
        7: "FT",   # finished (regulation)
        8: "FT",   # finished (after ET/PEN)
    }.get(s)


def _ws_event_to_rest(state: dict) -> "dict | None":
    """Translate the in-memory WS event state into the REST inplay-soccer.gz
    event shape, then call `goalserve_inplay.normalize_event` so output
    matches the REST poller byte-for-byte."""
    if not state.get("id"):
        return None

    sc = state.get("sc") or ""
    minute = None
    et = state.get("et")
    try:
        if et is not None:
            minute = max(0, int(et) // 60)
    except (TypeError, ValueError):
        pass
    period_short = _period_short_from_stp(state.get("stp")) or ""

    finished = bool(state.get("finished"))
    # stp 7/8 also implies finished
    try:
        if int(state.get("stp") or 0) in (7, 8):
            finished = True
    except (TypeError, ValueError):
        pass

    home_name = state.get("t1_n") or ""
    away_name = state.get("t2_n") or ""

    # Build REST-shaped odds dict from in-memory odds_by_mid.
    rest_odds: "dict[str, dict]" = {}
    for mid_int, mkt in (state.get("odds_by_mid") or {}).items():
        m = _ws_market_to_rest(mkt)
        if m is not None:
            rest_odds[str(mid_int)] = m

    # Score priority: cms-derived t1_score/t2_score wins over `sc`.  The WS
    # `sc` field is an internal code (e.g. "21024"), NOT a goal count — only
    # use it as a last resort when it happens to contain "H:A" digits.
    if state.get("t1_score") is not None and state.get("t2_score") is not None:
        try:
            sc = f"{int(state['t1_score'])}:{int(state['t2_score'])}"
        except (TypeError, ValueError):
            pass
    else:
        # `sc` typically looks like "21024" — only keep if it parses cleanly.
        if sc and ":" in sc:
            a, _, b = sc.partition(":")
            if not (a.lstrip("-").isdigit() and b.lstrip("-").isdigit()):
                sc = ""
        else:
            sc = ""

    # Convert WS `cms` entries → REST `extra`-shape dict so the snapshot
    # normaliser produces _inplay_events for both data paths.
    extra_from_cms = {}
    cms_state = state.get("cms")
    if isinstance(cms_state, list):
        for idx, c in enumerate(cms_state):
            if not isinstance(c, dict):
                continue
            mt = str(c.get("mt") or "").strip()
            if not mt:
                continue
            tm = c.get("tm")
            minute_str = ""
            try:
                if tm is not None:
                    minute_str = str(int(tm) // 60)
            except (TypeError, ValueError):
                pass
            value_str = str(c.get("n") or "").strip()
            # Carry `ti` so the inplay-event parser can resolve side without
            # text-matching on the parenthesised team name.
            extra_from_cms[str(idx)] = {
                "code":   mt,
                "minute": minute_str,
                "value":  value_str,
                "ti":     str(c.get("ti") or ""),
            }

    rest_ev = {
        "extra": extra_from_cms,
        "info": {
            "id": state["id"],
            "mid": state.get("mid"),
            "name": f"{home_name} vs {away_name}",
            "league_id": state.get("cmp_id"),
            "league": state.get("cmp_name"),
            "score": sc,
            "minute": minute if minute is not None else "",
            "period": period_short,
            "state": state.get("stp"),
            "start_ts_utc": state.get("st"),
            "start_ts": state.get("st"),
            "bet365id": state.get("bet365id"),
            "seconds": et,
            "_raw_sc": state.get("sc"),
            "_stats": state.get("stats") if isinstance(state.get("stats"), dict) else None,
        },
        "team_info": {
            "home": {"name": home_name},
            "away": {"name": away_name},
        },
        "core": {"finished": "1" if finished else "0"},
        "odds": rest_odds,
    }
    # Reuse REST normaliser so all consumers see the same shape, then apply
    # the Plan C ladder correction: override the WS single-line AH/Totals
    # markets with the balanced line from the full-ladder REST cache (or
    # suppress a lopsided line when no cache is available).
    from .goalserve_inplay import normalize_event, apply_ladder_correction
    snap = normalize_event(str(state["id"]), rest_ev)
    if snap:
        apply_ladder_correction(snap)
    return snap


# --------------------------------------------------------------------------
# Token management
def _http_post_json(url: str, body: dict, timeout: float = 10.0) -> dict:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json", "User-Agent": "crown-gold/goalserve-ws"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    return json.loads(raw)


def _read_token_cache() -> "tuple[str, float] | None":
    try:
        with GS_TOKEN_CACHE.open("rb") as fh:
            obj = json.load(fh)
        token = obj.get("token")
        ts = float(obj.get("ts") or 0)
        if token and (time.time() - ts) < GS_TOKEN_TTL:
            return token, ts
    except (OSError, ValueError):
        pass
    return None


def _write_token_cache(token: str) -> None:
    try:
        GS_TOKEN_CACHE.parent.mkdir(parents=True, exist_ok=True)
        tmp = GS_TOKEN_CACHE.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump({"token": token, "ts": time.time()}, fh)
        os.replace(tmp, GS_TOKEN_CACHE)
        try:
            os.chmod(GS_TOKEN_CACHE, 0o660)
        except OSError:
            pass
    except OSError as e:
        log.warning("token cache write failed: %s", e)


class AuthFailure(Exception):
    """Raised when gettoken returns 401/403 — key not provisioned for WS."""


def fetch_token(force: bool = False) -> str:
    """Return a valid JWT.  Uses cache unless `force`."""
    if not force:
        cached = _read_token_cache()
        if cached:
            return cached[0]
    try:
        resp = _http_post_json(GS_TOKEN_URL, {"apiKey": GS_API_KEY})
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise AuthFailure(f"gettoken {e.code}: WS add-on not enabled for key") from e
        raise
    token = resp.get("token") or resp.get("access_token")
    if not token:
        raise RuntimeError(f"gettoken: no token in response: {resp!r}")
    _write_token_cache(token)
    return token


# --------------------------------------------------------------------------
# Main WS client
class GoalserveInplayWS:
    """Single-connection WS client.  Maintains in-memory event state and
    writes /dev/shm snapshots in the same shape as the REST poller."""

    def __init__(self) -> None:
        self._task: "asyncio.Task | None" = None
        self._index_task: "asyncio.Task | None" = None
        self._finalize_task: "asyncio.Task | None" = None
        self._stop = False
        # state[ev_id] = dict with metadata + odds_by_mid + last_write_ts
        self._state: "dict[int, dict]" = {}
        self._dirty: "set[int]" = set()
        # Pub/sub fan-out — each browser /api/external/ws connection holds an
        # asyncio.Queue we push snapshot dicts into.  Subscribers join via
        # `await gs_ws.subscribe()` and drop their queue on disconnect via
        # `await gs_ws.unsubscribe(q)`.  Bounded queue so a slow client
        # cannot pile up unbounded memory; on overflow we drop oldest.
        self._subs: "list[asyncio.Queue]" = []
        self._subs_lock: "asyncio.Lock | None" = None
        # Counters surface through ws_status so the diagnostics page can
        # confirm pushes are landing.
        self.messages_received: int = 0
        self.messages_dispatched: int = 0
        self.last_message_at: "float | None" = None
        # Health (existing)
        self.last_msg_ts: "float | None" = None
        self.last_avl_ts: "float | None" = None
        self.last_updt_ts: "float | None" = None
        self.connected: bool = False
        self.connect_attempts: int = 0
        self.auth_failures: int = 0
        self.last_error: "str | None" = None

    # ---- snapshot/index writers ----
    def _ensure_dir(self) -> None:
        try:
            GS_LIVE_DIR.mkdir(parents=True, exist_ok=True)
            os.chmod(GS_LIVE_DIR, 0o775)
        except OSError:
            pass

    def _flush_event(self, ev_id: int) -> "dict | None":
        """Build + persist + fan-out one event's snapshot ON THE EVENT LOOP.

        Returns the snapshot dict when something actually changed (so the
        caller runs the blocking MySQL upsert off-loop via asyncio.to_thread),
        or None when skipped/unchanged.  The DB write is deliberately NOT done
        here: 3 synchronous MySQL round-trips per event x ~35 events on every
        upstream `avl` reseed used to freeze the single-worker event loop,
        stalling WS handshakes and /health for seconds.
        """
        st = self._state.get(ev_id)
        if not st:
            return None
        snap = _ws_event_to_rest(st)
        if not snap:
            return None
        # Dedup: an upstream `avl` reseed (the WS reconnects ~every 50s and
        # re-sends a FULL snapshot) marks every event dirty even when nothing
        # changed.  Skip the disk write + fan-out + DB upsert when the
        # bet-relevant snapshot is identical to the last flush.  Only the
        # volatile `fetched_at` timestamp is excluded from the comparison, so
        # any real odds/score/status/market change still flushes (worst case
        # the guard is a harmless no-op).
        try:
            _sig_src = {k: v for k, v in snap.items() if k != "fetched_at"}
            _sig = json.dumps(_sig_src, ensure_ascii=False, separators=(",", ":"),
                              default=str, sort_keys=True)
        except Exception:  # noqa: BLE001
            _sig = None
        if _sig is not None and st.get("_last_flush_sig") == _sig:
            st["_last_snap"] = snap          # keep index/replay cache warm
            return None
        self._ensure_dir()
        fid = str(snap["id"])
        tmp = GS_LIVE_DIR / f".{fid}.json.tmp"
        dst = GS_LIVE_DIR / f"{fid}.json"
        try:
            with tmp.open("w", encoding="utf-8") as fh:
                json.dump(snap, fh, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp, dst)
            st["_last_write_ts"] = time.time()
            st["_last_snap"] = snap
            if _sig is not None:
                st["_last_flush_sig"] = _sig
        except OSError as e:
            log.warning("flush %s failed: %s", dst, e)
            return None
        # Push snapshot to any subscribed /api/external/ws clients so
        # browsers see the same odds the snapshot file just got.  Failures
        # in fan-out MUST NOT affect the canonical disk write above.
        try:
            self._publish(snap)
        except Exception as e:  # noqa: BLE001
            log.warning("publish %s failed: %s", fid, e)
        return snap

    async def _flush_dirty_loop(self) -> None:
        """Coalesce per-event writes — at most one per GS_WS_WRITE_DEBOUNCE."""
        while not self._stop:
            await asyncio.sleep(GS_WS_WRITE_DEBOUNCE / 2.0)
            if not self._dirty:
                continue
            now = time.time()
            ready: "list[int]" = []
            for ev_id in list(self._dirty):
                st = self._state.get(ev_id)
                if not st:
                    self._dirty.discard(ev_id)
                    continue
                last = st.get("_last_write_ts") or 0
                if (now - last) >= GS_WS_WRITE_DEBOUNCE:
                    ready.append(ev_id)
            for ev_id in ready:
                snap = self._flush_event(ev_id)
                self._dirty.discard(ev_id)
                # Run the (blocking) MySQL upsert OFF the event loop so a
                # burst of flushes — e.g. an avl reseed of ~35 events — can't
                # freeze the single worker (WS handshakes + /health were
                # stalling for seconds during these bursts).  mysqldb uses a
                # per-thread pymysql connection (threading.local) so calling
                # it from the default thread executor is safe.
                if snap is not None:
                    try:
                        from . import goalserve_dbwriter as _gw
                        if _gw.GS_DB_WRITE:
                            await asyncio.to_thread(_gw.upsert_event, snap)
                    except Exception as e:  # noqa: BLE001
                        log.warning("dbwriter upsert %s failed: %s",
                                    snap.get("id"), e)

    async def _finalize_loop(self) -> None:
        """Finalise finished-but-unfinalised GS matches (set is_inball=1) so
        their bets settle and they leave 滚球.  Guarded by feed health: the
        sweep only runs when a WS message arrived within
        GS_WS_FINALIZE_HEALTH_SEC, so a connection outage (where every event
        goes silent at once) can't mass-finalise genuinely-live matches.
        """
        # Let the connection establish + seed before the first sweep.
        await asyncio.sleep(GS_WS_FINALIZE_INTERVAL)
        while not self._stop:
            try:
                now = time.time()
                healthy = (
                    self.last_msg_ts is not None
                    and (now - self.last_msg_ts) < GS_WS_FINALIZE_HEALTH_SEC
                )
                if healthy:
                    from . import goalserve_dbwriter as _gw
                    if _gw.GS_DB_WRITE:
                        try:
                            from . import mysqldb
                            min_age = mysqldb.LIVE_WINDOW_SEC
                        except Exception:  # noqa: BLE001
                            min_age = 7200
                        # Run OFF the event loop: finalize_stale_gs does a
                        # blocking MySQL UPDATE (foot_match is MyISAM -> table
                        # lock waits) and must never freeze the single-worker
                        # loop.
                        n = await asyncio.to_thread(
                            _gw.finalize_stale_gs,
                            silence_sec=GS_WS_FINALIZE_SILENCE_SEC,
                            min_age_sec=min_age,
                        )
                        if n:
                            log.info("finalised %d stale GS match(es) -> is_inball=1", n)
                        # Goalserve assigns DIFFERENT competition + match ids
                        # in pregame XML vs in-play WS for the same physical
                        # game, so the same fixture lands as two foot_match
                        # rows.  Sweep them together with finalisation —
                        # both passes are gated on feed health.
                        try:
                            stats = await asyncio.to_thread(_gw.dedupe_gs_pairs)
                            if stats.get("deleted") or stats.get("errors"):
                                log.info(
                                    "dedupe_gs_pairs groups=%s deleted=%s kept_for_bets=%s errors=%s",
                                    stats.get("groups"), stats.get("deleted"),
                                    stats.get("kept_for_bets"), stats.get("errors"),
                                )
                        except Exception as e:  # noqa: BLE001
                            log.warning("dedupe_gs_pairs failed: %s", e)
                        # A2 enrich-at-finalize: pull the soccerfixtures goal/
                        # card timeline + ET/PEN scores for newly-finalised
                        # matches into foot_match.gs_* so settle_graders can
                        # auto-settle the A2 markets.  Idempotent + bounded;
                        # failures never break finalisation.
                        try:
                            from . import goalserve_a2_enrich as _a2
                            # CRITICAL: enrich does a SYNC urllib.urlopen to the
                            # Goalserve soccerfixtures feed.  urlopen(timeout=)
                            # does NOT cover getaddrinfo (DNS), so a DNS/connect
                            # hang here used to FREEZE the event loop (caught via
                            # py-spy: MainThread stuck in getaddrinfo under
                            # _finalize_loop -> enrich_finished_a2 -> _gs_feed_get
                            # -> urlopen), stalling /events + /health + WS.  Run
                            # it in a thread so only a worker blocks, not the loop.
                            await asyncio.to_thread(_a2.enrich_finished_a2)
                        except Exception as e:  # noqa: BLE001
                            log.warning("a2 enrich sweep failed: %s", e)
            except Exception as e:  # noqa: BLE001
                log.warning("finalize loop error: %s", e)
            await asyncio.sleep(GS_WS_FINALIZE_INTERVAL)

    async def _index_loop(self) -> None:
        """Periodically rebuild _index.json so the standby REST poller and
        FastAPI router can detect WS freshness."""
        while not self._stop:
            await asyncio.sleep(GS_WS_INDEX_INTERVAL)
            try:
                self._write_index()
            except Exception as e:  # noqa: BLE001
                log.debug("index write failed: %s", e)
            try:
                removed = self._prune_stale_snaps()
                if removed:
                    log.info("pruned %d stale snap(s) (left WS feed)", removed)
            except Exception as e:  # noqa: BLE001
                log.debug("snap prune failed: %s", e)

    def _prune_stale_snaps(self) -> int:
        """Delete snap files for matches that have left the WS feed.

        A file is removed only when its gid is absent from ``self._state``
        (the match dropped out of the avl snapshot) AND it hasn't been
        rewritten within ``GS_STALE_GRACE``.   In-state matches are kept
        regardless of mtime so a quiet live match (e.g. at half-time) is
        never pruned."""
        try:
            from .goalserve_inplay import GS_STALE_GRACE as _grace
        except Exception:  # noqa: BLE001
            _grace = 90.0
        now = time.time()
        state_ids = {str(k) for k in self._state.keys()}
        removed = 0
        try:
            for f in GS_LIVE_DIR.glob("*.json"):
                if f.name.startswith("_"):
                    continue
                if f.stem in state_ids:
                    continue  # still live — keep regardless of mtime
                try:
                    if now - f.stat().st_mtime > _grace:
                        f.unlink()
                        removed += 1
                except OSError:
                    pass
        except OSError:
            pass
        return removed

    def _write_index(self) -> None:
        self._ensure_dir()
        index = []
        for ev_id, st in self._state.items():
            snap = st.get("_last_snap")
            if snap is None:
                # cheap fallback — derive what we need
                snap = _ws_event_to_rest(st) or {}
                st["_last_snap"] = snap
            index.append({
                "id": ev_id,
                "league_name": snap.get("league_name") or st.get("cmp_name"),
                "home": snap.get("home") or st.get("t1_n"),
                "away": snap.get("away") or st.get("t2_n"),
                "score_home": snap.get("score_home"),
                "score_away": snap.get("score_away"),
                "status": snap.get("status"),
                "elapsed_minute": snap.get("elapsed_minute"),
                "has_odds": snap.get("main_odds") is not None,
            })
        body = {
            "updated_ts": int(time.time()),
            "count": len(index),
            "source": "ws",
            "ws_updated_ts": int(self.last_msg_ts or 0),
            "ws_connected": self.connected,
            "events": index,
        }
        try:
            tmp = GS_LIVE_DIR / "._index.json.tmp"
            with tmp.open("w", encoding="utf-8") as fh:
                json.dump(body, fh, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp, GS_LIVE_DIR / "_index.json")
        except OSError:
            pass

    # ---- message handlers ----
    def _ingest_event_meta(self, ev: dict, is_full: bool = False) -> "int | None":
        """Update / create per-event state from an avl entry or updt frame.
        Returns the event id (int) on success.

        ``is_full`` is True only for ``avl`` (full-snapshot) entries.  An
        ``updt`` delta's ``cms`` is a *partial* recent-events list, so a goal
        recount off it can under-count; a delta must never be allowed to
        regress a per-side goal tally we've already recorded (this is the
        0:2 -> 0:0 score flicker).  Full ``avl`` snapshots stay authoritative
        and may correct a score down (e.g. a VAR-disallowed goal)."""
        if not isinstance(ev, dict):
            return None
        try:
            ev_id = int(ev.get("id"))
        except (TypeError, ValueError):
            return None
        st = self._state.setdefault(ev_id, {
            "id": ev_id, "odds_by_mid": {},
        })
        _prev_t1 = st.get("t1_score")
        _prev_t2 = st.get("t2_score")
        # team names + per-team scores.  t1/t2 may be {n: "..."} or a string.
        for src_key, name_dst, score_dst in (
            ("t1", "t1_n", "t1_score"), ("t2", "t2_n", "t2_score"),
        ):
            v = ev.get(src_key)
            if isinstance(v, dict):
                n = v.get("n")
                if n:
                    st[name_dst] = str(n)
                sv = v.get("score") if v.get("score") is not None else v.get("sc")
                if sv not in (None, ""):
                    st[score_dst] = sv
            elif isinstance(v, str) and v:
                st[name_dst] = v
        # passthroughs.  The real feed sometimes uses `ctry_name`/`ctry_id`
        # where the docs show `cmp_name`/`cmp_id` — accept both into the
        # canonical `cmp_*` slot so the downstream adapter Just Works.
        for k_src, k_dst in (
            ("mid", "mid"),
            ("cmp_id", "cmp_id"), ("ctry_id", "cmp_id"),
            ("cmp_name", "cmp_name"), ("ctry_name", "cmp_name"),
            ("st", "st"), ("bm", "bm"), ("sc", "sc"), ("et", "et"),
            ("stp", "stp"), ("bl", "bl"), ("stat", "stat"), ("stats", "stats"),
            ("cms", "cms"), ("pc", "pc"),
        ):
            if k_src in ev and ev[k_src] is not None:
                # Don't let a later None overwrite a populated value
                if st.get(k_dst) and ev[k_src] in (None, ""):
                    continue
                st[k_dst] = ev[k_src]
        # Derive score.  `sc` in Goalserve WS is an internal code (e.g. "21024"),
        # NOT the goal count.  Reliable source = `cms` Goal events (mt="255",
        # ti="1"|"2") OR fallback to `stats.g: [h, a]`.  If neither, leave the
        # score state untouched (don't clobber a previously-derived value).
        cms = ev.get("cms")
        if isinstance(cms, list) and cms:
            h = a = 0
            for c in cms:
                if not isinstance(c, dict):
                    continue
                if str(c.get("mt")) == "255":  # Goal
                    ti = str(c.get("ti") or "")
                    if ti == "1":
                        h += 1
                    elif ti == "2":
                        a += 1
            st["t1_score"] = h
            st["t2_score"] = a
        elif isinstance(ev.get("stats"), dict):
            g = ev["stats"].get("g")
            if isinstance(g, list) and len(g) >= 2:
                try:
                    st["t1_score"] = int(g[0])
                    st["t2_score"] = int(g[1])
                except (TypeError, ValueError):
                    pass
        # Anti-regression guard: a partial `updt` delta (cms or t1/t2.score)
        # must never drop a per-side goal tally below what we already have —
        # otherwise a delta that omits earlier goals resets 0:2 to 0:0.  Only a
        # full `avl` snapshot is allowed to lower the score.
        if not is_full:
            for _dst, _prev in (("t1_score", _prev_t1), ("t2_score", _prev_t2)):
                _cur = st.get(_dst)
                try:
                    if _prev is not None and _cur is not None and int(_cur) < int(_prev):
                        st[_dst] = _prev
                except (TypeError, ValueError):
                    pass
        # odds
        odds = ev.get("odds")
        if isinstance(odds, list):
            for mkt in odds:
                if not isinstance(mkt, dict):
                    continue
                try:
                    mid = int(mkt.get("id"))
                except (TypeError, ValueError):
                    continue
                # store only the fields we need
                st["odds_by_mid"][mid] = {
                    "id": mid,
                    "ha": mkt.get("ha"),
                    "bl": mkt.get("bl"),
                    "o": mkt.get("o") or [],
                }
        # invalidate cached snap
        st.pop("_last_snap", None)
        return ev_id

    def handle_avl(self, msg: dict) -> int:
        """Full snapshot.  Replace state entirely so events that left the
        feed are dropped."""
        evts = msg.get("evts") or msg.get("events") or []
        new_state: "dict[int, dict]" = {}
        for ev in evts:
            try:
                ev_id = int(ev.get("id"))
            except (TypeError, ValueError):
                continue
            # carry over previous odds if avl omits them
            prev = self._state.get(ev_id) or {}
            new_state[ev_id] = {
                "id": ev_id,
                "odds_by_mid": dict(prev.get("odds_by_mid") or {}),
            }
            # Carry the last-known live score / clock / names forward so an
            # `avl` entry that omits them doesn't blank the score to None —
            # observed in prod as a 1:3 → (null → 0:0) → 1:3 flicker when a
            # full-snapshot reseed dropped the score.  _ingest_event_meta()
            # below still overwrites each field whenever this avl carries it.
            for _k in ("t1_score", "t2_score", "t1_n", "t2_n", "et", "stp"):
                _pv = prev.get(_k)
                if _pv is not None:
                    new_state[ev_id][_k] = _pv
        # swap
        self._state = new_state
        # fill metadata + odds via the same path
        n = 0
        for ev in evts:
            ev_id = self._ingest_event_meta(ev, is_full=True)
            if ev_id is not None:
                self._dirty.add(ev_id)
                n += 1
        self.last_avl_ts = time.time()
        log.info("avl: %d events seeded", n)
        return n

    def handle_updt(self, msg: dict) -> "int | None":
        ev_id = self._ingest_event_meta(msg)
        if ev_id is None:
            return None
        # detect finished — Goalserve marks via stp 7/8 or pc=0 + et beyond regulation
        try:
            if int(msg.get("stp") or 0) in (7, 8):
                self._state[ev_id]["finished"] = True
        except (TypeError, ValueError):
            pass
        self._dirty.add(ev_id)
        self.last_updt_ts = time.time()
        return ev_id

    def _dispatch(self, msg: dict) -> None:
        if not isinstance(msg, dict):
            return
        mt = msg.get("mt")
        self.last_msg_ts = time.time()
        if mt == "avl":
            self.handle_avl(msg)
        elif mt == "updt":
            self.handle_updt(msg)
        else:
            # unknown message type — log once at debug, ignore
            log.debug("unknown mt=%r", mt)

    # ---- WS run loop ----
    async def _run_ws(self) -> None:
        try:
            import websockets  # noqa: WPS433
        except ImportError as e:
            log.error("websockets package missing: %s", e)
            self.last_error = "websockets package missing"
            return

        backoff = 1.0
        while not self._stop:
            self.connect_attempts += 1
            # 1) get token
            try:
                token = await asyncio.to_thread(fetch_token, False)
            except AuthFailure as e:
                self.auth_failures += 1
                self.last_error = str(e)
                log.warning("auth failure (%s) — sleeping %.0fs (key may need WS add-on)",
                            e, GS_WS_AUTH_BACKOFF)
                await asyncio.sleep(GS_WS_AUTH_BACKOFF)
                continue
            except Exception as e:  # noqa: BLE001
                self.last_error = f"gettoken: {e}"
                log.warning("gettoken failed: %s — backoff %.1fs", e, backoff)
                await asyncio.sleep(backoff)
                backoff = min(GS_WS_MAX_BACKOFF, backoff * 2)
                continue

            url = GS_WS_URL_TMPL.format(sport=GS_WS_SPORT, token=token)
            log.info("WS connecting sport=%s (attempt %d)", GS_WS_SPORT, self.connect_attempts)
            try:
                async with websockets.connect(
                    url,
                    ping_interval=GS_WS_PING_INTERVAL,
                    ping_timeout=GS_WS_PING_TIMEOUT,
                    max_size=None,
                    open_timeout=20,
                    close_timeout=5,
                ) as ws:
                    self.connected = True
                    backoff = 1.0
                    log.info("WS connected")
                    async for raw in ws:
                        if self._stop:
                            break
                        try:
                            msg = json.loads(raw)
                        except (TypeError, ValueError):
                            continue
                        try:
                            self._dispatch(msg)
                        except Exception as e:  # noqa: BLE001 — keep loop alive
                            log.warning("dispatch failed: %s", e)
            except Exception as e:  # noqa: BLE001
                self.connected = False
                self.last_error = f"ws: {type(e).__name__}: {e}"
                # 401/403 over websocket usually surfaces as InvalidStatusCode
                msg = str(e).lower()
                if "401" in msg or "403" in msg or "unauthor" in msg or "forbidden" in msg:
                    self.auth_failures += 1
                    # token may have expired — force-refresh next attempt
                    try:
                        GS_TOKEN_CACHE.unlink()
                    except OSError:
                        pass
                    log.warning("WS auth-like close (%s) — sleep %.0fs", e, GS_WS_AUTH_BACKOFF)
                    await asyncio.sleep(GS_WS_AUTH_BACKOFF)
                    continue
                log.warning("WS closed (%s) — backoff %.1fs", e, backoff)
            finally:
                self.connected = False

            await asyncio.sleep(backoff)
            backoff = min(GS_WS_MAX_BACKOFF, max(1.0, backoff * 2))
        log.info("goalserve WS client stopped")

    # ---- public lifecycle ----
    async def start(self) -> None:
        if self._task is None:
            self._stop = False
            self._task = asyncio.create_task(self._run_ws())
            self._index_task = asyncio.create_task(self._flush_dirty_loop())
            asyncio.create_task(self._index_loop())
            self._finalize_task = asyncio.create_task(self._finalize_loop())

    async def stop(self) -> None:
        self._stop = True
        for t in (self._task, self._index_task, self._finalize_task):
            if t is None:
                continue
            t.cancel()
            try:
                await t
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._task = None
        self._index_task = None

    async def run_forever(self) -> None:
        await self.start()
        try:
            while not self._stop:
                await asyncio.sleep(60)
        except asyncio.CancelledError:
            pass
        finally:
            await self.stop()

    # ---- health ----
    def health(self) -> dict:
        now = time.time()
        return {
            "enabled": _enabled(),
            "connected": self.connected,
            "connect_attempts": self.connect_attempts,
            "auth_failures": self.auth_failures,
            "last_error": self.last_error,
            "last_msg_age_s": (now - self.last_msg_ts) if self.last_msg_ts else None,
            "last_avl_age_s": (now - self.last_avl_ts) if self.last_avl_ts else None,
            "last_updt_age_s": (now - self.last_updt_ts) if self.last_updt_ts else None,
            "events_in_state": len(self._state),
        }


    # ── Pub/sub for browser WS bridge ───────────────────────────────────
    async def subscribe(self) -> "asyncio.Queue":
        """Register a new browser-side WS subscriber.  Returns a Queue the
        caller pulls snapshot dicts from (one per dirty-event flush).  The
        queue is bounded to 64 messages: when full, the oldest is dropped
        before pushing the new value so a slow client cannot stall the
        pipeline.  Each subscriber MUST eventually be released via
        `await unsubscribe(q)`.
        """
        if self._subs_lock is None:
            self._subs_lock = asyncio.Lock()
        q: "asyncio.Queue" = asyncio.Queue(maxsize=64)
        async with self._subs_lock:
            self._subs.append(q)
        log.info("gs_ws subscriber added (total=%d)", len(self._subs))
        # Replay the current state so a fresh client sees odds immediately
        # without waiting for the next upstream tick.  Cap at 200 so a
        # cold-cache reconnect doesn't spam the wire.
        try:
            for _ev_id, st in list(self._state.items())[:200]:
                snap = st.get("_last_snap")
                if snap:
                    msg = {"type": "update", "id": snap.get("id"), "snap": snap, "replay": True}
                    try: q.put_nowait(msg)
                    except asyncio.QueueFull: break
        except Exception as e:  # noqa: BLE001
            log.warning("gs_ws replay error: %s", e)
        return q

    async def unsubscribe(self, q: "asyncio.Queue") -> None:
        """Remove a previously-subscribed queue.  Idempotent."""
        if self._subs_lock is None:
            return
        async with self._subs_lock:
            try: self._subs.remove(q)
            except ValueError: pass
        log.info("gs_ws subscriber removed (total=%d)", len(self._subs))

    def _publish(self, snap: dict) -> None:
        """Fan a snapshot out to every subscribed queue.  Non-blocking:
        full queues drop their oldest item (back-pressure protects the
        publisher; the slow client just sees a brief stutter).  Called
        from `_flush_event` synchronously — must NEVER raise."""
        if not self._subs:
            return
        self.messages_received += 1
        self.last_message_at = time.time()
        msg = {"type": "update", "id": snap.get("id"), "snap": snap}
        for q in list(self._subs):
            try:
                q.put_nowait(msg)
                self.messages_dispatched += 1
            except asyncio.QueueFull:
                # Drop oldest, push newest.
                try: q.get_nowait()
                except Exception: pass
                try: q.put_nowait(msg)
                except Exception: pass


def build_from_env() -> "GoalserveInplayWS | None":
    if not _enabled():
        log.info("goalserve WS client disabled (GS_WS_ENABLE=0)")
        return None
    return GoalserveInplayWS()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    client = GoalserveInplayWS()
    try:
        asyncio.run(client.run_forever())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
