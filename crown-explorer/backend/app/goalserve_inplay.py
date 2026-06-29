"""Goalserve In-Play ingestion.

Polls the IP-whitelisted Goalserve In-Play feed
(``http://inplay.goalserve.com/inplay-soccer.gz``) and projects every live
soccer event into the exact ``OddsEvent`` / ``main_odds`` shape the H5
frontend already consumes — so 滚球 cards render with no frontend change.

Design notes
------------
* **Goalserve id == gid.**  We use Goalserve's ``info.id`` directly as the
  event id; there is no separate Crown id space and no mapping table.
* **One upstream request at a time.**  A single server-side poller hits
  Goalserve at ``GS_POLL_INTERVAL`` (default 1.5s) regardless of how many
  browsers are connected.  Goalserve rate-limits to ~1 req/s and replies
  ``{"status":"429"}`` when exceeded, so we back off exponentially on 429.
  Browsers poll the ``/dev/shm``-backed endpoint at <1s — cheap and local.
* **Snapshot files** live in ``/dev/shm/goalserve_live/{id}.json`` (mirrors
  the existing ``/dev/shm/oddsapi_live`` pattern).  Each file is a full
  normalized event incl. ``main_odds`` and a private ``_markets`` blob for
  the detail endpoint.  Files for events that drop out of the feed are
  pruned after ``GS_STALE_GRACE`` seconds.

Run standalone for systemd::

    python -m app.goalserve_inplay
"""
from __future__ import annotations

import asyncio
import gzip
import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("goalserve_inplay")

# --------------------------------------------------------------------------
# Inplay event extraction.  Goalserve's per-match `extra` block is a dict
# keyed by sequence number whose values are `{code, minute, value}` triples:
#   {"code":"255","minute":"13","value":"13' - 1st Goal - (Bangkok University)"}
# The `code` field is a stable Goalserve event-type identifier but is not
# publicly documented; we observe (and fall back to free-text parsing of
# `value` for anything we don't recognise):
#   10  → time-period boundary (00:00-09:59) — skip
#   12  → score progression marker          — skip
#   252 → corner
#   253 → yellow card
#   254 → red card
#   255 → goal
#   256 → goal kick / shot saved
#   257 → substitution
_GS_EXTRA_CODES = {
    "252": ("corner",       "角球"),
    "253": ("yellow_card",  "黄牌"),
    "254": ("red_card",     "红牌"),
    "255": ("goal",         "进球"),
    "257": ("substitution", "换人"),
}
# Codes we deliberately ignore (period markers, etc).  Kept explicit so any
# new code shows up in logs rather than getting silently dropped.
_GS_EXTRA_IGNORE = {"10", "11", "12", "13", "14"}


def _parse_inplay_event(seq: str, e: dict, home: str, away: str) -> "dict | None":
    """Translate one raw {code, minute, value} entry into a structured event
    record.   Returns None for skipped/unknown codes so the caller can
    cheaply filter."""
    if not isinstance(e, dict):
        return None
    code = str(e.get("code") or "").strip()
    if code in _GS_EXTRA_IGNORE:
        return None
    raw_value = (e.get("value") or "").strip()
    if not raw_value:
        return None
    # Minute can be either a plain int ("13") or "45+2" extra-time form.
    minute_raw = str(e.get("minute") or "").strip()
    minute, extra_min = None, None
    try:
        if "+" in minute_raw:
            base, extra_min = minute_raw.split("+", 1)
            minute = int(base)
            extra_min = int(extra_min)
        elif minute_raw:
            minute = int(minute_raw)
    except ValueError:
        pass
    mapped = _GS_EXTRA_CODES.get(code)
    if mapped:
        kind, label_cn = mapped
    else:
        # Heuristic from natural-language value:
        v_lo = raw_value.lower()
        if "goal" in v_lo:           kind, label_cn = "goal", "进球"
        elif "red card" in v_lo:     kind, label_cn = "red_card", "红牌"
        elif "yellow card" in v_lo:  kind, label_cn = "yellow_card", "黄牌"
        elif "corner" in v_lo:       kind, label_cn = "corner", "角球"
        elif "substitution" in v_lo or "subst" in v_lo:
            kind, label_cn = "substitution", "换人"
        else:
            return None
    # Identify which side the event belongs to.   The WS path supplies a
    # structured `ti` flag ("1"=home, "2"=away) which is the most reliable
    # source.  REST `extra` blocks don't carry it, so we fall back to text-
    # matching the trailing "(<Team Name>)" clause in `value`.
    side = None
    ti = str(e.get("ti") or "").strip()
    if ti == "1":
        side = "home"
    elif ti == "2":
        side = "away"
    if side is None:
        try:
            if home and ("(" + home + ")") in raw_value:
                side = "home"
            elif away and ("(" + away + ")") in raw_value:
                side = "away"
        except Exception:  # noqa: BLE001
            pass
    return {
        "seq":    int(seq) if str(seq).isdigit() else None,
        "code":   code,
        "type":   kind,
        "label":  label_cn,
        "minute": minute,
        "extra":  extra_min,
        "side":   side,
        "team":   home if side == "home" else (away if side == "away" else None),
        "text":   raw_value,
    }


def _gs_team_lookup(name: str) -> "int | None":
    """Resolve a team name to its Goalserve numeric id via the directory
    SQLite cache.   Returns None if the directory hasn't been populated
    yet, the name is unknown, or the module fails to import — never
    raises (would break the snapshot pipeline)."""
    if not name:
        return None
    try:
        from . import goalserve_team_directory as _td
        return _td.lookup(name)
    except Exception:  # noqa: BLE001
        return None


def _gs_team_loose_lookup(name: str) -> "int | None":
    """Try the team directory with progressively-stripped name variants.

    Goalserve's inplay feed reports e.g. ``Modbury Jets Reserves`` while
    the directory only has ``Modbury Jets`` (the senior squad).  We
    accept that approximation for the badge because the parent club's
    logo is what users recognise anyway.   Variants tried, in order:

      1. exact name (handled by `_gs_team_lookup`)
      2. drop trailing ``Reserves`` / ``Res`` / ``II`` / ``B`` / ``2``
      3. drop trailing ``U21`` / ``U20`` / ``U19`` / ``U18`` / ``U17``
      4. drop trailing ``(W)`` women's marker
      5. drop trailing ``XI`` (national XI / friendly squads)
    """
    if not name:
        return None
    candidates = []
    base = name.strip()
    # Reduce in steps so a name like "Latvia U19 (W)" tries
    # "Latvia U19", "Latvia (W)", "Latvia"
    import re as _re
    _SUFFIXES = (
        r"\s+Reserves$", r"\s+Res$", r"\s+II$", r"\s+\(2\)$", r"\s+B$",
        r"\s+U2[0-3]$", r"\s+U1[7-9]$",
        r"\s+\(W\)$", r"\s+W$",
        r"\s+XI$",
        r"\s+FC$",
    )
    cur = base
    for _ in range(4):
        new = cur
        for pat in _SUFFIXES:
            new = _re.sub(pat, "", new).strip()
        if new == cur or not new:
            break
        candidates.append(new)
        cur = new
    for cand in candidates:
        hit = _gs_team_lookup(cand)
        if hit:
            return hit
    return None


