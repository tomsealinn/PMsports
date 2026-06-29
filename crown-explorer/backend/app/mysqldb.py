"""Thin MySQL access layer for reading Crown's ``db_sports`` schema.

Replaces ``oddsdb`` (sqlite) as the source-of-truth for /api/external/*
events, leagues, and markets after the 2026-05-24 "PHP cron 主、Python cron 退阶"
migration (see ``.notes/design_phase_closed_betting.md`` § 7 option C).

Connection params come from the environment so we don't ship the DB
password in source:

    CROWN_MYSQL_HOST  default 127.0.0.1
    CROWN_MYSQL_USER  default root
    CROWN_MYSQL_PASS  required
    CROWN_MYSQL_DB    default db_sports

Reads run through a per-process connection pool (one ``pymysql`` socket
per thread).  FastAPI handlers call us via ``asyncio.to_thread`` so the
event loop never blocks on the wire.
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Any, Sequence

import pymysql
from pymysql.cursors import DictCursor

log = logging.getLogger("mysqldb")

_LOCAL = threading.local()


def _config() -> dict[str, Any]:
    return {
        "host":     os.environ.get("CROWN_MYSQL_HOST", "127.0.0.1"),
        "user":     os.environ.get("CROWN_MYSQL_USER", "root"),
        "password": os.environ.get("CROWN_MYSQL_PASS", ""),
        "database": os.environ.get("CROWN_MYSQL_DB",   "db_sports"),
        "charset":  "utf8mb4",
        "autocommit": True,
        "cursorclass": DictCursor,
    }


def _conn() -> pymysql.connections.Connection:
    """Return the per-thread connection, reconnecting if dropped.

    pymysql's ``ping(reconnect=True)`` cheaply checks liveness; we call
    it on every request so a long-idle worker thread doesn't surface a
    stale-socket error to the caller.
    """
    c = getattr(_LOCAL, "conn", None)
    if c is None:
        c = pymysql.connect(**_config())
        _LOCAL.conn = c
    else:
        try:
            c.ping(reconnect=True)
        except pymysql.MySQLError:
            with c:
                pass
            c = pymysql.connect(**_config())
            _LOCAL.conn = c
    return c


def fetch_all(sql: str, params: Sequence[Any] = ()) -> list[dict]:
    """Run a SELECT and return every row as a dict."""
    with _conn().cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def fetch_one(sql: str, params: Sequence[Any] = ()) -> dict | None:
    """Run a SELECT and return the first row as a dict (or None)."""
    with _conn().cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone()
        return dict(row) if row else None


def execute(sql: str, params: Sequence[Any] = ()) -> int:
    """Run an INSERT/UPDATE/DELETE and return affected row count.

    Used by the Goalserve DB writer (``goalserve_dbwriter``) to upsert
    events into foot_match / foot_match_xml / foot_league.  The connection
    is autocommit, so each call commits on its own.
    """
    with _conn().cursor() as cur:
        n = cur.execute(sql, params)
        return int(n)


def name_cn_map(names: Sequence[str]) -> dict[str, str]:
    """Batch lookup of English→Chinese display names from
    ``db_sports.name_cn_cache`` (filled by the translate_names.php cron).

    Returns ``{name_en: name_cn}`` only for names that have a cached
    translation; missing names are simply absent so callers fall back to
    the frontend's curated dictionary / English.  Never raises — a missing
    table or DB hiccup just yields an empty map (graceful degradation).
    """
    clean = sorted({(n or "").strip() for n in names if (n or "").strip()})
    if not clean:
        return {}
    out: dict[str, str] = {}
    try:
        for i in range(0, len(clean), 200):
            chunk = clean[i:i + 200]
            ph = ",".join(["%s"] * len(chunk))
            rows = fetch_all(
                f"SELECT name_en, name_cn FROM name_cn_cache WHERE name_en IN ({ph})",
                tuple(chunk),
            )
            for r in rows:
                cn = (r.get("name_cn") or "").strip()
                if cn:
                    out[str(r.get("name_en"))] = cn
    except Exception:                                                # noqa: BLE001
        return out
    return out


# ---------------------------------------------------------------------------
# League slug ↔ lid mapping — registry-driven (db_sports.foot_league).
#
# Up to 2026-05-28 the slug↔lid map was a 9-entry dict mirrored in
# multiple files (this module + ``api_v2.php`` + the ingest cron).  We
# now read the mapping from the ``foot_league`` registry on first
# access and cache for ``REGISTRY_TTL_SEC`` so adding a new league only
# requires an INSERT instead of edits across five files.
#
# Backward-compatible API:
#   LID_TO_SLUG / SLUG_TO_LID — read-only views (registry snapshot)
#   LID_MIN / LID_MAX         — bounds (kept for legacy ``BETWEEN``)
#   slug_to_lid / lid_to_slug — same signatures, now go through cache

REGISTRY_TTL_SEC = 60

_REG_CACHE: dict[str, Any] = {
    "ts":          0.0,
    "lid_to_slug": {},
    "slug_to_lid": {},
    "enabled_lids": [],
    "rows":        [],
}
_REG_LOCK = threading.Lock()

# Bare-minimum fallback so the API doesn't 500 when the registry table
# is empty / unreachable.  Mirrors the original 9-entry hard-coded map
# every part of the codebase used to embed.
_FALLBACK_LID_TO_SLUG = {
    101: "england-premier-league",
    102: "italy-serie-a",
    103: "spain-laliga",
    104: "france-ligue-1",
    105: "germany-bundesliga",
    106: "international-clubs-uefa-champions-league",
    107: "international-clubs-uefa-europa-league",
    108: "international-world-cup",
    109: "china-chinese-super-league",
}


def _reload_registry() -> None:
    """Re-fetch enabled rows from foot_league.  Holds _REG_LOCK so
    parallel reloads don't slam the DB."""
    try:
        rows = fetch_all(
            "SELECT lid, slug, name_en, name_cn, region, country, flag, "
            "       apisports_id, events_count, priority "
            "FROM foot_league WHERE enabled = 1"
        )
    except Exception as e:                                          # noqa: BLE001
        log.warning("foot_league reload failed (using fallback): %s", e)
        rows = []
    with _REG_LOCK:
        if rows:
            _REG_CACHE["lid_to_slug"]  = {int(r["lid"]): r["slug"] for r in rows}
            _REG_CACHE["slug_to_lid"]  = {r["slug"]: int(r["lid"]) for r in rows}
            _REG_CACHE["enabled_lids"] = [int(r["lid"]) for r in rows]
            _REG_CACHE["rows"]         = rows
        else:
            _REG_CACHE["lid_to_slug"]  = dict(_FALLBACK_LID_TO_SLUG)
            _REG_CACHE["slug_to_lid"]  = {v: k for k, v in _FALLBACK_LID_TO_SLUG.items()}
            _REG_CACHE["enabled_lids"] = list(_FALLBACK_LID_TO_SLUG)
            _REG_CACHE["rows"]         = []
        _REG_CACHE["ts"] = __import__("time").time()


