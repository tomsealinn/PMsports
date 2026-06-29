"""A2 enrich-at-finalize for Goalserve auto-settlement.

Once a Goalserve match is finalised (``foot_match.is_inball=1``), this
module fetches the post-match ``soccerfixtures`` feed and stores a compact
goal/card/sub timeline + extra-time / penalty / regulation scores into the
``foot_match.gs_*`` columns (see .notes/a2_foot_match_migration.sql).

settle_bets.php PRIORITY-0 reads these columns and settle_graders.php grades
the A2 markets from them — NO per-settle external calls (same architecture
as A1 / Tier-0).

SAFETY: every public entry point is wrapped so a failure can NEVER break the
finalize loop or the snapshot pipeline.  Rows that can't be mapped/parsed get
``gs_enrich_st='unmapped'|'nodata'`` and grade A2 markets as null => manual.
"""

from __future__ import annotations

import json
import logging
import re
import time
import xml.etree.ElementTree as ET

from . import goalserve_dbwriter as _gw

log = logging.getLogger("goalserve_a2_enrich")

# How far back (kickoff) to consider rows for enrichment.
A2_ENRICH_LOOKBACK_SEC = 3 * 86400
# Retry an un-enriched / unmapped row no more often than this.
A2_ENRICH_RETRY_SEC = 1800
# Stop retrying a row once it is older than this (data will never arrive).
A2_ENRICH_GIVEUP_SEC = 2 * 86400
# Max rows processed per sweep (bounds the upstream fetch count).
A2_ENRICH_BATCH = 30

# Columns the migration adds.  ensure_columns() adds any that are missing
# (idempotent, mirrors how the apisports_* columns were rolled out live).
_A2_COLUMNS = (
    ("gs_timeline",  "MEDIUMTEXT DEFAULT NULL"),
    ("gs_ft_h",      "INT(11) DEFAULT NULL"),
    ("gs_ft_c",      "INT(11) DEFAULT NULL"),
    ("gs_et_h",      "INT(11) DEFAULT NULL"),
    ("gs_et_c",      "INT(11) DEFAULT NULL"),
    ("gs_pen_h",     "INT(11) DEFAULT NULL"),
    ("gs_pen_c",     "INT(11) DEFAULT NULL"),
    ("gs_decider",   "VARCHAR(10) DEFAULT NULL"),
    ("gs_enrich_at", "BIGINT(20) DEFAULT NULL"),
    ("gs_enrich_st", "VARCHAR(10) DEFAULT NULL"),
)

_columns_ready = False


def ensure_columns() -> None:
    """Add any missing gs_* columns to foot_match (idempotent, cached)."""
    global _columns_ready
    if _columns_ready:
        return
    from . import mysqldb
    try:
        rows = mysqldb.fetch_all(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'foot_match'"
        )
        have = {str(r.get("COLUMN_NAME") or "").lower() for r in rows}
        for name, ddl in _A2_COLUMNS:
            if name.lower() not in have:
                mysqldb.execute(f"ALTER TABLE foot_match ADD COLUMN `{name}` {ddl}")
                log.info("a2 enrich: added foot_match.%s", name)
        _columns_ready = True
    except Exception as e:  # noqa: BLE001 — never break the caller
        log.warning("a2 enrich ensure_columns failed: %s", e)


# --------------------------------------------------------------------------
# soccerfixtures <match> parsing
# --------------------------------------------------------------------------
_MIN_RE = re.compile(r"(\d+)(?:\s*\+\s*(\d+))?")
# Penalty / own-goal markers Goalserve appends to the player string or sets
# as a goal `type` attribute.  Checked case-insensitively.
_PEN_RE = re.compile(r"\b(pen|penalty|p)\b|\(\s*pen", re.IGNORECASE)
_OG_RE = re.compile(r"\b(o\.?g\.?|own[\s-]*goal)\b|\(\s*o\.?g", re.IGNORECASE)


def _to_int(v):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def _parse_minute(raw: str):
    """'67' -> (67,0); '90+3' -> (90,3); '' -> (None,None)."""
    if not raw:
        return None, None
    m = _MIN_RE.search(str(raw))
    if not m:
        return None, None
    base = int(m.group(1))
    extra = int(m.group(2)) if m.group(2) else 0
    return base, extra


def _goal_type(goal_el, player: str) -> str:
    """Classify a goal: 'P' penalty, 'O' own goal, 'N' normal.

    Goalserve encodes pen/OG either via a goal `type`/`comment`/`detail`
    attribute OR appended to the player string.  We check both defensively;
    when nothing marks it we return 'N' (normal)."""
    blobs = [
        str(goal_el.get("type") or ""),
        str(goal_el.get("comment") or ""),
        str(goal_el.get("detail") or ""),
        str(goal_el.get("kind") or ""),
        str(player or ""),
    ]
    blob = " ".join(b for b in blobs if b)
    if _OG_RE.search(blob):
        return "O"
    if _PEN_RE.search(blob) and ("pen" in blob.lower() or "(p" in blob.lower()):
        return "P"
    return "N"