def _gs_team_id_with_fallbacks(name: str, gid: int, side: str) -> "int | None":
    """Three-tier team-id resolver used by the inplay snapshot writer:

       1. exact directory lookup on `name`        (covers ~all pregame matches)
       2. **pregame snap cross-reference**         — read the snap that
          /dev/shm/goalserve_pregame already wrote for this same event
          id (when the match was still prematch) and lift its
          home/away_team_gs_id.   Goalserve's inplay-soccer.gz feed
          exposes ZERO team IDs of its own, so this is the canonical
          path for live matches.
       3. loose-name directory lookup              (suffix stripping)
    """
    # Stage 1 — exact directory hit (works only when soccernew/home or
    # the pregame poller has already cached this name).
    hit = _gs_team_lookup(name)
    if hit:
        return hit
    # Stage 2 — pregame snap cross-reference.   Cheap (single fopen +
    # json parse on a tmpfs file ~1KB), and we know `gid` is the same
    # numeric id used by both feeds.   When the match was prematch
    # earlier today, the pregame snap is still on disk (the pregame
    # writer doesn't delete it just because the match went live).
    try:
        from pathlib import Path as _Path
        pf = _Path(os.environ.get("GS_PREGAME_DIR", "/dev/shm/goalserve_pregame")) / f"{gid}.json"
        if pf.is_file():
            with pf.open("rb") as fh:
                _ps = json.load(fh)
            key = "home_team_gs_id" if side == "home" else "away_team_gs_id"
            v = _ps.get(key)
            if isinstance(v, int) and v > 0:
                return v
    except Exception:  # noqa: BLE001 — never let snap cross-ref break inplay
        pass
    # Stage 3 — loose directory match (suffix stripping).
    return _gs_team_loose_lookup(name)


def _extract_inplay_events(extra: object, home: str, away: str) -> list:
    """Collect + sort all parseable events from a raw `extra` block.
    Sorted by minute (ascending), then by seq for tie-breaking; latest
    minute appears LAST so the frontend can render an oldest-to-newest
    timeline without flipping it."""
    if not isinstance(extra, dict) or not extra:
        return []
    out = []
    for seq, ev in extra.items():
        parsed = _parse_inplay_event(seq, ev, home or "", away or "")
        if parsed is not None:
            out.append(parsed)
    out.sort(key=lambda r: (r.get("minute") or 0, r.get("extra") or 0, r.get("seq") or 0))
    return out



# --------------------------------------------------------------------------
# Config (env-overridable)
GS_INPLAY_URL = os.environ.get("GS_INPLAY_URL", "http://inplay.goalserve.com/inplay-soccer.gz")
GS_LIVE_DIR = Path(os.environ.get("GS_LIVE_DIR", "/dev/shm/goalserve_live"))
GS_POLL_INTERVAL = float(os.environ.get("GS_POLL_INTERVAL", "3.0"))
GS_STALE_GRACE = float(os.environ.get("GS_STALE_GRACE", "90"))
GS_HTTP_TIMEOUT = float(os.environ.get("GS_HTTP_TIMEOUT", "10"))
GS_MAX_BACKOFF = float(os.environ.get("GS_MAX_BACKOFF", "30"))
# When the WS client is publishing, the REST poller stays standby — it skips
# its upstream fetch as long as the WS index is fresher than this many
# seconds.  Set GS_REST_STANDBY=0 to disable (always poll).
GS_WS_FRESH_THRESHOLD = float(os.environ.get("GS_WS_FRESH_THRESHOLD", "8"))
GS_REST_STANDBY = os.environ.get("GS_REST_STANDBY", "1").strip().lower() not in ("0", "false", "no", "")

# --- Plan C: REST full-ladder main-line cache + lopsided guard --------------
# How often (s) to refresh the ladder cache from the full REST .gz feed while
# the WS is primary (standby).   15s keeps the balanced-line selection current
# without the 3s WS cadence's rate-limit risk.
GS_LADDER_REFRESH = float(os.environ.get("GS_LADDER_REFRESH", "15"))
# Cached ladder main-odds are trusted for this long before we fall back to the
# lopsided guard on the WS single line.
GS_LADDER_TTL = float(os.environ.get("GS_LADDER_TTL", "90"))
# A single ladder line whose two legs differ by more than this odds ratio
# (max/min) is considered lopsided and is suppressed when no REST ladder is
# available to replace it.   4.0 ≈ one side <=1.20 vs other >=4.8.
GS_LOPSIDED_RATIO = float(os.environ.get("GS_LOPSIDED_RATIO", "4.0"))

# gid -> {"mo": {ladder main_odds subset}, "_ts": epoch}
LADDER_MAIN_CACHE: "dict[int, dict]" = {}

# gid -> {"m": {market_id_int: full-ladder passthrough market dict}, "_ts": epoch}
# Populated from the full REST feed so the WS snap's single-line detail-panel
# markets (Asian Handicap + every Over/Under, corner/card/team handicap &
# total, half/interval line) can be replaced with the complete ladder.
LADDER_MARKETS_CACHE: "dict[int, dict]" = {}

# market_id_int -> human market name harvested from the REST feed.
# WS markets arrive with name="" (see goalserve_inplay_ws._ws_market_to_rest);
# this lets _passthrough_market resolve a real English name instead of
# emitting the bare numeric Goalserve market id in the detail panel.
GS_NAME_CACHE: "dict[int, str]" = {}

# Static id -> English name catalogue (frontend translates to Chinese).  Used
# as a fallback for the common/canonical ids the WS feed sends nameless and
# the REST name-feed (intermittently empty) hasn't populated GS_NAME_CACHE for.
GS_STATIC_NAMES: "dict[int, str]" = {
    1346: "1x2 - 80 minutes",
    11: "3-Way Handicap",
    1: "Home Team Goals", 2: "Away Team Goals", 1002: "How many goals will Away Team score?",
    31: "Total Goals", 421: "Match Goals",
    16: "Match Corners", 90006: "Asian Corners", 91001: "Last Corner",
    44: "Last Team to Score (3 way)",
    50002: "Goal Scorer", 500021: "Anytime Goal Scorer",
    500022: "To Score 2 or More", 561127121: "To Score 3 or More",
    50246: "To Win 2nd Half", 10562: "Goals Odd/Even",
    50461: "Result/Both Teams To Score", 318: "Both Teams To Score (2nd Half)",
    100509327: "5th Goal in Interval", 561127118: "Home 4th Goal in Interval",
    1334: "Away 2nd Goal in Interval", 561127132: "Next 10 Minutes Total",
    90308: "Away Team Score a Goal (2nd Half)",
    1017: "Which team will score the 5th goal?",
    9200441: "Race to the 7th corner?", 9200443: "Race to the 9th corner?",
    9200427: "Which team will score the 8th corner? (2 Way)",
}

# main_odds ladder field groups: (leg_a, leg_b, line_key)
_LADDER_GROUPS = (
    ("re_h", "re_c", "re_line"),
    ("ou_over", "ou_under", "ou_line"),
    ("reh_h", "reh_c", "reh_line"),
    ("ouh_over", "ouh_under", "ouh_line"),
    ("corners_over", "corners_under", "corners_line"),
)
_LADDER_FIELDS = tuple(k for g in _LADDER_GROUPS for k in g)


def _is_balance_ladder(mk: dict) -> bool:
    """True iff a passthrough market is a two-leg handicap/total ladder
    (Home/Away or Over/Under) carrying handicap values — the structure the
    balance-line logic applies to.   Excludes 1X2, European 3-way handicap,
    BTTS, odd/even, double chance, score grids, etc."""
    odds = mk.get("odds") or []
    if not odds:
        return False
    if not any(o.get("handicap") not in (None, "") for o in odds):
        return False
    sels = {str(o.get("selection") or "").strip().lower() for o in odds}
    return sels <= {"home", "away"} or sels <= {"over", "under"}


def _ladder_markets_from_snap(snap: dict) -> "dict[int, dict]":
    """Extract the full-ladder handicap/total passthrough markets from a
    REST snap's ``_markets`` blob, keyed by market_id_int."""
    out: "dict[int, dict]" = {}
    for mk in (snap.get("_markets") or []):
        if not isinstance(mk, dict):
            continue
        if not _is_balance_ladder(mk):
            continue
        mid = mk.get("market_id_int")
        if isinstance(mid, int) and mid > 0 and len(mk.get("odds") or []) >= 2:
            out[mid] = mk
    return out