def _ensure_registry_loaded() -> None:
    now = __import__("time").time()
    if now - _REG_CACHE["ts"] < REGISTRY_TTL_SEC and _REG_CACHE["rows"]:
        return
    _reload_registry()


def _registry_view() -> dict:
    _ensure_registry_loaded()
    return _REG_CACHE


def slug_to_lid(slug: str | None) -> int | None:
    if not slug:
        return None
    return _registry_view()["slug_to_lid"].get(slug)


def lid_to_slug(lid: int | None) -> str:
    if lid is None:
        return ""
    return _registry_view()["lid_to_slug"].get(int(lid), f"league-{lid}")


def enabled_lids() -> list[int]:
    """Cached list of every enabled league's lid."""
    return list(_registry_view()["enabled_lids"])


def enabled_lids_sql(alias: str = "") -> str:
    """SQL fragment ``"<alias>lid IN (101,102,...)"`` for inline use in
    f-strings.  Replaces every ``lid BETWEEN {LID_MIN} AND {LID_MAX}``
    occurrence — see routers/external.py.  Falls back to a wide
    ``BETWEEN`` so query syntax stays valid when the cache is briefly
    empty.
    """
    lids = enabled_lids()
    col = f"{alias}lid"
    if not lids:
        return f"{col} BETWEEN {LID_MIN} AND {LID_MAX}"
    return f"{col} IN ({','.join(str(int(x)) for x in lids)})"


def registry_rows() -> list[dict]:
    """Full enabled-row dump for catalog endpoints.  Read-only — do not
    mutate the returned list; callers typically iterate to build the
    region/country tree (see routers/external.py:list_leagues_catalog).
    """
    return list(_registry_view()["rows"])


# ---------------------------------------------------------------------------
# Catalog tree builder — equivalent of LeagueRegistry::getCatalog() in PHP.
# Used by FastAPI /api/external/leagues/catalog so the standalone
# pmppm.com/sports flow has parity with the H5 (Apache PHP) flow.
#
# REGION_META / COUNTRY_META mirror the PHP class constants.  Keep both
# sides in lockstep when adding a new country.

REGION_META = {
    "europe":        {"name_cn": "欧洲",   "name_en": "Europe",        "flag": "🇪🇺"},
    "asia":          {"name_cn": "亚洲",   "name_en": "Asia",          "flag": "🌏"},
    "americas":      {"name_cn": "美洲",   "name_en": "Americas",      "flag": "🌎"},
    "africa":        {"name_cn": "非洲",   "name_en": "Africa",        "flag": "🌍"},
    "oceania":       {"name_cn": "大洋洲", "name_en": "Oceania",       "flag": "🌏"},
    "international": {"name_cn": "国际",   "name_en": "International", "flag": "🌐"},
    "other":         {"name_cn": "其他",   "name_en": "Other",         "flag": "🏳️"},
}