def _side_mapper(flipped: bool):
    """Return f(team_attr)->'H'|'C'.  Goalserve localteam is our home unless
    the fixture was matched flipped (feed local == our away side)."""
    def _f(team_attr: str) -> str:
        is_local = (str(team_attr or "").strip().lower() == "localteam")
        if flipped:
            is_local = not is_local
        return "H" if is_local else "C"
    return _f


def parse_match_a2(mt, flipped: bool) -> dict:
    """Project a soccerfixtures <match> element into the A2 timeline dict.

    Shape (compact; consumed by settle_graders.php json_decode):
      g:  goals  [{m,x,s,p,pid,a,t}]   m=minute x=extra(stoppage) s=H/C
                                       p=player pid=playerid a=assist
                                       t=N|P|O (normal/penalty/own-goal)
      c:  cards  [{m,s,p,k}]           k=Y|R
      sub:subs   [{m,s,p}]
      ft/et/pen: [h,c] or None         dec: REG|ET|PEN   st: status text
    """
    side = _side_mapper(flipped)

    goals = []
    g_root = mt.find("goals")
    if g_root is not None:
        for g in g_root.findall("goal"):
            mnt, extra = _parse_minute(g.get("minute"))
            player = (g.get("player") or "").strip()
            goals.append({
                "m": mnt, "x": extra,
                "s": side(g.get("team") or ""),
                "p": player,
                "pid": _to_int(g.get("playerid")),
                "a": (g.get("assist") or "").strip() or None,
                "t": _goal_type(g, player),
            })

    cards = []
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
                mm = re.match(r"(YC|RC|YR)\s*(\d+)?", bk, re.I)
                if not mm:
                    continue
                kind = mm.group(1).upper()
                cards.append({
                    "m": _to_int(mm.group(2)),
                    "s": side(tag),
                    "p": (p.get("name") or "").strip(),
                    "k": "R" if kind in ("RC", "YR") else "Y",
                })

    subs = []
    sub_root = mt.find("substitutions")
    if sub_root is not None:
        for tag in ("localteam", "visitorteam"):
            side_el = sub_root.find(tag)
            if side_el is None:
                continue
            for s in side_el.findall("substitution"):
                nm = (s.get("player_in_name") or "").strip()
                if not nm:
                    continue
                subs.append({"m": _to_int(s.get("minute")), "s": side(tag), "p": nm})

    # Scores: localteam/visitorteam carry score / ft_score / et_score /
    # pen_score.  Map local/visitor to our home/away via `flipped`.
    lt = mt.find("localteam")
    vt = mt.find("visitorteam")
    home_el, away_el = (vt, lt) if flipped else (lt, vt)

    def _score(el, attr):
        if el is None:
            return None
        return _to_int(el.get(attr))

    ft_h = _score(home_el, "ft_score")
    ft_c = _score(away_el, "ft_score")
    # Plain FT with no <ft_score> attr → use the running score.
    if ft_h is None and ft_c is None:
        ft_h, ft_c = _score(home_el, "score"), _score(away_el, "score")
    et_h, et_c = _score(home_el, "et_score"), _score(away_el, "et_score")
    pen_h, pen_c = _score(home_el, "pen_score"), _score(away_el, "pen_score")

    status = (mt.get("status") or "").strip()
    st_low = status.lower()
    if pen_h is not None and pen_c is not None:
        dec = "PEN"
    elif et_h is not None and et_c is not None:
        dec = "ET"
    elif "penalt" in st_low or st_low in ("ap", "pen", "pen."):
        dec = "PEN"
    elif "extra" in st_low or st_low in ("aet", "a.e.t.", "after et"):
        dec = "ET"
    else:
        dec = "REG"

    goals.sort(key=lambda r: (r["m"] if r["m"] is not None else 999, r["x"] or 0))
    cards.sort(key=lambda r: (r["m"] if r["m"] is not None else 999))

    return {
        "g": goals, "c": cards, "sub": subs,
        "ft": [ft_h, ft_c] if (ft_h is not None and ft_c is not None) else None,
        "et": [et_h, et_c] if (et_h is not None and et_c is not None) else None,
        "pen": [pen_h, pen_c] if (pen_h is not None and pen_c is not None) else None,
        "dec": dec, "st": status, "src": "sf", "ts": int(time.time()),
    }