def _cache_ladder_from_snap(snap: dict) -> None:
    """Cache a full-ladder REST snap's balanced main-odds (LADDER_MAIN_CACHE)
    AND its full handicap/total detail markets (LADDER_MARKETS_CACHE).   The
    WS snap-builder uses both to override its single-line projections."""
    try:
        gid = int(snap["id"])
    except (TypeError, ValueError, KeyError):
        return
    now = time.time()
    mo = snap.get("main_odds")
    if isinstance(mo, dict):
        sub = {k: mo[k] for k in _LADDER_FIELDS if k in mo}
        if sub:
            LADDER_MAIN_CACHE[gid] = {"mo": sub, "_ts": now}
    mkts = _ladder_markets_from_snap(snap)
    if mkts:
        LADDER_MARKETS_CACHE[gid] = {"m": mkts, "_ts": now}


def refresh_ladder_main_cache(payload: dict) -> int:
    """Project every event in a full REST payload through normalize_event
    (which picks the balanced ladder line) and cache the ladder main-odds.
    Returns the number of gids cached."""
    events = _extract_events(payload)
    now = time.time()
    n = 0
    for gsid, ev in events.items():
        try:
            snap = normalize_event(gsid, ev)
        except Exception:  # noqa: BLE001 — never break the refresh loop
            continue
        if not snap:
            continue
        _cache_ladder_from_snap(snap)
        n += 1
    # prune entries older than 3x TTL from both caches
    cutoff = GS_LADDER_TTL * 3
    for cache in (LADDER_MAIN_CACHE, LADDER_MARKETS_CACHE):
        for gid in list(cache):
            if now - cache[gid].get("_ts", 0) > cutoff:
                cache.pop(gid, None)
    return n


def apply_ladder_correction(snap: dict) -> dict:
    """Plan A + B.   For each ladder main-odds group:

      * Plan A — if a fresh REST ladder is cached for this gid, override the
        leg prices + line with the balanced REST selection.
      * Plan B — then, if the (possibly overridden) line is still lopsided
        (max/min odds > GS_LOPSIDED_RATIO), drop the group so the card hides
        the misleading near-certainty rather than offering it.

    Mutates and returns ``snap``."""
    try:
        gid = int(snap.get("id"))
    except (TypeError, ValueError):
        return snap
    # main_odds correction is skipped when no card-level odds were projected
    # (e.g. a not-yet-started match), but the detail-panel ladder merge below
    # still runs so the full ladders show up regardless.
    mo = snap.get("main_odds")
    cached = LADDER_MAIN_CACHE.get(gid)
    fresh = bool(cached and (time.time() - cached.get("_ts", 0)) < GS_LADDER_TTL)
    cmo = cached["mo"] if fresh else {}

    # Live betting cutoff: once the full-time board has closed, never restore
    # (Plan A) or re-merge cached full-time ladder lines.
    _bc = snap.get("_betting_cutoff") or {}
    _ft_closed = bool(_bc.get("ft"))
    if _ft_closed and isinstance(mo, dict):
        for _a, _b, _ln in _LADDER_GROUPS:
            mo.pop(_a, None)
            mo.pop(_b, None)
            mo.pop(_ln, None)
        cmo = {}

    for a, b, ln in (_LADDER_GROUPS if isinstance(mo, dict) else ()):
        if a not in mo and b not in mo:
            continue
        # Plan A: trust the balanced REST line when we have it.
        if a in cmo or b in cmo:
            if cmo.get(a) is not None:
                mo[a] = cmo[a]
            if cmo.get(b) is not None:
                mo[b] = cmo[b]
            if cmo.get(ln) is not None:
                mo[ln] = cmo[ln]
        # Plan B: suppress a lopsided line (no replacement available, or the
        # replacement itself is lopsided — e.g. REST also single-line).
        pa = mo.get(a) or 0.0
        pb = mo.get(b) or 0.0
        if pa > 0 and pb > 0:
            hi, lo = max(pa, pb), min(pa, pb)
            if lo > 0 and (hi / lo) > GS_LOPSIDED_RATIO:
                mo.pop(a, None)
                mo.pop(b, None)
                mo.pop(ln, None)

    # Detail-panel merge: replace the WS single-line handicap/total markets
    # with the full REST ladder so every applicable market (corner/card/team
    # handicaps & totals, half/interval lines) shows its complete ladder
    # instead of a lone — possibly lopsided, numerically-named — WS line.
    cached_m = LADDER_MARKETS_CACHE.get(gid)
    _ht_closed = bool(_bc.get("ht"))
    if cached_m and not _ft_closed and (time.time() - cached_m.get("_ts", 0)) < GS_LADDER_TTL:
        rest_markets = cached_m.get("m") or {}
        mlist = snap.get("_markets")
        if isinstance(mlist, list) and rest_markets:
            seen: "set[int]" = set()
            for i, mk in enumerate(mlist):
                if not isinstance(mk, dict):
                    continue
                mid = mk.get("market_id_int")
                if mid in rest_markets:
                    # Don't re-open a half-time ladder once the HT board has
                    # closed — keep the suspended WS line so the detail panel
                    # mirrors the (closed) card / bet-validation state.  The
                    # cached ladder entries are _passthrough_market dicts keyed
                    # by "market_name" (NOT "name"), so read that — otherwise the
                    # guard never fired and the live REST ladder re-opened the
                    # suspended 1st-half 让球 / 大小 lines after the HT cutoff.
                    _rm = rest_markets[mid]
                    if _ht_closed and _is_first_half_market(_rm.get("market_name") or _rm.get("name")):
                        seen.add(mid)
                        continue
                    mlist[i] = rest_markets[mid]
                    seen.add(mid)
            for mid, mk in rest_markets.items():
                if mid in seen:
                    continue
                if _ht_closed and _is_first_half_market(mk.get("market_name") or mk.get("name")):
                    continue
                mlist.append(mk)
            snap["market_count"] = len(mlist)
    return snap



def _enabled() -> bool:
    return os.environ.get("GS_INPLAY_ENABLE", "1").strip().lower() not in ("0", "false", "no", "")


# --------------------------------------------------------------------------
# Market mapping — Goalserve market id -> canonical name consumed by
# external._main_odds_from_ws_snap().  Keep names byte-identical to that
# helper's `by_name` keys.
GS_CANON: "dict[int, str]" = {
    1777: "ML",                 # Fulltime Result (1X2)
    12: "Spread",               # Asian Handicap (signed)
    90008: "Totals",            # Over/Under Line
    10563: "Draw No Bet",
    10115: "Double Chance",
    27: "Half Time Result",     # 1x2 (1st Half)
    29: "Spread HT",            # Asian Handicap (1st Half)
    90009: "Totals HT",         # Over/Under Line (1st Half)
    520: "Corners Totals",      # Total Corners
    10001: "Correct Score",         # "Final Score" = full-time scoreline (波胆)
    10565: "Both Teams To Score",   # BTTS (full time)
    317: "Both Teams To Score HT",  # BTTS (1st Half)
}

# Canonical names rendered inline on the list card; everything else is an
# "extra market" surfaced via the +N badge / detail page.
_INLINED = {
    "ML", "Spread", "Totals", "Draw No Bet", "Both Teams To Score",
    "Half Time Result", "Double Chance", "Spread HT", "Totals HT",
    "Corners Totals",
}

# 波胆 (correct-score) odds are capped so a single freak scoreline price
# can't blow up the max payout.  Applied at every emission point that feeds
# the bet validator (passthrough _markets + the canon row).
CS_ODDS_CAP = 300.0