# Country lookup is intentionally a tiny subset; the registry row's
# ``flag`` and ``country`` columns carry the authoritative values
# written by the PHP LeagueRegistry on first ingest.  This dict only
# fills in display-only fields that the registry doesn't store
# (name_cn / name_en) for any country FastAPI sees before the PHP
# ingest seeds it.
_COUNTRY_NAME_FALLBACKS = {
    "other": ("其他", "Other"),
    "england": ("英格兰", "England"),
    "scotland": ("苏格兰", "Scotland"),
    "wales": ("威尔士", "Wales"),
    "northern": ("北爱尔兰", "Northern Irl."),
    "ireland": ("爱尔兰", "Ireland"),
    "italy": ("意大利", "Italy"),
    "spain": ("西班牙", "Spain"),
    "germany": ("德国", "Germany"),
    "france": ("法国", "France"),
    "portugal": ("葡萄牙", "Portugal"),
    "netherlands": ("荷兰", "Netherlands"),
    "belgium": ("比利时", "Belgium"),
    "austria": ("奥地利", "Austria"),
    "switzerland": ("瑞士", "Switzerland"),
    "denmark": ("丹麦", "Denmark"),
    "sweden": ("瑞典", "Sweden"),
    "norway": ("挪威", "Norway"),
    "finland": ("芬兰", "Finland"),
    "iceland": ("冰岛", "Iceland"),
    "poland": ("波兰", "Poland"),
    "czechia": ("捷克", "Czech Republic"),
    "slovakia": ("斯洛伐克", "Slovakia"),
    "hungary": ("匈牙利", "Hungary"),
    "romania": ("罗马尼亚", "Romania"),
    "bulgaria": ("保加利亚", "Bulgaria"),
    "greece": ("希腊", "Greece"),
    "turkey": ("土耳其", "Turkey"),
    "russia": ("俄罗斯", "Russia"),
    "ukraine": ("乌克兰", "Ukraine"),
    "belarus": ("白俄罗斯", "Belarus"),
    "serbia": ("塞尔维亚", "Serbia"),
    "croatia": ("克罗地亚", "Croatia"),
    "slovenia": ("斯洛文尼亚", "Slovenia"),
    "bosnia": ("波黑", "Bosnia"),
    "montenegro": ("黑山", "Montenegro"),
    "albania": ("阿尔巴尼亚", "Albania"),
    "macedonia": ("北马其顿", "North Macedonia"),
    "kosovo": ("科索沃", "Kosovo"),
    "estonia": ("爱沙尼亚", "Estonia"),
    "latvia": ("拉脱维亚", "Latvia"),
    "lithuania": ("立陶宛", "Lithuania"),
    "cyprus": ("塞浦路斯", "Cyprus"),
    "malta": ("马耳他", "Malta"),
    "luxembourg": ("卢森堡", "Luxembourg"),
    "andorra": ("安道尔", "Andorra"),
    "gibraltar": ("直布罗陀", "Gibraltar"),
    "faroe": ("法罗群岛", "Faroe Islands"),
    "moldova": ("摩尔多瓦", "Moldova"),
    "georgia": ("格鲁吉亚", "Georgia"),
    "armenia": ("亚美尼亚", "Armenia"),
    "azerbaijan": ("阿塞拜疆", "Azerbaijan"),
    "kazakhstan": ("哈萨克斯坦", "Kazakhstan"),
    "china": ("中国", "China"),
    "japan": ("日本", "Japan"),
    "korea": ("韩国", "Korea"),
    "south": ("韩国", "South Korea"),
    "australia": ("澳大利亚", "Australia"),
    "india": ("印度", "India"),
    "thailand": ("泰国", "Thailand"),
    "vietnam": ("越南", "Vietnam"),
    "malaysia": ("马来西亚", "Malaysia"),
    "singapore": ("新加坡", "Singapore"),
    "indonesia": ("印尼", "Indonesia"),
    "philippines": ("菲律宾", "Philippines"),
    "hong": ("香港", "Hong Kong"),
    "taiwan": ("台湾", "Taiwan"),
    "iran": ("伊朗", "Iran"),
    "iraq": ("伊拉克", "Iraq"),
    "saudi": ("沙特阿拉伯", "Saudi Arabia"),
    "qatar": ("卡塔尔", "Qatar"),
    "uae": ("阿联酋", "UAE"),
    "jordan": ("约旦", "Jordan"),
    "lebanon": ("黎巴嫩", "Lebanon"),
    "israel": ("以色列", "Israel"),
    "uzbekistan": ("乌兹别克斯坦", "Uzbekistan"),
    "usa": ("美国", "United States"),
    "canada": ("加拿大", "Canada"),
    "mexico": ("墨西哥", "Mexico"),
    "brazil": ("巴西", "Brazil"),
    "argentina": ("阿根廷", "Argentina"),
    "chile": ("智利", "Chile"),
    "colombia": ("哥伦比亚", "Colombia"),
    "peru": ("秘鲁", "Peru"),
    "uruguay": ("乌拉圭", "Uruguay"),
    "paraguay": ("巴拉圭", "Paraguay"),
    "ecuador": ("厄瓜多尔", "Ecuador"),
    "bolivia": ("玻利维亚", "Bolivia"),
    "venezuela": ("委内瑞拉", "Venezuela"),
    "costa": ("哥斯达黎加", "Costa Rica"),
    "panama": ("巴拿马", "Panama"),
    "honduras": ("洪都拉斯", "Honduras"),
    "guatemala": ("危地马拉", "Guatemala"),
    "jamaica": ("牙买加", "Jamaica"),
    "aruba": ("阿鲁巴", "Aruba"),
    "egypt": ("埃及", "Egypt"),
    "morocco": ("摩洛哥", "Morocco"),
    "algeria": ("阿尔及利亚", "Algeria"),
    "tunisia": ("突尼斯", "Tunisia"),
    "nigeria": ("尼日利亚", "Nigeria"),
    "ghana": ("加纳", "Ghana"),
    "cameroon": ("喀麦隆", "Cameroon"),
    "kenya": ("肯尼亚", "Kenya"),
    "ethiopia": ("埃塞俄比亚", "Ethiopia"),
    "tanzania": ("坦桑尼亚", "Tanzania"),
    "uganda": ("乌干达", "Uganda"),
    "zambia": ("赞比亚", "Zambia"),
    "zimbabwe": ("津巴布韦", "Zimbabwe"),
    "south-africa": ("南非", "South Africa"),
    "angola": ("安哥拉", "Angola"),
    "senegal": ("塞内加尔", "Senegal"),
    "ivory": ("科特迪瓦", "Côte d'Ivoire"),
    "new": ("新西兰", "New Zealand"),
    "fiji": ("斐济", "Fiji"),
    "vanuatu": ("瓦努阿图", "Vanuatu"),
    "world": ("国际", "World"),
    "clubs": ("俱乐部赛", "Clubs"),
}