# --------------------------------------------------------------------------
# Sweep: enrich finalised rows that still lack A2 data
# --------------------------------------------------------------------------
def _candidate_rows(mysqldb, limit: int) -> list:
    now = int(time.time())
    sql = (
        "SELECT gid, team_h, team_c, `datetime`, lid "
        "FROM foot_match "
        "WHERE lid >= %s AND is_inball = 1 "
        "  AND `datetime` > %s AND `datetime` <= %s "
        "  AND ( gs_enrich_at IS NULL "
        "        OR ( gs_enrich_st <> 'ok' AND gs_enrich_at < %s "
        "             AND `datetime` > %s ) ) "
        "ORDER BY `datetime` DESC LIMIT %s"
    )
    return mysqldb.fetch_all(sql, (
        _gw.GS_LID_BASE,
        now - A2_ENRICH_LOOKBACK_SEC,
        now,
        now - A2_ENRICH_RETRY_SEC,
        now - A2_ENRICH_GIVEUP_SEC,
        int(limit),
    ))


def _write_enrich(mysqldb, gid: int, data: "dict | None", status: str) -> None:
    now = int(time.time())
    if data is None:
        mysqldb.execute(
            "UPDATE foot_match SET gs_enrich_at=%s, gs_enrich_st=%s "
            "WHERE gid=%s AND lid>=%s",
            (now, status[:10], int(gid), _gw.GS_LID_BASE),
        )
        return
    tl = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    ft = data.get("ft") or [None, None]
    et = data.get("et") or [None, None]
    pen = data.get("pen") or [None, None]
    mysqldb.execute(
        "UPDATE foot_match SET gs_timeline=%s, gs_ft_h=%s, gs_ft_c=%s, "
        "  gs_et_h=%s, gs_et_c=%s, gs_pen_h=%s, gs_pen_c=%s, gs_decider=%s, "
        "  gs_enrich_at=%s, gs_enrich_st=%s "
        "WHERE gid=%s AND lid>=%s",
        (tl, ft[0], ft[1], et[0], et[1], pen[0], pen[1],
         (data.get("dec") or "REG")[:10], now, status[:10],
         int(gid), _gw.GS_LID_BASE),
    )


def enrich_finished_a2(limit: int = A2_ENRICH_BATCH) -> dict:
    """Enrich up to ``limit`` finalised foot_match rows from soccerfixtures.

    Returns ``{scanned, ok, unmapped, nodata, errors, wrote}``.  No-op when
    GS_DB_WRITE is off.  Never raises."""
    out = {"scanned": 0, "ok": 0, "unmapped": 0, "nodata": 0, "errors": 0, "wrote": _gw.GS_DB_WRITE}
    if not _gw.GS_DB_WRITE:
        return out
    ensure_columns()
    # Lazy import: external is already loaded (goalserve_inplay imports it).
    try:
        from .routers.external import _gs_feed_get, _gs_find_match, _gs_fixture_dates
    except Exception as e:  # noqa: BLE001
        log.warning("a2 enrich: cannot import external helpers: %s", e)
        out["errors"] += 1
        return out
    from . import mysqldb

    try:
        rows = _candidate_rows(mysqldb, limit)
    except Exception as e:  # noqa: BLE001
        log.warning("a2 enrich: candidate query failed: %s", e)
        out["errors"] += 1
        return out

    for r in rows:
        out["scanned"] += 1
        gid = int(r.get("gid") or 0)
        try:
            lid = int(r.get("lid") or 0)
            gsl = lid - _gw.GS_LID_BASE
            if not (0 < gsl < 500000):
                _write_enrich(mysqldb, gid, None, "unmapped")
                out["unmapped"] += 1
                continue
            q = _gs_fixture_dates(int(r.get("datetime") or 0), span=1)
            raw = _gs_feed_get(f"soccerfixtures/league/{gsl}?{q}", ttl=300)
            if not raw:
                _write_enrich(mysqldb, gid, None, "nodata")
                out["nodata"] += 1
                continue
            try:
                root = ET.fromstring(raw)
            except ET.ParseError:
                _write_enrich(mysqldb, gid, None, "nodata")
                out["nodata"] += 1
                continue
            mt, flipped = _gs_find_match(root, r.get("team_h"), r.get("team_c"))
            if mt is None:
                _write_enrich(mysqldb, gid, None, "unmapped")
                out["unmapped"] += 1
                continue
            data = parse_match_a2(mt, flipped)
            # Require at least a regulation score; otherwise treat as nodata
            # (an empty fixture skeleton) so we retry until the feed fills in.
            if not data.get("ft") and not data.get("g"):
                _write_enrich(mysqldb, gid, None, "nodata")
                out["nodata"] += 1
                continue
            _write_enrich(mysqldb, gid, data, "ok")
            out["ok"] += 1
        except Exception as e:  # noqa: BLE001 — isolate per-row failures
            log.warning("a2 enrich gid=%s failed: %s", gid, e)
            out["errors"] += 1
    if out["ok"] or out["errors"]:
        log.info("a2 enrich sweep: %s", out)
    return out
