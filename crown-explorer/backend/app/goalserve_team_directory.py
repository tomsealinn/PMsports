"""Goalserve team-id directory.

The in-play and pregame feeds we already consume do NOT expose Goalserve's
numeric team IDs — only the team *names*.  The Goalserve **logo** endpoint
(`http://data2.goalserve.com:8084/api/v1/logotips/soccer/teams?ids=<id>`),
however, requires the numeric IDs.   To bridge the gap this module polls
Goalserve's `soccernew/home` schedule feed, which DOES carry the IDs in
``<localteam id="36507" name="…">`` and ``<visitorteam id=… name=…>``
elements, and persists a ``name → id`` map in a SQLite database so the
hot path (snapshot builders, logo endpoint) can resolve IDs in O(1).

Design notes
------------
* **One poll every `GS_TD_INTERVAL` seconds** (default 21600 = 6h).  The
  schedule feed is mostly static; team IDs only change when Goalserve adds
  a new club.  A 6h refresh is plenty without burning rate-limit budget
  (we already hit Goalserve for inplay+pregame every few seconds).
* **SQLite at `$GS_TD_DB` (default `/var/lib/pmppm/team_directory.sqlite`).**
  Tiny — at the time of writing the full Goalserve roster is ~50k teams.
* **Name normalization.**  Goalserve sometimes appends ` W` for women's,
  ` U19` for youths, etc.  We store *and* index the raw name verbatim;
  callers should pass the same name they got from the inplay/pregame feed.
* **Failure tolerance.**  HTTP errors, parse errors, or DB errors are
  logged and the module keeps polling; lookups simply return None for any
  unknown team so the snapshot pipeline never breaks.

Public API
----------
* ``init(db_path: Path) -> None`` — open/create the SQLite store.
* ``lookup(name: str) -> int | None`` — synchronous name-to-id resolver.
  Safe to call from request handlers (single SELECT, indexed).
* ``async run(stop: asyncio.Event)`` — main polling loop.  Spawn from
  ``app.main`` lifespan alongside the other goalserve pollers.
* ``build_from_env() -> GoalserveTeamDirectory | None`` — env-driven
  factory mirroring the ``goalserve_inplay_ws.build_from_env`` pattern.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sqlite3
import time
import urllib.error
import urllib.request
from pathlib import Path
from xml.etree import ElementTree as ET

log = logging.getLogger("goalserve_team_directory")

# --------------------------------------------------------------------------
# Config
GS_API_KEY = os.environ.get("GS_API_KEY", "3416f409c2584c9e081c08debf8ab4bb")
GS_TD_URL = os.environ.get(
    "GS_TD_URL",
    f"http://www.goalserve.com/getfeed/{GS_API_KEY}/soccernew/home",
)
GS_TD_DB = Path(os.environ.get("GS_TD_DB", "/var/lib/pmppm/team_directory.sqlite"))
GS_TD_INTERVAL = float(os.environ.get("GS_TD_INTERVAL", "21600"))   # 6h
GS_TD_HTTP_TIMEOUT = float(os.environ.get("GS_TD_HTTP_TIMEOUT", "30"))
GS_TD_BOOTSTRAP_DELAY = float(os.environ.get("GS_TD_BOOTSTRAP_DELAY", "5"))


# --------------------------------------------------------------------------
# DB layer  — thread-safe via per-call connections; the workload is tiny so
# the open/close cost is irrelevant.   We use WAL so concurrent readers in
# the FastAPI request thread never block the background poller.
_DB_INIT_SQL = """
CREATE TABLE IF NOT EXISTS teams (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    league_id  INTEGER,
    last_seen  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams (name);

CREATE TABLE IF NOT EXISTS leagues (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    last_seen  INTEGER NOT NULL
);
"""


# Process-lifetime memo for name->id so the hot snapshot-build path (called
# per team per event ON THE EVENT LOOP via normalize_event -> _gs_team_lookup)
# does not open a fresh SQLite connection + run the CREATE-IF-NOT-EXISTS init
# script on EVERY lookup.  Positive hits are immutable (a team's goalserve id
# never changes) so they are cached indefinitely; misses are cached for a short
# TTL so a team added by a later poll still resolves within one TTL window.
# dict get/set is atomic under the GIL, so sharing between the event loop and
# the threadpool needs no explicit lock.
_LOOKUP_MEMO: "dict[str, tuple[float, int | None]]" = {}
_LOOKUP_MEMO_LEAGUE: "dict[str, tuple[float, int | None]]" = {}
_LOOKUP_NEG_TTL = float(os.environ.get("GS_TD_NEG_TTL", "600"))


def _open_db() -> sqlite3.Connection:
    GS_TD_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(GS_TD_DB, timeout=5.0)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.executescript(_DB_INIT_SQL)
    return conn


def lookup(name: str) -> "int | None":
    """Return the goalserve numeric team id for `name`, or None if unknown.

    Safe to call from any thread; opens its own short-lived connection so
    we don't have to share state with the background poller.   Caller is
    expected to handle the None case gracefully (e.g. omit the logo URL).
    """
    if not name:
        return None
    key = name.strip()
    _ent = _LOOKUP_MEMO.get(key)
    if _ent is not None and (_ent[1] is not None or time.time() < _ent[0]):
        return _ent[1]
    try:
        conn = _open_db()
        try:
            cur = conn.execute(
                "SELECT id FROM teams WHERE name = ? ORDER BY last_seen DESC LIMIT 1",
                (key,),
            )
            row = cur.fetchone()
            val = int(row[0]) if row else None
        finally:
            conn.close()
    except sqlite3.Error as e:
        log.warning("lookup(%r) sqlite error: %s", name, e)
        return None
    _LOOKUP_MEMO[key] = (time.time() + _LOOKUP_NEG_TTL, val)
    return val


def lookup_league(name: str) -> "int | None":
    """Return the goalserve numeric league id for `name`, or None."""
    if not name:
        return None
    key = name.strip()
    _ent = _LOOKUP_MEMO_LEAGUE.get(key)
    if _ent is not None and (_ent[1] is not None or time.time() < _ent[0]):
        return _ent[1]
    try:
        conn = _open_db()
        try:
            cur = conn.execute(
                "SELECT id FROM leagues WHERE name = ? ORDER BY last_seen DESC LIMIT 1",
                (key,),
            )
            row = cur.fetchone()
            val = int(row[0]) if row else None
        finally:
            conn.close()
    except sqlite3.Error as e:
        log.warning("lookup_league(%r) sqlite error: %s", name, e)
        return None
    _LOOKUP_MEMO_LEAGUE[key] = (time.time() + _LOOKUP_NEG_TTL, val)
    return val


def upsert_inline(
    teams: "list[tuple[int | None, str | None]] | None" = None,
    league_id: "int | None" = None,
    league_name: "str | None" = None,
) -> int:
    """Upsert a small batch of (team_id, team_name) pairs (and an optional
    parent league) into the directory.   Designed to be called from the
    pregame poller for every parsed match — gives us drip-feed coverage
    that grows toward the full goalserve roster over a day or two without
    burning a separate poll budget.

    Returns the number of team rows touched.   Silently no-ops on any
    sqlite error (cache file rotated, lock contention, etc.) so callers
    don't need to wrap in their own try.
    """
    if not teams:
        return 0
    now = int(time.time())
    touched = 0
    try:
        conn = _open_db()
        try:
            with conn:
                for tid, tname in teams:
                    if tid is None or not tname:
                        continue
                    try:
                        tid_int = int(tid)
                    except (TypeError, ValueError):
                        continue
                    if tid_int <= 0:
                        continue
                    conn.execute(
                        """
                        INSERT INTO teams (id, name, league_id, last_seen)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            name      = excluded.name,
                            league_id = COALESCE(excluded.league_id, teams.league_id),
                            last_seen = excluded.last_seen
                        """,
                        (tid_int, str(tname).strip(), league_id, now),
                    )
                    touched += 1
                if league_id is not None and league_name:
                    try:
                        lg_int = int(league_id)
                        if lg_int > 0:
                            conn.execute(
                                """
                                INSERT INTO leagues (id, name, last_seen) VALUES (?, ?, ?)
                                ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen
                                """,
                                (lg_int, str(league_name).strip(), now),
                            )
                    except (TypeError, ValueError):
                        pass
        finally:
            conn.close()
    except sqlite3.Error:
        return 0
    return touched


def stats() -> dict:
    """Diagnostics for /api/external/ws/status or a future health page."""
    try:
        conn = _open_db()
        try:
            tc = conn.execute("SELECT COUNT(*) FROM teams").fetchone()[0]
            lc = conn.execute("SELECT COUNT(*) FROM leagues").fetchone()[0]
            mt = conn.execute("SELECT MAX(last_seen) FROM teams").fetchone()[0]
            return {"teams": tc, "leagues": lc, "last_seen_ts": mt}
        finally:
            conn.close()
    except sqlite3.Error as e:
        return {"error": str(e)}


# --------------------------------------------------------------------------
# Fetch + parse
def _fetch_xml(url: str) -> "bytes | None":
    """HTTP GET with a forgiving timeout.   Returns None on error so the
    poll loop can simply skip this cycle."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "pmppm-team-directory/1.0"})
        with urllib.request.urlopen(req, timeout=GS_TD_HTTP_TIMEOUT) as r:
            data = r.read()
            if not data or data.startswith(b"<html") or data.startswith(b"<!DOCTYPE"):
                log.warning("td fetch: non-XML payload (%d bytes, head=%r)", len(data), data[:80])
                return None
            return data
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        log.warning("td fetch: %s", e)
        return None


def _parse_into_db(xml_bytes: bytes, conn: sqlite3.Connection) -> "tuple[int, int]":
    """Walk every <localteam>/<visitorteam> in the schedule, upsert
    (id,name) into the teams table.   Each <category> also gives us a
    league_id/name pair.   Returns (teams_seen, leagues_seen) for logging.

    The feed has the structure:
        <scores>
          <category id="5347" name="..." gid="5348" ...>
            <matches>
              <match ...>
                <localteam id="36507" name="..." />
                <visitorteam id="..." name="..." />
              </match>
              ...
    """
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        log.warning("td parse: %s", e)
        return (0, 0)

    now = int(time.time())
    team_rows: "dict[int, tuple[str, int | None]]" = {}
    league_rows: "dict[int, str]" = {}

    for cat in root.iter("category"):
        try:
            lg_id = int(cat.get("id") or 0)
        except (TypeError, ValueError):
            lg_id = 0
        lg_name = (cat.get("name") or "").strip()
        if lg_id and lg_name:
            league_rows[lg_id] = lg_name
        for team_el in cat.iter("localteam"):
            _collect_team(team_el, lg_id or None, team_rows)
        for team_el in cat.iter("visitorteam"):
            _collect_team(team_el, lg_id or None, team_rows)

    # Upserts.   `INSERT OR REPLACE` would also reset `last_seen`, but it
    # nukes existing rows that aren't in this poll — we want last_seen to
    # bump only when the team appears.   Use UPSERT instead.
    with conn:
        for tid, (name, lg) in team_rows.items():
            conn.execute(
                """
                INSERT INTO teams (id, name, league_id, last_seen)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name      = excluded.name,
                    league_id = COALESCE(excluded.league_id, teams.league_id),
                    last_seen = excluded.last_seen
                """,
                (tid, name, lg, now),
            )
        for lg_id, lg_name in league_rows.items():
            conn.execute(
                """
                INSERT INTO leagues (id, name, last_seen) VALUES (?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen
                """,
                (lg_id, lg_name, now),
            )
    return (len(team_rows), len(league_rows))


def _collect_team(el: ET.Element, league_id: "int | None", out: dict) -> None:
    """Extract id/name from a <localteam>/<visitorteam> element; ignore the
    blank/invalid IDs Goalserve occasionally emits for unknown sides."""
    raw_id = (el.get("id") or "").strip()
    raw_nm = (el.get("name") or "").strip()
    if not raw_id or not raw_nm:
        return
    try:
        tid = int(raw_id)
    except ValueError:
        return
    if tid <= 0:
        return
    # Latest-wins: a single poll can mention the same team in multiple
    # matches, but their (id, name) tuple is identical so the dict dedup
    # is correct.
    out[tid] = (raw_nm, league_id)


# --------------------------------------------------------------------------
# Poller
class GoalserveTeamDirectory:
    """Lifespan-owned poller.   See module docstring for design notes."""

    def __init__(self, url: str = GS_TD_URL, interval: float = GS_TD_INTERVAL) -> None:
        self.url = url
        self.interval = max(60.0, interval)
        self.last_poll_ts: "float | None" = None
        self.last_poll_ok = False
        self.last_count = 0

    async def run(self, stop: asyncio.Event) -> None:
        """Main loop.  Initial poll happens after `GS_TD_BOOTSTRAP_DELAY`
        so we don't pile onto the cold-start request burst."""
        log.info(
            "team-directory poller starting url=%s interval=%.0fs db=%s",
            self.url, self.interval, GS_TD_DB,
        )
        try:
            await asyncio.wait_for(stop.wait(), timeout=GS_TD_BOOTSTRAP_DELAY)
            return
        except asyncio.TimeoutError:
            pass

        while not stop.is_set():
            try:
                await asyncio.to_thread(self._poll_once)
            except Exception as e:  # noqa: BLE001
                log.warning("td poll cycle: %s", e)
            try:
                await asyncio.wait_for(stop.wait(), timeout=self.interval)
                return
            except asyncio.TimeoutError:
                pass

    def _poll_once(self) -> None:
        """One blocking fetch+parse cycle.   Runs in a worker thread.

        Fetches today (self.url = soccernew/home) PLUS a window of
        day-feeds (d1..d6 future, d-1..d-3 past) so the directory captures
        senior national teams that only appear in international-break
        friendlies / qualifiers — these are absent from the today feed but
        present in the surrounding days.   Each feed carries the same
        <localteam id=.. name=..> shape, so one parser handles them all.
        Failures on any single feed are logged and skipped (best-effort).
        """
        t0 = time.time()
        # Derive the soccernew base from self.url so an override still works.
        base = _re.sub(r"/soccernew/[^/?]*.*$", "/soccernew/", self.url)
        if not base.endswith("/soccernew/"):
            base = self.url  # non-standard override: fall back to single fetch
            suffixes = [""]
        else:
            suffixes = ["home", "d1", "d2", "d3", "d4", "d5", "d6",
                        "d-1", "d-2", "d-3"]
        self.last_poll_ts = time.time()
        total_teams = 0; total_leagues = 0; feeds_ok = 0
        try:
            conn = _open_db()
            try:
                for suf in suffixes:
                    url = (base + suf) if suffixes != [""] else base
                    body = _fetch_xml(url)
                    if not body:
                        continue
                    try:
                        t, l = _parse_into_db(body, conn)
                        total_teams += t; total_leagues += l; feeds_ok += 1
                    except Exception as e:  # noqa: BLE001
                        log.warning("td parse %s: %s", suf or "home", e)
                    time.sleep(0.4)
            finally:
                conn.close()
        except sqlite3.Error as e:
            log.warning("td sqlite write: %s", e)
            self.last_poll_ok = False
            return
        self.last_poll_ok = feeds_ok > 0
        self.last_count = total_teams
        log.info(
            "td poll ok: %d feeds, %d team-refs + %d leagues in %.2fs",
            feeds_ok, total_teams, total_leagues, time.time() - t0,
        )


def build_from_env() -> "GoalserveTeamDirectory | None":
    """Factory for app/main.py — matches the pattern of the other goalserve
    builders.   The directory has no auth requirements beyond the API
    key already used by inplay/pregame, so we always return a poller
    unless `GS_TD_DISABLE` is set."""
    if os.environ.get("GS_TD_DISABLE"):
        log.info("team-directory disabled via GS_TD_DISABLE")
        return None
    return GoalserveTeamDirectory()


# ---- name normalisation fallback ------------------------------------
# Legacy foot_match rows carry team names with suffixes ("FC", "EC", "FK",
# "(r)", "U21" ...) that the Goalserve feed often omits.  A first call
# builds an in-memory cache keyed by the normalised name; subsequent
# lookups are O(1).  Caller still handles None gracefully (initials
# fallback on the crest <img>'s onerror).

import re as _re

_NORMAL_CACHE: "dict[str, int] | None" = None

# National-team / common name variants whose normalised form differs from the
# canonical name Goalserve uses in its schedule (soccernew) feed.  The in-play
# feed sometimes reports an alternate spelling (e.g. "Czechia") while the team
# directory only ever stored the schedule-feed name ("Czech Republic" -> id
# 8460), so name->id lookup misses and the crest falls back to initials.  Keys
# AND values are already-normalised forms (lower-case, no whitespace/punct).
_NAME_ALIASES = {
    "czechia": "czechrepublic",
}


def _normalize_team_name(name: str) -> str:
    if not name:
        return ""
    s = name.strip().lower()
    # trailing qualifiers: (r) (w) (u21) (women) (reserves) (ii) (b) (y)
    s = _re.sub(r"\s*\((?:r|w|u\d+|women|reserves?|res|ii|b|youth|y)\)\s*$", "", s)
    # common club suffixes
    s = _re.sub(r"\s+(fc|cf|ec|fk|sk|sc|ac|cd|kc|nk|hk|cs|sa|cp|pfc|mfc|tc|rk|kfc|cfc|csf)\s*$", "", s)
    # strip all whitespace + punctuation so "St. Pauli" matches "St Pauli"
    s = _re.sub(r"[\s\._\-]+", "", s)
    return _NAME_ALIASES.get(s, s)


def _build_normal_cache() -> "dict[str, int]":
    cache: "dict[str, int]" = {}
    try:
        conn = _open_db()
        try:
            # ORDER BY last_seen DESC so the freshest team wins on collisions.
            for tid, name in conn.execute(
                "SELECT id, name FROM teams ORDER BY last_seen DESC"
            ):
                k = _normalize_team_name(name)
                if k and k not in cache:
                    cache[k] = int(tid)
        finally:
            conn.close()
    except sqlite3.Error as e:
        log.warning("normal-cache build failed: %s", e)
        return {}
    return cache


def lookup_normalized(name: str) -> "int | None":
    """lookup() with a normalised-name fallback (suffix/case/punct stripped)."""
    if not name:
        return None
    direct = lookup(name)
    if direct:
        return direct
    global _NORMAL_CACHE
    if _NORMAL_CACHE is None:
        _NORMAL_CACHE = _build_normal_cache()
    key = _normalize_team_name(name)
    return _NORMAL_CACHE.get(key)