def build_catalog(max_priority: int | None = None) -> dict:
    """Equivalent of PHP `LeagueRegistry::getCatalog()`.  Returns the
    region → country → leagues tree consumed by the H5 DiscoverScreen
    when the request lands on the FastAPI process directly (the
    pmppm.com/sports route).
    """
    rows = registry_rows()
    regions: dict[str, dict] = {}
    for r in rows:
        if max_priority is not None and int(r.get("priority") or 100) > max_priority:
            continue
        rid = (r.get("region") or "other").lower()
        cid = (r.get("country") or "unknown").lower()
        if rid not in regions:
            rmeta = REGION_META.get(rid, REGION_META["other"])
            regions[rid] = {
                "id":        rid,
                "name_cn":   rmeta["name_cn"],
                "name_en":   rmeta["name_en"],
                "flag":      rmeta["flag"],
                "countries": {},
            }
        if cid not in regions[rid]["countries"]:
            cn, en = _COUNTRY_NAME_FALLBACKS.get(cid, (cid, cid))
            regions[rid]["countries"][cid] = {
                "id":      cid,
                "name_cn": cn,
                "name_en": en,
                "flag":    r.get("flag") or "",
                "leagues": [],
            }
        regions[rid]["countries"][cid]["leagues"].append({
            "lid":          int(r["lid"]),
            "slug":         r["slug"],
            "name_en":      r.get("name_en"),
            "name_cn":      r.get("name_cn") or "",
            "priority":     int(r.get("priority") or 100),
            "events_count": int(r.get("events_count") or 0),
            "apisports_id": int(r["apisports_id"]) if r.get("apisports_id") is not None else None,
        })
    out = []
    for rid, region in regions.items():
        region["countries"] = list(region["countries"].values())
        out.append(region)
    out.sort(key=lambda x: x["id"])
    return {
        "regions":       out,
        "total_leagues": sum(len(c["leagues"]) for r in out for c in r["countries"]),
        "fetched_at":    int(__import__("time").time()),
    }


def search_registry(q: str, limit: int = 30) -> list[dict]:
    """Mirror of PHP `LeagueRegistry::search()`.  Linear scan over the
    cached registry rows; fast at our scale (~few hundred rows)."""
    q = (q or "").strip().lower()
    if not q:
        return []
    out: list[dict] = []
    for r in registry_rows():
        if (q in (r.get("slug") or "").lower()
                or q in (r.get("name_en") or "").lower()
                or q in (r.get("name_cn") or "").lower()
                or q in (r.get("country") or "").lower()):
            out.append(r)
        if len(out) >= limit:
            break
    out.sort(key=lambda r: (int(r.get("priority") or 100),
                             -int(r.get("events_count") or 0),
                             r.get("name_en") or ""))
    return out[:limit]


# Backwards-compat constants used by code paths that still reference the
# old hard-coded map directly.  Refreshed lazily by callers via
# ``slug_to_lid`` / ``lid_to_slug``.
LID_TO_SLUG: dict[int, str] = dict(_FALLBACK_LID_TO_SLUG)
SLUG_TO_LID: dict[str, int] = {v: k for k, v in _FALLBACK_LID_TO_SLUG.items()}
LID_MIN = 100
LID_MAX = 999_999


# ---------------------------------------------------------------------------
# Status derivation.  Crown stores `status` (started flag) and `is_inball`
# (finished flag) separately; the API speaks a single ``status`` string
# matching what the sqlite ingest used to emit, so downstream code (and
# the H5 frontend) doesn't need to know how to combine them.
#
# Single source of truth for the LIVE_WINDOW heuristic — both
# ``derive_status`` (operating on raw MySQL rows) and
# ``is_inplay_event`` (operating on already-normalized API dicts) share
# this constant.  Mirrors the H5 frontend's eventStatus() 2h budget
# (90' + 15' halftime + ~15' injury time).

LIVE_WINDOW_SEC = 120 * 60


# api-sports broadcast statuses that mean "match has NOT physically
# started yet" — even if our scheduled kickoff is in the past.  These
# override the LIVE_WINDOW heuristic so a delayed friendly doesn't get
# mis-labelled as inplay (which would render the `滚球` chip with no
# minute since there is no real live clock).   See api-sports docs for
# the full status code matrix.
_APISPORTS_NOT_STARTED = frozenset({
    "NS",     # Not Started
    "TBD",    # To Be Defined
    "PST",    # Postponed
    "CANC",   # Cancelled
    "SUSP",   # Match Suspended
    "ABD",    # Match Abandoned
    "AWD",    # Technical Loss
    "WO",     # Walkover
    "INT",    # Interrupted (very brief stops also surface as INT;
              #              treat as pending so the badge doesn't show
              #              a frozen minute)
})