def _is_correct_score_name(nm: "str | None") -> bool:
    """True for any correct-score market (波胆 / 上半场波胆) by name.  Goalserve
    in-play names the FT grid 'Final Score' and the HT grid 'Correct Score
    (1st Half)'; pregame / r_cn use 'Correct Score' / 'Correct Score 1st
    Half'; some books emit 'Exact Score'."""
    s = (nm or "").strip().lower()
    return ("correct score" in s) or (s == "final score") or ("exact score" in s)

# period -> api-sports-style short code (frontend live ticker understands these)
_PERIOD_SHORT = {
    "1st half": "1H", "first half": "1H",
    "half time": "HT", "halftime": "HT",
    "2nd half": "2H", "second half": "2H",
    "extra time": "ET", "1st extra": "ET", "2nd extra": "ET",
    "penalties": "P", "penalty shootout": "P",
}


def _f(v) -> float:
    """Coerce to float for *prices* — clamps non-positive to 0 (suspended)."""
    try:
        f = float(v)
        return f if f > 0 else 0.0
    except (TypeError, ValueError):
        return 0.0


def _hdp(v) -> float:
    """Coerce to float for *handicaps* — preserves negative values
    (home-perspective signing).  Empty / non-numeric → 0.0."""
    if v in (None, ""):
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _participants(market: dict) -> "list[dict]":
    """Return participant dicts as a list (object-keyed in the feed)."""
    parts = market.get("participants") or {}
    if isinstance(parts, dict):
        return [p for p in parts.values() if isinstance(p, dict)]
    if isinstance(parts, list):
        return [p for p in parts if isinstance(p, dict)]
    return []


def _price(p: dict, market_suspended: bool) -> float:
    if market_suspended or str(p.get("suspend")) == "1":
        return 0.0
    return _f(p.get("value_eu"))


def _by_role(parts: "list[dict]") -> "dict[str, dict]":
    """Index participants by their (lowercased) name role."""
    out: "dict[str, dict]" = {}
    for p in parts:
        role = str(p.get("name") or p.get("short_name") or "").strip().lower()
        if role and role not in out:
            out[role] = p
    return out


def _balanced_pair_from_participants(
    parts: "list[dict]",
    susp: bool,
    *,
    a_role: str,
    b_role: str,
    line_from: str = "home",
) -> tuple:
    """Return ``(role_a_dict, role_b_dict, handicap_line)`` for the most
    price-balanced line across the participant list.

    Goalserve inplay represents an Asian Handicap ladder as N home
    participants + N away participants, each tagged with a ``handicap``
    field that pairs them across lines.   The legacy ``role.get("home")``
    just grabbed whichever home leg landed in the dict first — usually a
    deep edge line.   Here we group participants by their ``handicap``
    value, then pick the (home, away) pair whose price gap is smallest.

    ``a_role`` / ``b_role`` are the two opposing role names; ``line_from``
    decides which side's handicap is canonical (``"home"`` for AH where
    away_handicap = -home_handicap, ``"any"`` for totals where both
    sides share the same line value).
    """
    a_role = a_role.lower(); b_role = b_role.lower()
    # Bucket by handicap key.   Empty / missing handicap → bucket "".
    bucket: "dict[str, dict]" = {}
    for p in parts:
        role = str(p.get("name") or p.get("short_name") or "").strip().lower()
        if role not in (a_role, b_role):
            continue
        key = str(p.get("handicap") if p.get("handicap") is not None else "")
        if a_role == "home":
            # For AH, home handicap == -away handicap; canonicalise to
            # home-perspective so the two legs land in the same bucket.
            try:
                signed = float(p.get("handicap")) if p.get("handicap") not in (None, "") else None
            except (TypeError, ValueError):
                signed = None
            if signed is not None:
                home_signed = signed if role == a_role else -signed
                key = f"{home_signed:+.3f}"
        b = bucket.setdefault(key, {})
        b.setdefault(role, p)
    best = None
    best_diff = float("inf")
    best_line = None
    for key, sides in bucket.items():
        a = sides.get(a_role)
        b = sides.get(b_role)
        if not a or not b:
            continue
        pa = _price(a, susp)
        pb = _price(b, susp)
        if pa <= 0 or pb <= 0:
            continue
        diff = abs(pa - pb)
        if diff < best_diff:
            best_diff = diff
            best = (a, b)
            # Determine canonical line value
            if line_from == "home":
                ln = a.get("handicap")
            else:
                ln = a.get("handicap") if a.get("handicap") is not None else b.get("handicap")
            best_line = ln
    if best is None:
        # Fall back to the legacy "first of each role" pick — keeps the
        # snapshot non-empty when no balanced pair is available.
        role = _by_role(parts)
        return (role.get(a_role) or {}, role.get(b_role) or {},
                (role.get(a_role) or {}).get("handicap")
                or (role.get(b_role) or {}).get("handicap"))
    return (best[0], best[1], best_line)


def _canon_row(canon_name: str, market: dict) -> "list[dict]":
    """Translate a Goalserve market into the canonical odds-row list shape
    consumed by _main_odds_from_ws_snap (keys: home/draw/away/over/under/
    yes/no/hdp/label)."""
    susp = str(market.get("suspend")) == "1"
    parts = _participants(market)
    role = _by_role(parts)

    def pr(name: str) -> float:
        p = role.get(name)
        return _price(p, susp) if p else 0.0

    if canon_name in ("ML",):
        return [{"home": pr("home"), "draw": pr("draw"), "away": pr("away")}]

    if canon_name == "Half Time Result":
        # consumer indexes rows[0..2]; emit one row per outcome
        return [
            {"home": pr("home")},
            {"draw": pr("draw")},
            {"away": pr("away")},
        ]

    if canon_name in ("Spread", "Spread HT"):
        # Pick the most price-balanced (home, away) pair across all
        # participant handicap lines.   See module-level docstring.
        home, away, hdp = _balanced_pair_from_participants(parts, susp,
            a_role="home", b_role="away", line_from="home")
        return [{
            "home": _price(home, susp) if home else 0.0,
            "away": _price(away, susp) if away else 0.0,
            "hdp": _hdp(hdp),
        }]

    if canon_name in ("Totals", "Totals HT", "Corners Totals"):
        over, under, line = _balanced_pair_from_participants(parts, susp,
            a_role="over", b_role="under", line_from="any")
        return [{
            "over": _price(over, susp) if over else 0.0,
            "under": _price(under, susp) if under else 0.0,
            "hdp": _hdp(line),
        }]

    if canon_name == "Draw No Bet":
        return [{"home": pr("home"), "away": pr("away")}]

    if canon_name in ("Both Teams To Score", "Both Teams To Score HT"):
        return [{"yes": pr("yes"), "no": pr("no")}]

    if canon_name == "Correct Score":
        # Outcomes arrive as "H:A" scorelines (e.g. "2:1").  Emit one row per
        # scoreline with a "H-A" label — the shape build_rcn() turns into the
        # <PD><ior_HhCc> tags the r_cn parser / PHP already render as 波胆.
        rows: "list[dict]" = []
        for p in parts:
            nm = str(p.get("name") or p.get("short_name") or "").strip()
            mm = re.match(r"^(\d+)\s*[:\-]\s*(\d+)$", nm)
            if not mm:
                continue
            price = _price(p, susp)
            if price > CS_ODDS_CAP:
                price = CS_ODDS_CAP
            if price > 0:
                rows.append({"label": f"{mm.group(1)}-{mm.group(2)}", "price": price})
        return rows

    if canon_name == "Double Chance":
        rows = []
        for p in parts:
            rows.append({
                "label": str(p.get("name") or ""),
                "under": _price(p, susp),
            })
        return rows

    # default passthrough — one row per participant
    return [{"label": str(p.get("name") or ""), "price": _price(p, susp)} for p in parts]