def derive_status(row: dict, snap: "dict | None" = None) -> str:
    """Project a Crown ``foot_match`` row into the API status vocabulary.

    Mirror of api_v2.php ``matchStatus()`` plus the LIVE_WINDOW heuristic
    from the legacy sqlite ingest.  The LIVE_WINDOW constraint is
    critical — Crown's cron occasionally fails to flip ``is_inball=1``
    after a match ends, leaving "zombie" rows that look pre-match
    (status=0) but have a kickoff hours in the past.  Without the window
    those zombies would surface as inplay forever and (worse) lock the
    H5 frontend's selectedMatch.

    apisports_status override:
      The broadcast feed (api-sports) is authoritative for the actual
      playing-vs-not-playing state.   When it reports NS/TBD/PST/...
      we keep the row as 'pending' regardless of how long ago kickoff
      was — Crown will eventually catch up when the match actually
      starts (or the cron flags it settled).
    """
    is_inball = int(row.get("is_inball") or 0) == 1
    if is_inball:
        return "settled"
    ts = int(row.get("datetime") or 0)
    now = int(__import__("time").time())
    age = (now - ts) if ts > 0 else None
    started = int(row.get("status") or 0) == 1
    score_h = row.get("score_h")
    score_c = row.get("score_c")
    has_live_score = score_h is not None and score_c is not None
    # Goalserve snap is authoritative for live-vs-not-live: when an
    # inplay snap exists AND its own status is `inplay`, the match
    # really is on the pitch (Goalserve's feed is the broadcast feed).
    # Conversely, if the snap exists but says `finished`, Crown's
    # is_inball=0 is just lagging — surface as settled.
    if snap is not None:
        snap_status = str(snap.get("status") or "").lower()
        if snap_status == "inplay":
            return "inplay"
        if snap_status == "finished" or snap.get("is_finished"):
            return "settled"

    # Unknown / zero kickoff (Crown never populated foot_match.datetime) with
    # no live snap to prove the match is on the pitch: status=1 alone is a
    # stale Crown flag, and the LIVE_WINDOW sweeper below can't catch it
    # because `age` is undefined when ts<=0.  Without this guard such rows
    # masquerade as inplay forever (e.g. a match that finished yesterday but
    # was never settled, datetime never written) — they surface on 滚球 with
    # no kickoff/clock/phase.  Treat as settled so they leave the live list.
    if ts <= 0 and snap is None:
        return "settled"

    # Zombie sweeper: Crown says still-active but kickoff > LIVE_WINDOW
    # ago and no settlement landed.  Treat as settled so /events?only_active=true
    # excludes them and the frontend doesn't pick one as selectedMatch.
    if age is not None and age > LIVE_WINDOW_SEC and not is_inball:
        return "settled"

    # Goalserve-only inplay gate.   Two signals can promote to inplay:
    #   (a) Crown explicitly says started (status=1, set by Crown's
    #       own kickoff cron — not the api-sports cron we just retired),
    #   (b) Goalserve snap already said inplay (handled earlier).
    # The previous score/age-based heuristics are dropped because:
    #   - has_live_score: foot_match.score_h was being populated by the
    #     retired api-sports `--live-only` cron with phantom 0-0s for
    #     not-yet-kicked friendlies; trusting it labelled delayed matches
    #     as live.   Goalserve is the new source for live scores.
    #   - age-only: with no real broadcast feed proving the match is
    #     on the pitch, "kickoff was X minutes ago" is too noisy.   A
    #     friendly delayed 30 min would render as live for 30 min with
    #     no minute clock.    Better to stay pending until Crown or
    #     Goalserve confirms.
    if started:
        return "inplay"
    return "pending"


def is_inplay_event(event: dict) -> bool:
    """Decide whether an already-normalized API event dict represents an
    in-play (live) match — i.e. should be served from the /dev/shm WS
    snapshot rather than from MySQL r_cn.

    ``event`` here is the API-shaped dict produced by
    ``external._mysql_row_to_event`` (status: pending/inplay/settled
    text + commence_ts epoch seconds), NOT a raw MySQL row — that's
    what ``derive_status`` handles.

    Two-line spec:
      * Explicit "inplay" / "live" status   → True
      * "settled" / "cancelled"             → False
      * Anything else with a kickoff in the
        past but within LIVE_WINDOW_SEC      → True (cron-lag)

    Keeping this single function used by every caller (events list,
    markets endpoint, WS bridge) prevents the three independent copies
    of the LIVE_WINDOW arithmetic that used to drift apart.
    """
    raw = (event.get("status") or "").lower()
    if raw in ("settled", "cancelled"):
        return False
    if raw in ("inplay", "live"):
        return True
    ts = int(event.get("commence_ts") or 0)
    if not ts:
        return False
    import time as _time
    now = int(_time.time())
    return 0 <= now - ts <= LIVE_WINDOW_SEC


def in_play_event_ids(*, prekick_lead_sec: int = 600, limit: int = 400) -> list[str]:
    """Return foot_match.gid for matches currently in-play (or about to be).

    Used by ``oddsapi_ws.OddsApiWS`` to pin the upstream WS subscription
    to ``events=<comma-list>``.  Without this pin the firehose default
    only delivers price ticks for matches the upstream chooses to push,
    which in practice is concentrated on major-bookie / Bet365 events
    (≈25 globally at any moment) — leaving lower-tier in-play matches
    showing "滚球盘口暂未推送" forever on the H5 frontend.

    Selection mirrors ``derive_status`` for the in-play branch:
      * is_inball = 0  (not yet settled)
      * status = 1                                       — Crown flipped to live
        OR `datetime` ∈ [now - LIVE_WINDOW_SEC, now]    — past kickoff, live window
        OR `datetime` ∈ [now, now + prekick_lead_sec]   — about to kick off (warmup buffer)

    ``limit`` caps the URL length (events= 400 × 9 chars ≈ 3.6 KB) so
    we stay below upstream and HTTP intermediaries' query-string limits.
    Crown rarely runs >100 simultaneous in-play matches, so 400 is
    headroom rather than a real cap.
    """
    sql = (
        "SELECT gid FROM foot_match "
        "WHERE is_inball = 0 "
        "  AND ( "
        "        status = 1 "
        "        OR `datetime` BETWEEN UNIX_TIMESTAMP() - %s AND UNIX_TIMESTAMP() + %s "
        "      ) "
        "ORDER BY `datetime` DESC "
        "LIMIT %s"
    )
    try:
        rows = fetch_all(sql, (LIVE_WINDOW_SEC, int(prekick_lead_sec), int(limit)))
    except Exception as e:                                          # noqa: BLE001
        log.warning("in_play_event_ids query failed: %s", e)
        return []
    out: list[str] = []
    for r in rows:
        gid = r.get("gid")
        if gid is None:
            continue
        out.append(str(int(gid)))
    return out


# ---------------------------------------------------------------------------
# FIFA World Cup 2026 group derivation.
#
# Crown's `foot_match` doesn't carry a `group`/`stage` column.  Two-stage
# derivation:
#
#   1. Composition (which 4 teams belong together) — union-find on the
#      `foot_match` (lid=108) fixture graph.  Always reliable: 12 groups
#      of 4 fall out cleanly because every team plays every other team in
#      its group during the group stage.
#
#   2. Letter assignment (A..L) — read FIFA's official letters from the
#      legacy Crown `sfs_match` table (lid=104036, "Group A To Qualify"
#      / "Group A Winner" markets).  This is what `/agents/`, `/admin/`,
#      `/d0/` show, so taking the same letter map keeps the new H5
#      consistent with the operator-facing reports.  When a team is
#      missing from sfs_match (Crown lists 3 of 4 contenders for a few
#      groups) we vote within the union-find component: the letter that
#      sfs_match assigns to a majority of the component's members wins.
#
#   3. Fallback — if sfs_match has no WC rows at all, assign letters by
#      earliest-fixture order (the original behaviour).  Letters in this
#      mode won't necessarily match FIFA's, but composition is still
#      correct.
#
# Result is cached 5 min so a busy /outrights or /events call doesn't
# hammer the DB.

_WC_LID = 108
_WC_OUTRIGHT_LID = 104036                   # sfs_match lid for WC 2026
_WC_GROUPS_CACHE: dict[str, Any] = {"ts": 0, "data": None}
_WC_GROUPS_TTL = 300


def _authoritative_letter_map() -> dict[str, str]:
    """Read team→group letter from Crown's `sfs_match` "Group X To Qualify"
    and "Group X Winner" markets.  Returns an empty dict if Crown has no
    WC outright entries (the caller will then fall back to chronological
    ordering of foot_match fixtures).
    """
    try:
        rows = fetch_all(
            "SELECT teamsname_en, team_en FROM sfs_match "
            "WHERE lid = %s AND ("
            "  teamsname_en LIKE 'Group _ To Qualify' OR "
            "  teamsname_en LIKE 'Group _ Winner'"
            ")",
            (_WC_OUTRIGHT_LID,),
        )
    except Exception as e:                                          # noqa: BLE001
        log.warning("sfs_match read failed for WC outrights: %s", e)
        return {}

    out: dict[str, str] = {}
    for r in rows or []:
        market = (r.get("teamsname_en") or "").strip()
        team_raw = (r.get("team_en") or "").strip()
        if not market.startswith("Group ") or len(market) < 8:
            continue
        letter = market[6]
        if not ("A" <= letter <= "L"):
            continue
        # sfs_match uses bookmaker spellings (South Korea / Czech
        # Republic / Iran / DR Congo / Bosnia And Herzegovina /
        # Curacao / Turkey).  Bridge to Crown foot_match canonical via
        # the same alias map the outrights router uses.
        canon = OUTRIGHT_TEAM_ALIASES.get(team_raw, team_raw)
        # sfs_match capitalisation occasionally drifts from foot_match
        # ("Bosnia And Herzegovina" vs "Bosnia and Herzegovina") — the
        # alias map already normalises the well-known offenders.
        out.setdefault(canon, letter)
    return out


def world_cup_groups() -> dict[str, Any]:
    """Return ``{"team_to_group": {...}, "groups": [...]}`` for the WC.

    Letters match Crown's `sfs_match` outright catalog (FIFA's official
    A..L) when available; composition always derives from foot_match
    fixtures.  See the module-level comment for the two-stage rationale.
    """
    import time as _time
    now = _time.time()
    cached = _WC_GROUPS_CACHE.get("data")
    if cached is not None and now - _WC_GROUPS_CACHE["ts"] < _WC_GROUPS_TTL:
        return cached

    rows = fetch_all(
        "SELECT team_h_en, team_c_en, `datetime` "
        "FROM foot_match WHERE lid = %s ORDER BY `datetime`",
        (_WC_LID,),
    )

    parent: dict[str, str] = {}
    earliest: dict[str, int] = {}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        parent.setdefault(a, a)
        parent.setdefault(b, b)
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for r in rows:
        h = (r.get("team_h_en") or "").strip()
        c = (r.get("team_c_en") or "").strip()
        ts = int(r.get("datetime") or 0)
        if not h or not c:
            continue
        union(h, c)
        for t in (h, c):
            if t not in earliest or ts < earliest[t]:
                earliest[t] = ts

    components: dict[str, list[str]] = {}
    for t in parent:
        components.setdefault(find(t), []).append(t)
    component_list = list(components.values())

    # Pull FIFA's official letter map from Crown's sfs_match.  Empty
    # dict means we'll fall back to chronological labels below.
    letter_map = _authoritative_letter_map()

    used_letters: set[str] = set()
    component_label: dict[int, str] = {}

    if letter_map:
        # First pass: assign each component the letter that the majority
        # of its already-known members carry in sfs_match.
        for idx, members in enumerate(component_list):
            votes: dict[str, int] = {}
            for t in members:
                lbl = letter_map.get(t)
                if lbl:
                    votes[lbl] = votes.get(lbl, 0) + 1
            if votes:
                # Highest-vote letter wins; ties broken alphabetically
                # so the result is deterministic across reboots.
                best = max(votes.items(), key=lambda kv: (kv[1], -ord(kv[0])))[0]
                if best not in used_letters:
                    component_label[idx] = best
                    used_letters.add(best)

        # Second pass: any component sfs_match couldn't label gets the
        # alphabetically-first unused letter, ordered by earliest
        # fixture so the chronologically-earliest unlabeled group gets
        # the alphabetically-earliest free slot.
        unlabeled = [
            (idx, min(earliest.get(t, 0) for t in component_list[idx]))
            for idx in range(len(component_list))
            if idx not in component_label
        ]
        unlabeled.sort(key=lambda x: x[1])
        free_letters = [chr(ord("A") + i) for i in range(26) if chr(ord("A") + i) not in used_letters]
        for (idx, _ts), letter in zip(unlabeled, free_letters):
            component_label[idx] = letter
            used_letters.add(letter)
    else:
        # Pure fallback — chronological order (original behaviour).
        ordered = sorted(
            range(len(component_list)),
            key=lambda i: min(earliest.get(t, 0) for t in component_list[i]),
        )
        for slot, idx in enumerate(ordered):
            label = chr(ord("A") + slot) if slot < 26 else f"G{slot+1}"
            component_label[idx] = label

    team_to_group: dict[str, str] = {}
    groups_out: list[dict[str, Any]] = []
    for idx, members in enumerate(component_list):
        label = component_label.get(idx, "?")
        for t in members:
            team_to_group[t] = label
        groups_out.append({
            "label": label,
            "teams": sorted(members),
            "earliest_kickoff": min(earliest.get(t, 0) for t in members),
        })
    groups_out.sort(key=lambda g: g["label"])

    payload = {"team_to_group": team_to_group, "groups": groups_out}
    _WC_GROUPS_CACHE.update(ts=now, data=payload)
    return payload