def _passthrough_market(gs_key: str, market: dict) -> dict:
    """Generic OddsMarket-shape projection for the detail endpoint."""
    susp = str(market.get("suspend")) == "1"
    try:
        mid_int = int(gs_key)
    except (TypeError, ValueError):
        mid_int = 0
    nm = market.get("name")
    if nm:
        # REST path: remember the real name so the WS path can reuse it.
        if mid_int:
            GS_NAME_CACHE[mid_int] = nm
    else:
        # WS path (name=""): resolve a real name from (in priority order) the
        # live REST harvest, the canonical map, then the static catalogue —
        # falling back to the bare numeric id only as a last resort.
        nm = (GS_NAME_CACHE.get(mid_int)
              or GS_CANON.get(mid_int)
              or GS_STATIC_NAMES.get(mid_int)
              or str(gs_key))
    _cap_cs = _is_correct_score_name(nm)
    odds = []
    for p in _participants(market):
        price = _price(p, susp)
        if _cap_cs and price > CS_ODDS_CAP:
            price = CS_ODDS_CAP
        row = {
            "selection": p.get("name"),
            "price": price,
        }
        if p.get("handicap") not in (None, ""):
            row["handicap"] = p.get("handicap")
        odds.append(row)
    return {
        "market_id": str(gs_key).zfill(6),
        "market_id_int": mid_int,
        "market_name": nm,
        "odds": odds,
        "updated_at_iso": None,
        "updated_at_ts": None,
    }


def _iso_from_ts(ts) -> "str | None":
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


# --------------------------------------------------------------------------
# Live betting cutoff + degenerate-1X2 guard.
#
# Goalserve keeps the 1X2 (market 1777) and other full-time markets open even
# when a result is all but decided, quoting degenerate prices (favourite near
# 1.00, long-shots clamped to the feed ceiling near 51) WITHOUT setting the
# per-market suspend flag.   Two rules close these so the board never offers a
# dead price:
#   * time cutoff  -- full-time markets close at minute >= 92 (i.e. 90+2'
#                     stoppage) UNLESS Goalserve signals the match has ended
#                     (period "Full Time"/"finished"), which closes them at
#                     once; 1st-half markets close at minute >= 45 (the
#                     half-time whistle).
#   * degenerate   -- a live 1X2 with ANY leg <= GS_DEGEN_FAV_MAX (favourite too
#                     short) or > GS_DEGEN_LONG_MAX (a leg blown out) is a
#                     one-sided/distorted board we don't offer; suspended.
GS_FT_CUTOFF_MIN = int(os.environ.get("GS_FT_CUTOFF_MIN", "92"))
GS_HT_CUTOFF_MIN = int(os.environ.get("GS_HT_CUTOFF_MIN", "45"))
# In-play 1X2 close rule (operator): close 独赢 when any leg <= 1.2 OR > 5.
# Both env-tunable so the cutoff can be adjusted live without a redeploy.
GS_DEGEN_FAV_MAX = float(os.environ.get("GS_DEGEN_FAV_MAX", "1.2"))
GS_DEGEN_LONG_MAX = float(os.environ.get("GS_DEGEN_LONG_MAX", "5"))
GS_FT_LATCH_TTL = int(os.environ.get("GS_FT_LATCH_TTL", "21600"))
# gid -> (ts, minute): last ACCEPTED in-progress match clock.  Replaces the old
# per-gid FT/ET closure latches.  Lets a clock-less frame inherit the last good
# minute (so a board legitimately closed at 85'+/ET stays closed) WITHOUT a
# one-off clock spike being able to close -- or 6h-latch -- a still-live board.
_CLOCK_STATE: "dict[int, tuple]" = {}
# Fixed slack (minutes) added to the real-time-based max advance when judging a
# forward jump; the football clock cannot outrun real time, so a frame whose
# minute teleports further ahead than (elapsed real time + slack) is a glitch.
GS_CLOCK_MAX_JUMP_MIN = float(os.environ.get("GS_CLOCK_MAX_JUMP_MIN", "4"))

# Extra-time board: the full-time (90-min) markets are decided at the 90'
# whistle, but the knockout-stage EXTRA-TIME markets (those carrying "Extra
# Time" in their name) are live and undecided through 91..120'.  They are
# exempt from the 90-min cutoff and instead close near the end of ET -- the
# full-ET board 5 min before the 120' whistle, the ET-1st-half board 5 min
# before the 105' ET-HT whistle.  Penalty / qualify / method-of-victory
# deciders carry no minute clock and rely on the feed suspend + degenerate
# guard until the tie is settled.
GS_ET_CUTOFF_MIN = int(os.environ.get("GS_ET_CUTOFF_MIN", "118"))
GS_ET_HT_CUTOFF_MIN = int(os.environ.get("GS_ET_HT_CUTOFF_MIN", "103"))
# 1X2 market ids that get the degenerate-price guard (favourite <= FAV_MAX or
# any leg >= CEILING): full-time 1777 + extra-time 2134 / ET-1st-half 2135.
_DEGEN_1X2_IDS = {1777, 2134, 2135}
# gid -> (ts, phase) where phase in {"ET","PEN"}.  Latches the live PHASE for
# the frontend ticker from the Goalserve period state ONLY (WS `stp` 4/5->ET,
# 6->PEN via status_short, or the REST period string) -- NEVER from the
# elapsed minute or the `extra` code-2 anchor, so 2nd-half stoppage (90+X,
# still the 2nd half) is never shown as extra time.  Latched (and gated by
# elapsed>=80) so a later frame whose stp regressed to "1H"/None keeps it.
_PHASE_LATCH: "dict[int, tuple]" = {}


def _lead_minute(v):
    """Leading integer minute, tolerant of stoppage forms like 45+2."""
    s = str(v if v is not None else "").strip()
    num = ""
    for ch in s:
        if ch.isdigit():
            num += ch
        else:
            break
    return int(num) if num else None


def _sanitize_clock(ev_id, minute):
    """Carry-forward + forward-spike-reject the live match minute.

    Returns the trusted leading minute (int) or None.  A clock-less frame
    inherits the last accepted minute (within GS_FT_LATCH_TTL); a frame whose
    minute jumps further ahead than real elapsed time (plus a small slack)
    allows is rejected and the last accepted value kept -- so a transient
    Goalserve glitch frame can no longer close (let alone 6h-latch) the
    full-time / ET board, while a genuine sustained climb is admitted as real
    time catches up.  Backward corrections (e.g. a receding spike) are accepted
    immediately.
    """
    now = int(time.time())
    if len(_CLOCK_STATE) > 4096:
        for _k in [k for k, v in _CLOCK_STATE.items() if now - v[0] > GS_FT_LATCH_TTL]:
            _CLOCK_STATE.pop(_k, None)
    prev = _CLOCK_STATE.get(ev_id)
    if minute is None:
        # clock-less frame: inherit a recent clock, else stay unknown.
        if prev is not None and (now - prev[0]) <= GS_FT_LATCH_TTL:
            return prev[1]
        return None
    if prev is not None:
        allowed = (now - prev[0]) / 60.0 + GS_CLOCK_MAX_JUMP_MIN
        if minute - prev[1] > allowed:
            # implausible forward spike -> ignore; keep last accepted (do NOT
            # refresh its ts, so a real climb is admitted once enough time has
            # elapsed for the jump to become physically plausible).
            return prev[1]
    _CLOCK_STATE[ev_id] = (now, minute)
    return minute