# ---------------------------------------------------------------------------
# Bookmaker → Crown team-name normalisation for outright outcomes.
#
# the-odds-api.com uses ISO/English country names that occasionally
# diverge from Crown's foot_match team_h_en/team_c_en string.  This map
# bridges the two so we can both filter the bookmaker's 54-team list
# down to the 48 actual qualifiers and attach a `group` label to each
# remaining outcome.  Bookmaker names not found here pass through
# unchanged (which means non-qualifiers will fail the `team_to_group`
# lookup in the outrights router and get filtered out).

OUTRIGHT_TEAM_ALIASES: dict[str, str] = {
    "South Korea":             "Korea Republic",
    "Iran":                    "IR Iran",
    "DR Congo":                "Congo DR",
    "Czech Republic":          "Czechia",
    "Bosnia & Herzegovina":    "Bosnia and Herzegovina",
    "Curaçao":                 "Curacao",
    "Turkey":                  "Turkiye",
    "Côte d'Ivoire":           "Ivory Coast",
}


def normalize_outright_team(name: str) -> str:
    """Return Crown's canonical team_h_en string for a bookmaker name."""
    if not name:
        return ""
    return OUTRIGHT_TEAM_ALIASES.get(name.strip(), name.strip())


# ---------------------------------------------------------------------------
# Crown sfs_match (legacy outright catalog) reader.
#
# sfs_match carries every "championship/special" market that
# `/agents/`, `/admin/`, `/d0/` already render — for FIFA World Cup
# 2026 (lid=104036) that's ~56 distinct markets and 693 outcome rows:
# Winner, Top Goalscorer, To Reach Final/Semi/Quarter, 12× Group X
# Winner, 12× Group X To Qualify, 12× <Country> Top Goalscorer,
# 12× <Country> Stage of Elimination, Winning Group, Winning
# Continent, First Time Winner, Winner / Top Goalscorer.
#
# The new H5 used to surface only the upstream "Winner" market from
# the-odds-api.com (48 qualifiers).  This reader lets it offer the
# full Crown catalog instead, so operators and players see the same
# market list.
#
# Market categorisation rules (used by the API layer to slot each
# market into a UI tab):
#   * tournament      — Winner, Top Goalscorer, Winner / Top Goalscorer,
#                       First Time Winner, Winning Continent
#   * stage           — To Reach Final / Semi Finals / Quarter Finals
#   * group_letter:X  — Group X Winner / Group X To Qualify
#   * team:<en>       — <Country> Top Goalscorer / <Country> Stage of
#                       Elimination
#   * other           — Winning Group + anything we haven't seen before
#
# Sorted output: each market's outcomes by ioratio ASC (favourites
# first); markets by category then name.

_CROWN_OUTRIGHT_CACHE: dict[int, tuple[float, dict]] = {}
_CROWN_OUTRIGHT_TTL = 300  # 5 min — sfs_match is updated by Crown's PHP cron


def _classify_crown_outright_market(name_en: str) -> dict[str, Any]:
    """Slot a `teamsname_en` value into a category + sub-key.  Pure
    function so the API/frontend can rely on the categorisation being
    stable across reads.
    """
    n = name_en.strip()
    low = n.lower()
    # Group-level: "Group X Winner" / "Group X To Qualify"
    if low.startswith("group ") and len(n) >= 8:
        letter = n[6].upper()
        if "A" <= letter <= "Z":
            kind = "winner" if "winner" in low else ("qualify" if "qualify" in low else "other")
            return {"category": "group", "group": letter, "kind": kind, "order": (10, letter, kind)}
    # Per-team Top Goalscorer / Stage of Elimination — first word is the
    # country, suffix is the market.  Match suffixes loosely so the
    # mixed-case "Stage Of Elimination" / "Stage of Elimination" both
    # land in the same bucket.
    if low.endswith(" top goalscorer"):
        country = n[: -len(" top goalscorer")].strip()
        return {"category": "team", "team": country, "kind": "top_goalscorer", "order": (30, country, "tg")}
    if low.endswith(" stage of elimination"):
        country = n[: -len(" stage of elimination")].strip()
        return {"category": "team", "team": country, "kind": "stage_elimination", "order": (31, country, "se")}
    # Stage progression
    if low in {"to reach final", "to reach semi finals", "to reach quarter finals"}:
        rank = {"to reach final": 0, "to reach semi finals": 1, "to reach quarter finals": 2}[low]
        return {"category": "stage", "kind": low.replace(" ", "_"), "order": (20, rank, "")}
    # Tournament-wide
    if low in {"winner", "top goalscorer", "winner / top goalscorer",
               "first time winner", "winning continent", "winning group"}:
        rank = {
            "winner": 0,
            "top goalscorer": 1,
            "winner / top goalscorer": 2,
            "first time winner": 3,
            "winning group": 4,
            "winning continent": 5,
        }[low]
        return {"category": "tournament", "kind": low.replace(" ", "_").replace("/", "_"),
                "order": (0, rank, "")}
    return {"category": "other", "kind": low, "order": (99, low, "")}


def crown_outrights(lid: int) -> dict[str, Any]:
    """Return the full Crown-side outright catalog for a given ``lid``.

    Shape::

        {
          "lid": 104036,
          "league_en": "World Cup 2026 (USA / CAN / MEX)",
          "kickoff_ts": 1773443200,
          "markets": [
            { "name_cn": "冠军", "name_tw": "冠軍", "name_en": "Winner",
              "category": "tournament", "kind": "winner",
              "outcomes": [
                {"team_cn": "西班牙", "team_tw": "西班牙", "team_en": "Spain",
                 "ioratio": 5.5, "sfs_id": "FS", "rtype": "FS03",
                 "group": "H"},
                ...
              ],
              "outcome_count": 63 },
            ...
          ]
        }

    Results are cached 5 min per ``lid`` because sfs_match only ticks
    on the Crown PHP cron (every couple of minutes).
    """
    import time as _time
    now = _time.time()
    cached = _CROWN_OUTRIGHT_CACHE.get(lid)
    if cached and now - cached[0] < _CROWN_OUTRIGHT_TTL:
        return cached[1]

    try:
        rows = fetch_all(
            "SELECT teamsname, teamsname_tw, teamsname_en, "
            "       team, team_tw, team_en, "
            "       ioratio, sfs_id, rtype, league, league_tw, league_en, "
            "       `datetime` AS kickoff_ts "
            "FROM sfs_match WHERE lid = %s "
            "ORDER BY teamsname_en, (ioratio + 0) ASC",
            (lid,),
        )
    except Exception as e:                                            # noqa: BLE001
        log.warning("sfs_match read failed for lid=%s: %s", lid, e)
        rows = []

    if not rows:
        payload = {
            "lid": int(lid),
            "league_en": "",
            "kickoff_ts": 0,
            "markets": [],
            "outcome_total": 0,
            "available": False,
        }
        _CROWN_OUTRIGHT_CACHE[lid] = (now, payload)
        return payload

    # WC: attach group letter to each team for the UI's group-by-letter
    # view; non-WC lids leave `group` as None.
    team_to_group: dict[str, str] = {}
    if int(lid) == _WC_OUTRIGHT_LID:
        try:
            wc = world_cup_groups()
            team_to_group = wc.get("team_to_group") or {}
        except Exception as e:                                        # noqa: BLE001
            log.warning("world_cup_groups failed inside crown_outrights: %s", e)
            team_to_group = {}

    by_market: dict[str, dict[str, Any]] = {}
    for r in rows:
        market_en = (r.get("teamsname_en") or "").strip()
        if not market_en:
            continue
        m = by_market.get(market_en)
        if m is None:
            cat = _classify_crown_outright_market(market_en)
            m = {
                "name_cn":   r.get("teamsname"),
                "name_tw":   r.get("teamsname_tw"),
                "name_en":   market_en,
                "category":  cat["category"],
                "kind":      cat["kind"],
                "group":     cat.get("group"),
                "team":      cat.get("team"),
                "_order":    cat["order"],
                "outcomes":  [],
            }
            by_market[market_en] = m
        team_en_raw = (r.get("team_en") or "").strip()
        team_en_canon = OUTRIGHT_TEAM_ALIASES.get(team_en_raw, team_en_raw)
        m["outcomes"].append({
            "team_cn": r.get("team"),
            "team_tw": r.get("team_tw"),
            "team_en": team_en_raw,
            "team_en_canon": team_en_canon,
            "ioratio": _parse_decimal(r.get("ioratio")),
            "sfs_id":  r.get("sfs_id"),
            "rtype":   r.get("rtype"),
            "group":   team_to_group.get(team_en_canon),
        })

    markets_sorted: list[dict[str, Any]] = []
    for market in by_market.values():
        market["outcome_count"] = len(market["outcomes"])
        markets_sorted.append(market)
    markets_sorted.sort(key=lambda m: m["_order"])
    for m in markets_sorted:
        m.pop("_order", None)

    sample = rows[0]
    payload = {
        "lid":           int(lid),
        "league_en":     sample.get("league_en") or sample.get("league") or "",
        "league_cn":     sample.get("league") or "",
        "league_tw":     sample.get("league_tw") or "",
        "kickoff_ts":    int(sample.get("kickoff_ts") or 0),
        "markets":       markets_sorted,
        "outcome_total": sum(m["outcome_count"] for m in markets_sorted),
        "available":     True,
    }
    _CROWN_OUTRIGHT_CACHE[lid] = (now, payload)
    return payload


def _parse_decimal(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        f = float(v)
        return f if f > 0 else None
    except (TypeError, ValueError):
        return None