def _is_first_half_market(name):
    """True for 1st-half / half-time markets (settle at the HT whistle).
    2nd-half markets settle at full time and count as full-time markets.

    Matches the canonical " HT" suffix names (Spread HT / Totals HT / Both
    Teams To Score HT) via a standalone-"ht" token in addition to the
    "1st half" / "first half" / "half time" descriptive forms, so the backend
    suspend decision stays in lockstep with the frontend isFirstHalfMarket
    (sports.html) — otherwise the canon-named 1st-half handicap / total ladders
    were never suspended at the HT cutoff and stayed bookable."""
    n = (name or "").lower()
    if "2nd half" in n or "second half" in n or "2h" in n:
        return False
    return (
        "1st half" in n or "first half" in n or "half time" in n
        or "halftime" in n or "(1h)" in n
        or re.search(r"(^|[^a-z])ht([^a-z]|$)", n) is not None
    )


def _betting_cutoffs(status_short, minute, period=None, extra=None):
    """Return (full_time_closed, first_half_closed) for the live cutoff rule.

    Clock-based first (the Goalserve half label is unreliable on the WS
    feed -- it reports "1H" for every live match).  We additionally honour
    the REST `period` string (reliable: "Second Half of Extra Time",
    "Full Time", "Penalties", ...) and the `extra` timeline anchor
    `code == "2"` ("Score After Full Time") so the full-time board stays
    closed through stoppage / extra time even on a frame with no clock.
    """
    full = ht = False
    mn = _lead_minute(minute)
    if mn is not None:
        # clock-based: the 1st-half board closes from GS_HT_CUTOFF_MIN (45',
        # the half-time whistle) onward and STAYS closed for the rest of the
        # match.  The sanitized clock only advances, so latching at >=45' is
        # what keeps the half-time markets from reopening in the 2nd half.
        # Full-time board closes from 92' (90+2' stoppage) -- or earlier the
        # moment Goalserve signals the match has ended (period label below).
        if mn >= GS_HT_CUTOFF_MIN:
            ht = True
        if mn >= GS_FT_CUTOFF_MIN:
            full = True
    # Status-label latch (when the clock is missing/unreliable): any
    # half-time-or-later short code keeps the 1st-half board closed.
    ss = (status_short or "").upper()
    if ss in ("HT", "2H", "BT", "INT", "ET", "AET", "P", "PEN", "FT"):
        ht = True
    # Reliable period label (REST feed): extra time / full time / penalties
    # mean the 90-min full-time board is decided.
    pl = (period or "").lower()
    if any(t in pl for t in ("extra time", "full time", "fulltime", "penalt",
                             "ended", "finished", "after et", "aet", "a.e.t")):
        full = True
    if full or any(t in pl for t in ("half time", "halftime", "2nd half",
                                     "second half")):
        ht = True
    # Extra-event anchor: "Score After Full Time" (code == "2") => the
    # 90-minute result is settled, so the full-time board is decided.
    items = None
    if isinstance(extra, dict):
        items = extra.values()
    elif isinstance(extra, list):
        items = extra
    if items:
        for _it in items:
            if isinstance(_it, dict) and str(_it.get("code")) == "2":
                full = True
                ht = True
                break
    return full, ht


def _is_degenerate_1x2(market):
    """In-play 1X2 close rule: a live 独赢 board is degenerate (suspended, never
    re-priced) when ANY active leg is <= GS_DEGEN_FAV_MAX (favourite too short)
    or > GS_DEGEN_LONG_MAX (a leg blown out) — e.g. 1.13 / 6.00 / 21.00."""
    vals = []
    for p in _participants(market):
        if str(p.get("suspend")) == "1":
            continue
        try:
            v = float(p.get("value_eu"))
        except (TypeError, ValueError):
            continue
        if v > 0:
            vals.append(v)
    if len(vals) < 2:
        return False
    return min(vals) <= GS_DEGEN_FAV_MAX or max(vals) > GS_DEGEN_LONG_MAX


def normalize_event(gsid: str, ev: dict) -> "dict | None":
    """Project one Goalserve event into the OddsEvent snapshot dict."""
    if not isinstance(ev, dict):
        return None
    info = ev.get("info") or {}
    ti = ev.get("team_info") or {}
    core = ev.get("core") or {}
    odds = ev.get("odds") or {}

    try:
        ev_id = int(info.get("id") or gsid)
    except (TypeError, ValueError):
        return None

    home = (ti.get("home") or {}).get("name") or (info.get("name") or " vs ").split(" vs ")[0]
    away = (ti.get("away") or {}).get("name") or ((info.get("name") or " vs ").split(" vs ") + [""])[1]

    score = str(info.get("score") or "")
    sh = sa = None
    if ":" in score:
        a, _, b = score.partition(":")
        try:
            sh, sa = int(a), int(b)
        except ValueError:
            sh = sa = None

    finished = str(core.get("finished")) == "1"
    period = str(info.get("period") or "")
    status_short = _PERIOD_SHORT.get(period.strip().lower(), period or None)
    try:
        elapsed = int(info.get("minute")) if str(info.get("minute") or "").isdigit() else None
    except (TypeError, ValueError):
        elapsed = None

    # ---- markets ----
    canon_markets: "list[dict]" = []
    bookmaker_markets: "list[dict]" = []
    extra: "list[dict]" = []
    # Sanitised live clock (carry-forward across a clock-less frame + reject an
    # implausible forward spike).  This REPLACES the old _FT_LATCH/_ET_LATCH
    # booleans: a transient glitch frame can no longer close -- let alone 6h-
    # latch -- the full-time / ET board, while a clock-less frame still inherits
    # the last good minute so a legitimately-closed board stays closed.
    _cut_min = _sanitize_clock(ev_id, _lead_minute(info.get("minute")))
    _tnow = int(time.time())
    _full_cutoff, _ht_cutoff = _betting_cutoffs(status_short, _cut_min, period, ev.get("extra"))
    # Extra-time board cutoff -- independent of the 90-min full-time cutoff.
    # _et_full closes the full-ET markets near the 120' whistle; _et_half the
    # ET-1st-half markets near the 105' ET-HT whistle.  Penalties / "after
    # extra time" / ended also close the ET board.  Driven by the sanitised
    # clock, so a one-off clock spike can't trip it.
    _pl = (period or "").lower()
    _et_full = (_cut_min is not None and _cut_min >= GS_ET_CUTOFF_MIN)
    _et_half = (_cut_min is not None and _cut_min >= GS_ET_HT_CUTOFF_MIN)
    if any(t in _pl for t in ("penalt", "after extra", "ended", "finished")):
        _et_full = _et_half = True
    if _et_full:
        _et_half = True
    # Live PHASE (extra time / penalties) for the frontend ticker.  Sourced
    # ONLY from the Goalserve period state -- status_short already carries the
    # WS `stp` (4/5->ET, 6->P) and the REST period maps the same way -- NEVER
    # from the elapsed minute or the code-2 anchor, so 2nd-half stoppage is
    # never mislabelled as extra time.  Gated by elapsed>=80 (sanity against a
    # spurious early stp) and latched per gid so a frame whose stp regressed
    # to "1H"/None keeps the phase.
    _ss_u = (status_short or "").upper()
    _phase = None
    if _ss_u in ("P", "PEN") or "penalt" in _pl:
        _phase = "PEN"
    elif _ss_u == "ET" or "extra time" in _pl:
        _phase = "ET"
    if _phase and not (elapsed is None or elapsed >= 80):
        _phase = None
    if _phase:
        _PHASE_LATCH[ev_id] = (_tnow, _phase)
    elif not finished and ev_id in _PHASE_LATCH and (_tnow - _PHASE_LATCH[ev_id][0]) <= GS_FT_LATCH_TTL:
        _phase = _PHASE_LATCH[ev_id][1]
    if len(_PHASE_LATCH) > 4096:
        for _k in [k for k, v in _PHASE_LATCH.items() if _tnow - v[0] > GS_FT_LATCH_TTL]:
            _PHASE_LATCH.pop(_k, None)
    if not finished:
        if _phase:
            status_short = _phase
        elif _ss_u in ("ET", "P", "PEN"):
            # raw stp said ET/PEN but it failed the elapsed>=80 sanity gate and
            # isn't latched -> suppress it so the ticker falls back to the
            # minute-derived half (stoppage), never a spurious early 加时.
            status_short = None
    for gs_key, market in odds.items():
        if not isinstance(market, dict):
            continue
        try:
            mid_int = int(market.get("id") or gs_key)
        except (TypeError, ValueError):
            mid_int = None
        canon = GS_CANON.get(mid_int) if mid_int is not None else None
        _mi = mid_int if isinstance(mid_int, int) else 0
        nm = (market.get("name") or canon
              or GS_NAME_CACHE.get(_mi) or GS_STATIC_NAMES.get(_mi)
              or str(gs_key))
        # Live betting cutoff + degenerate-1X2 guard: flag the raw market
        # suspended so _canon_row / _passthrough_market zero its prices, which
        # keeps the display main_odds and the /markets bet source in agreement.
        _fh = _is_first_half_market(nm)
        _nm_l = nm.lower()
        _is_et = "extra time" in _nm_l
        _is_decider = ("penalt" in _nm_l or "shootout" in _nm_l
                       or "to qualify" in _nm_l or "method of victory" in _nm_l)
        if _is_decider:
            # Knockout deciders settle at the end of the tie (after ET /
            # shootout); no 90-min clock applies -- honour only the feed
            # suspend (passthrough) + the degenerate-price guard.
            _suspend = _is_degenerate_1x2(market)
        elif _is_et:
            # Extra-time markets: exempt from the 90-min cutoff; close near the
            # end of ET instead (ET-1st-half markets at the ET-HT whistle).
            _suspend = (_et_half if _fh else _et_full)
            if mid_int in _DEGEN_1X2_IDS and _is_degenerate_1x2(market):
                _suspend = True
        else:
            # 90-minute markets: HT board closes at 45'; full-time board at 92'+.
            _suspend = ((_ht_cutoff and _fh)
                        or (_full_cutoff and not _fh)
                        or (mid_int in _DEGEN_1X2_IDS and _is_degenerate_1x2(market)))
        if _suspend:
            market = {**market, "suspend": "1"}
        if canon:
            canon_markets.append({"name": canon, "odds": _canon_row(canon, market)})
        bookmaker_markets.append(_passthrough_market(str(market.get("id") or gs_key), market))
        if (canon or nm) not in _INLINED:
            extra.append({"name": nm, "outcomes": len(_participants(market))})

    # main_odds via the shared projection — imported lazily to avoid a
    # circular import at module load (external imports nothing from here).
    from .routers.external import _main_odds_from_ws_snap
    mo = _main_odds_from_ws_snap({"markets": canon_markets})
    if not (mo and any(mo.values())):
        mo = None

    # Live stats — corners / cards / fouls / shots — passed in via
    # ``info["_stats"]`` (Goalserve WS `stats` dict).  Each key is a
    # ``[home, away]`` int pair.  Keys: c=corners, y=yellow, r=red,
    # f=fouls, s=shots-on-target, o=offsides, p=penalties, t=throw-ins,
    # g=goals (often stale, prefer cms), a=attacks, h1=first-half goals.
    def _pair(stats: dict, k: str):
        v = stats.get(k) if isinstance(stats, dict) else None
        if isinstance(v, list) and len(v) >= 2:
            try:
                return int(v[0]), int(v[1])
            except (TypeError, ValueError):
                return None, None
        return None, None
    _st = info.get("_stats")
    yc_h, yc_a = _pair(_st, "y")
    rc_h, rc_a = _pair(_st, "r")
    co_h, co_a = _pair(_st, "c")
    fo_h, fo_a = _pair(_st, "f")
    sh_h, sh_a = _pair(_st, "s")
    # Half-time score from first-half goals (`h1`).  Only populate once
    # half-time has actually been reached — during the first half `h1`
    # equals the running score, and exposing it as the HT score would make
    # the HT-market expiry / display logic believe half-time already passed.
    _past_ht = (
        (status_short or "").upper() in ("HT", "2H", "ET", "BT", "INT", "FT", "AET", "PEN")
        or (elapsed is not None and elapsed >= 45)
    )
    ht_h, ht_a = _pair(_st, "h1") if _past_ht else (None, None)

    now = int(time.time())
    snap = {
        "id": ev_id,
        "sport_slug": "soccer",
        "league_slug": str(info.get("league_id") or ""),
        "league_name": info.get("league"),
        "league_cn": None, "home_cn": None, "away_cn": None,
        "home": home, "away": away,
        "home_id": home, "away_id": away,
        # Goalserve numeric team IDs (resolved via goalserve_team_directory).
        # Used by the /api/external/logos endpoint and the frontend <img>
        # crest tags.   Falls back to None for teams we haven't directory-
        # crawled yet — frontend then renders the legacy initials badge.
        "home_team_gs_id": _gs_team_id_with_fallbacks(home, int(ev_id), "home"),
        "away_team_gs_id": _gs_team_id_with_fallbacks(away, int(ev_id), "away"),
        # Inplay event timeline (goals, cards, corners, subs) parsed from
        # Goalserve's per-match `extra` field.   Empty list when the feed
        # hasn't reported any events yet.   The /events/{id}/inplay-events
        # endpoint serves this list verbatim.
        "_inplay_events": _extract_inplay_events(ev.get("extra"), home, away),
        "commence_iso": _iso_from_ts(info.get("start_ts_utc") or info.get("start_ts")),
        "commence_ts": int(info.get("start_ts_utc") or info.get("start_ts") or 0) or None,
        "status": "finished" if finished else "inplay",
        "score_home": sh, "score_away": sa,
        "score_home_ht": ht_h, "score_away_ht": ht_a,
        "is_finished": finished,
        "fetched_at": now,
        "market_count": len(bookmaker_markets),
        "apisports_fixture_id": None,
        "apisports_match_iso": None,
        "apisports_stats_seen_at": now if _st else None,
        "elapsed_minute": elapsed,
        "status_short": status_short,
        "yc_home": yc_h, "yc_away": yc_a,
        "rc_home": rc_h, "rc_away": rc_a,
        "corners_home": co_h, "corners_away": co_a,
        "fouls_home": fo_h,   "fouls_away": fo_a,
        "shots_home": sh_h,   "shots_away": sh_a,
        "main_odds": mo,
        "_betting_cutoff": {"ft": _full_cutoff, "ht": _ht_cutoff, "et": _et_full},
        "extra_markets": extra,
        # private — not surfaced on the list; consumed by /markets endpoint
        "_markets": bookmaker_markets,
        "_bm": None,
        "_gs": {
            "mid": info.get("mid"),
            "bet365id": info.get("bet365id"),
            "state": info.get("state"),
            "seconds": info.get("seconds"),
            "period": period,
        },
        "_updated_ts": now,
    }
    return snap


def _extract_events(payload: dict) -> "dict[str, dict]":
    if isinstance(payload, dict) and isinstance(payload.get("events"), dict):
        return payload["events"]
    return {}


# --------------------------------------------------------------------------
# Read helpers (used by the router)
def read_event_full(gid: int) -> "dict | None":
    p = GS_LIVE_DIR / f"{int(gid)}.json"
    try:
        with p.open("rb") as fh:
            return json.load(fh)
    except (FileNotFoundError, ValueError, OSError):
        return None


def list_events(include_finished: bool = False) -> "list[dict]":
    out: "list[dict]" = []
    try:
        files = list(GS_LIVE_DIR.glob("*.json"))
    except OSError:
        return out
    for f in files:
        if f.name.startswith("_"):
            continue
        try:
            with f.open("rb") as fh:
                snap = json.load(fh)
        except (ValueError, OSError):
            continue
        if not include_finished and snap.get("is_finished"):
            continue
        public = {k: v for k, v in snap.items() if not k.startswith("_")}
        out.append(public)
    out.sort(key=lambda e: (e.get("league_name") or "", e.get("id") or 0))
    return out


class RateLimited(Exception):
    pass


class GoalserveInplayPoller:
    def __init__(self) -> None:
        self._task: "asyncio.Task | None" = None
        self._stop = False
        self._backoff = 0.0
        self.last_ok_ts: "float | None" = None
        self.last_event_count = 0
        self.consecutive_429 = 0

    # -- fetch (blocking; run via to_thread) --
    def _fetch(self) -> dict:
        req = urllib.request.Request(GS_INPLAY_URL, headers={"User-Agent": "crown-gold/goalserve"})
        try:
            with urllib.request.urlopen(req, timeout=GS_HTTP_TIMEOUT) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            if e.code == 429:
                raise RateLimited("HTTP 429")
            raise
        try:
            data = gzip.decompress(raw)
        except (OSError, EOFError):
            data = raw
        try:
            payload = json.loads(data)
        except ValueError:
            raise RateLimited("non-JSON body (likely rate-limit page)")
        if isinstance(payload, dict) and str(payload.get("status")) == "429":
            raise RateLimited("body status 429")
        return payload

    def _ensure_dir(self) -> None:
        try:
            GS_LIVE_DIR.mkdir(parents=True, exist_ok=True)
            os.chmod(GS_LIVE_DIR, 0o775)
        except OSError:
            pass

    def _write_snapshot(self, payload: dict) -> int:
        self._ensure_dir()
        events = _extract_events(payload)
        seen: "set[str]" = set()
        index: "list[dict]" = []
        for gsid, ev in events.items():
            snap = normalize_event(gsid, ev)
            if not snap:
                continue
            # REST is the full-ladder source: warm the cache, then run the
            # correction (idempotent here — also applies the lopsided guard
            # for any match REST itself only has a single line for).
            _cache_ladder_from_snap(snap)
            apply_ladder_correction(snap)
            fid = str(snap["id"])
            seen.add(fid)
            tmp = GS_LIVE_DIR / f".{fid}.json.tmp"
            dst = GS_LIVE_DIR / f"{fid}.json"
            try:
                with tmp.open("w", encoding="utf-8") as fh:
                    json.dump(snap, fh, ensure_ascii=False, separators=(",", ":"))
                os.replace(tmp, dst)
            except OSError as e:
                log.warning("write %s failed: %s", dst, e)
                continue
            # Optional DB hook — gated by GS_DB_WRITE.  Failures must NOT
            # affect the snapshot pipeline (display has to keep working).
            try:
                from . import goalserve_dbwriter as _gw
                if _gw.GS_DB_WRITE:
                    _gw.upsert_event(snap)
            except Exception as e:  # noqa: BLE001
                log.warning("dbwriter upsert %s failed: %s", fid, e)
            index.append({
                "id": snap["id"], "league_name": snap["league_name"],
                "home": snap["home"], "away": snap["away"],
                "score_home": snap["score_home"], "score_away": snap["score_away"],
                "status": snap["status"], "elapsed_minute": snap["elapsed_minute"],
                "has_odds": snap["main_odds"] is not None,
            })
        # index
        try:
            itmp = GS_LIVE_DIR / "._index.json.tmp"
            with itmp.open("w", encoding="utf-8") as fh:
                json.dump({"updated_ts": int(time.time()), "count": len(index),
                           "source": "rest",
                           "bm": payload.get("bm"), "events": index},
                          fh, ensure_ascii=False, separators=(",", ":"))
            os.replace(itmp, GS_LIVE_DIR / "_index.json")
        except OSError:
            pass
        # prune stale files (events that left the feed)
        now = time.time()
        for f in GS_LIVE_DIR.glob("*.json"):
            if f.name.startswith("_") or f.stem in seen:
                continue
            try:
                if now - f.stat().st_mtime > GS_STALE_GRACE:
                    f.unlink()
            except OSError:
                pass
        return len(seen)

    def _ws_is_fresh(self) -> bool:
        """Return True iff the WS client has written a recent index entry —
        in that case we stay standby and skip the upstream fetch."""
        if not GS_REST_STANDBY:
            return False
        try:
            with (GS_LIVE_DIR / "_index.json").open("rb") as fh:
                idx = json.load(fh)
        except (OSError, ValueError):
            return False
        if str(idx.get("source")) != "ws":
            return False
        ws_ts = float(idx.get("ws_updated_ts") or 0)
        if ws_ts <= 0:
            return False
        if not idx.get("ws_connected"):
            return False
        return (time.time() - ws_ts) < GS_WS_FRESH_THRESHOLD

    async def _run(self) -> None:
        log.info("goalserve in-play poller starting url=%s interval=%.2fs dir=%s",
                 GS_INPLAY_URL, GS_POLL_INTERVAL, GS_LIVE_DIR)
        last_ladder_ts = 0.0
        while not self._stop:
            if self._ws_is_fresh():
                # WS is the primary source — sit out the snapshot write, but
                # still refresh the full-ladder main-odds cache on a slow
                # cadence so the WS snap-builder can override its single-line
                # ladder markets with the balanced REST selection (Plan C).
                now = time.time()
                if now - last_ladder_ts >= GS_LADDER_REFRESH:
                    try:
                        payload = await asyncio.to_thread(self._fetch)
                        # Parse the full REST feed OFF the event loop: this is a
                        # CPU-heavy parse of the whole .gz book and used to run
                        # inline on the loop every GS_LADDER_REFRESH, adding a
                        # periodic latency blip to WS frames + HTTP.  to_thread
                        # keeps the loop free (LADDER_*_CACHE dict writes are
                        # GIL-atomic vs the loop/threadpool readers).
                        cnt = await asyncio.to_thread(refresh_ladder_main_cache, payload)
                        last_ladder_ts = now
                        log.debug("ladder cache refreshed: %d gids", cnt)
                    except RateLimited as e:
                        last_ladder_ts = now  # respect the rate limit window
                        log.warning("ladder refresh rate-limited: %s", e)
                    except Exception as e:  # noqa: BLE001
                        log.warning("ladder refresh failed: %s", e)
                await asyncio.sleep(GS_POLL_INTERVAL)
                continue
            try:
                payload = await asyncio.to_thread(self._fetch)
            except RateLimited as e:
                self.consecutive_429 += 1
                # linear growth so a single 429 only costs one extra interval
                self._backoff = min(GS_MAX_BACKOFF, (self._backoff or 0.0) + GS_POLL_INTERVAL)
                log.warning("rate-limited (%s) — backing off %.1fs", e, self._backoff)
                await asyncio.sleep(self._backoff)
                continue
            except Exception as e:  # noqa: BLE001 — keep the loop alive
                log.warning("fetch failed: %s", e)
                await asyncio.sleep(min(GS_MAX_BACKOFF, GS_POLL_INTERVAL * 2))
                continue
            self.consecutive_429 = 0
            self._backoff = 0.0
            try:
                n = await asyncio.to_thread(self._write_snapshot, payload)
                self.last_ok_ts = time.time()
                self.last_event_count = n
            except Exception as e:  # noqa: BLE001
                log.warning("write_snapshot failed: %s", e)
            await asyncio.sleep(GS_POLL_INTERVAL)
        log.info("goalserve in-play poller stopped")

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


def build_from_env() -> "GoalserveInplayPoller | None":
    if not _enabled():
        log.info("goalserve in-play poller disabled (GS_INPLAY_ENABLE=0)")
        return None
    return GoalserveInplayPoller()


def main() -> None:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    poller = GoalserveInplayPoller()
    try:
        asyncio.run(poller.run_forever())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
