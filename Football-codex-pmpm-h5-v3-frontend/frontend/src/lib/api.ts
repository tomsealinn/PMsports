/**
 * PmPm v3 H5 — typed client for the crown-explorer FastAPI backend.
 *
 * Same-origin `fetch` is used because `next.config.ts` rewrites `/api/*` to
 * the backend in dev. In production the rewrites still apply if the Next
 * runtime serves the prototype, otherwise set NEXT_PUBLIC_API_BASE to a
 * fully qualified URL when the prototype is statically exported.
 */

const ORIGIN =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE
    ? process.env.NEXT_PUBLIC_API_BASE.replace(/\/+$/, "")
    : "";

export type SportCode = "FT" | "BK" | "TN" | "VB" | "BM" | "SK" | "ES" | "FS" | "BS" | "OP";

export interface MatchSummary {
  match_id: string | number;
  sport_code: SportCode | string;
  sport_label: string | null;
  m_date: string | null;
  league: string | null;
  league_tw: string | null;
  league_en: string | null;
  team_h: string | null;
  team_c: string | null;
  team_h_tw: string | null;
  team_c_tw: string | null;
  team_h_en: string | null;
  team_c_en: string | null;
  gnum_h: string | number | null;
  gnum_c: string | number | null;
  first_bet_ts: number | null;
  last_bet_ts: number | null;
  score: string | null;
  org_score: string | null;
  is_resolved: boolean;
  bets: number;
  stake_total: number | null;
  market_count: number;
}

export interface MatchListResp {
  total: number;
  items: MatchSummary[];
}

export interface MarketOption {
  market_id: string;
  wtype: string;
  wtype_label: string | null;
  ptype: string | null;
  ptype_label: string | null;
  spread: string | null;
  latest_ioratio: number | null;
  bets: number;
  stake_total: number | null;
}

export interface MarketsResp {
  match: MatchSummary;
  items: MarketOption[];
  total: number;
}

export interface BetRow {
  ID: number;
  m_name: string | null;
  bet_time: number | null;
  gtype: string | null;
  ptype: string | null;
  wtype: string | null;
  rtype: string | null;
  league: string | null;
  team_h: string | null;
  team_c: string | null;
  spread: string | null;
  ioratio: string | null;
  score: string | null;
  org_score: string | null;
  bet_golds: string | null;
  valid_gold: string | null;
  mem_result: string | null;
  result: string | null;
  isResult: number | null;
  status: number | null;
  cancel: number | null;
  danger: number | null;
  inball: string | null;
  isEdit: number | null;
  edit_type: number | null;
  edit_name: string | null;
  ticket_id: string | null;
  bet_ip: string | null;
  currency: string | null;
  gtype_label: string | null;
  ptype_label: string | null;
  wtype_label: string | null;
  // Outcome direction written by api_v2.php at place-bet time.  betstr is
  // the human-readable label (e.g. "卡塔尔" / "主胜 -1.5" / "Match A｜独赢｜
  // 主胜 / Match B｜让球｜客胜 -1.5" for parlays).  chose_team is "H" / "C"
  // / null when applicable.  ptype_en is the English market label.
  // Surfaced 2026-05-24 so the orders list can show which side the user
  // actually picked instead of just the match + market type.
  betstr?: string | null;
  chose_team?: string | null;
  ptype_en?: string | null;
}

export interface BetsResp {
  total: number;
  items: BetRow[];
}

export interface OverviewResp {
  counts: Record<string, number>;
  bet_totals: {
    bet_total: number | null;
    valid_total: number | null;
    member_pnl: number | null;
    ag_pnl: number | null;
    co_pnl: number | null;
    d0_pnl: number | null;
    first_bet_ts: number | null;
    last_bet_ts: number | null;
  };
}

export class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, statusText: string, body: string, path: string) {
    super(`${status} ${statusText} on ${path}: ${body || "(empty body)"}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${ORIGIN}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
    // Include cookies for auth endpoints. Same-origin in production
    // (pmppm.com → /api/*); harmless cross-origin in dev where the
    // browser would refuse to attach credentials anyway.
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, res.statusText, body, path);
  }
  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (entries.length === 0) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of entries) sp.set(k, String(v));
  return `?${sp.toString()}`;
}

// ===========================================================================
// odds-api.io (via crown-explorer /api/external/*)
// ---------------------------------------------------------------------------

export type OddsEventStatus = "pending" | "inplay" | "live" | "settled" | "cancelled";

export interface OddsLeagueSummary {
  league_slug: string;
  league_name: string | null;
  events: number;
  active: number;
  settled: number;
  first_ts: number | null;
  last_ts: number | null;
}

/**
 * Compact match-event entry forwarded by the api-sports.io ingest cron and
 * stored in foot_match.apisports_events_json.  Field names are deliberately
 * short (one letter) to keep the JSON payload small over the HTTP poll loop.
 */
export interface ApiSportsLiveEvent {
  m:  number;            // minute (regulation)
  x?: number | null;     // extra/stoppage-time minutes
  s:  "h" | "c" | string; // side: "h"=home, "c"=away, other=neutral
  t:  string;            // type: "Goal" | "Card" | "subst" | "Var" | ...
  d?: string | null;     // detail: "Normal Goal" | "Yellow Card" | ...
  p?: string | null;     // player name
  a?: string | null;     // assist player name
}

export interface OddsEvent {
  id: number;
  sport_slug: string;
  league_slug: string;
  league_name: string | null;
  home: string | null;
  away: string | null;
  home_id: string | number | null;
  away_id: string | number | null;
  commence_iso: string | null;
  commence_ts: number | null;
  status: OddsEventStatus | string;
  score_home: number | null;
  score_away: number | null;
  score_home_ht?: number | null;
  score_away_ht?: number | null;
  is_finished?: boolean;
  // api-sports live stats (written by --with-stats cron pass)
  elapsed_minute?: number | null;
  status_short?: string | null;
  apisports_seen_at?: number | null;
  yc_home?: number | null;
  yc_away?: number | null;
  rc_home?: number | null;
  rc_away?: number | null;
  corners_home?: number | null;
  corners_away?: number | null;
  apisports_events?: ApiSportsLiveEvent[] | null;
  // FIFA World Cup only — group letter ("A".."L") derived by the backend
  // from foot_match fixtures (Crown has no group column natively).  Null
  // / missing for non-WC events; the H5 only shows group headers when
  // every match in the active list has a non-null group.
  group?: string | null;
  fetched_at: number;
  market_count: number;
  // api-sports.io cross-reference. Populated by the ingest script's third
  // pass (fuzzy match by team names + kickoff window). Null when the
  // event couldn't be linked, e.g. an unmapped league or a name mismatch.
  apisports_fixture_id: number | null;
  apisports_match_iso: string | null;
  main_odds?: {
    re_h: number; re_line: number; re_c: number;
    ou_over: number; ou_line: number; ou_under: number;
    m_h: number; m_n: number; m_c: number;
    btts_yes?: number; btts_no?: number;
    ht_h?: number; ht_n?: number; ht_c?: number;
    reh_h?: number; reh_line?: number; reh_c?: number;
    ouh_over?: number; ouh_line?: number; ouh_under?: number;
    btts_ht_yes?: number; btts_ht_no?: number;
    dc_1x?: number; dc_x2?: number; dc_12?: number;
    dnb_h?: number; dnb_c?: number;
    corners_over?: number; corners_line?: number; corners_under?: number;
  } | null;
  extra_markets?: { name: string; outcomes: number }[];
}

export interface OddsEventListResp {
  total: number;
  items: OddsEvent[];
}

export interface OddsLeagueListResp {
  total: number;
  items: OddsLeagueSummary[];
}

// ───────── league registry catalog (post-2026-05-28 dynamic discovery) ─────────
// Replaces the hard-coded `leagueRegions` list in sports/page.tsx.  Backend
// PHP endpoint: GET /api/external/leagues/catalog?tier=top|core|major|all
// FastAPI endpoint mirrors the same shape.

export interface CatalogLeague {
  lid: number;
  slug: string;
  name_en: string | null;
  name_cn: string;
  priority: number;
  events_count: number;
  apisports_id: number | null;
}

export interface CatalogCountry {
  id: string;          // 'england', 'australia', 'world', ...
  name_cn: string;
  name_en: string;
  flag: string;        // unicode emoji
  leagues: CatalogLeague[];
}

export interface CatalogRegion {
  id: string;          // 'europe' | 'asia' | 'americas' | 'africa' | 'oceania' | 'international' | 'other'
  name_cn: string;
  name_en: string;
  flag: string;
  countries: CatalogCountry[];
}

export interface LeagueCatalogResp {
  regions: CatalogRegion[];
  total_leagues: number;
  fetched_at: number;  // unix seconds
  tier?: string;       // echoed back when ?tier= was provided
}

export interface LeagueSearchHit {
  lid: number;
  slug: string;
  name_en: string | null;
  name_cn: string;
  region: string | null;
  country: string | null;
  flag: string;
  priority: number;
  events_count: number;
}

export interface LeagueSearchResp {
  q: string;
  total: number;
  items: LeagueSearchHit[];
}

/**
 * Per-league daily match counts returned by GET /api/external/leagues/daily-counts.
 * Shape: { counts: { [league_slug]: { ["YYYY-MM-DD"]: matchCount } } }
 */
export interface LeagueDailyCountsResp {
  counts: Record<string, Record<string, number>>;
  fetched_at?: number;
}

/**
 * The odds payload is shape-varied per market (e.g. ML emits
 * `{home,draw,away}`, Spread emits `{hdp,home,away}`, Totals emits
 * `{hdp,over,under}`, Double Chance emits `{label,under}` etc.). We keep
 * it as opaque records and let the renderer cherry-pick known fields.
 */
export type OddsMarketRow = Record<string, string | number | null>;

export interface OddsMarket {
  market_id: string;          // "000001" — 6-digit zero-padded
  market_id_int: number;      // raw int form, useful for sorting
  market_name: string;        // upstream name, e.g. "ML"
  odds: OddsMarketRow[];      // possibly multi-line market book
  updated_at_iso: string | null;
  updated_at_ts: number | null;
}

export interface OddsBookmaker {
  bookmaker: string;
  market_count: number;
  markets: OddsMarket[];
}

export interface OddsEventMarketsResp {
  event: OddsEvent;
  bookmakers: OddsBookmaker[];
  total_markets: number;
  // Provenance of the bookmakers tree.  Backend distinguishes:
  //   - "ws_live"        — built from /dev/shm/oddsapi_live (in-play WS push)
  //   - "r_cn_snapshot"  — decoded from MySQL r_cn (pre-match cron snapshot)
  //   - "finished"       — match has settled, no live markets returned
  // The detail screens use this to decide whether picks should be enabled
  // for in-play matches (only true when source === "ws_live", i.e. the
  // markets currently shown are live 滚球 odds rather than stale prematch).
  source?: "ws_live" | "r_cn_snapshot" | "finished";
}

// ===========================================================================
// pmppm.com Go backend (信用账户体系 — isolated from pmpm.uk)
// ---------------------------------------------------------------------------
//
// Lives at the same origin as the frontend; nginx routes the prefixes
// /api/auth, /api/user, /api/credit, /api/agent, /api/referral,
// /api/positions, /api/quote-{buy,sell}, /api/bet-promise(s) to a
// dedicated Go backend on 127.0.0.1:8081 with its own users.db (so
// pmpm.uk's user pool isn't touched).

export interface PmppmUser {
  id: number;
  username: string;
  wallet_address: string | null;
  agent_id: number | null;
  is_agent: boolean;
  must_change: boolean;
  status: string;
  created_at: string;
  is_credit: boolean;
  // `credit_balance` is the user's authorised credit balance converted to
  // USDT using the latest FX rate (see api_v2.php `toUSDT`).
  // `credit_balance_raw` holds the same amount in the player's native
  // currency (e.g. RMB / HKD / USD) before conversion; `currency` carries
  // the ISO-style code used by the upstream `member.currency` column.
  // `credit_limit` / `credit_limit_raw` mirror that for the authorised
  // ceiling, and `fx_rate` is the native-per-USD rate so the frontend can
  // re-derive native amounts after bet placement (which mutates USDT).
  credit_balance: number;
  credit_balance_raw?: number;
  credit_limit?: number;
  credit_limit_raw?: number;
  currency?: string;
  fx_rate?: number;
  fx_updated?: string;
}

export interface PmppmLoginResp {
  ok: boolean;
  must_change: boolean;
  change_reason?: 'set_loginname' | 'change_password' | '';
  user: PmppmUser;
}

export interface PmppmCreditMe {
  username: string;
  is_credit: boolean;
  credit_balance: number;
  credit_balance_raw?: number;
  credit_limit?: number;
  credit_limit_raw?: number;
  currency?: string;
  fx_rate?: number;
}

// Off-chain credit bet — payload + responses for /api/pmppm/place-bet
// and /api/pmppm/my-bets (PmPm v4 sportsbook flow, no chain transactions).
export interface PmppmPlaceBetReq {
  event_id: string;
  market_id: string;
  market_name: string;
  outcome_index: number;
  outcome_label: string;
  // Settlement hints — backend uses these (when present) to resolve
  // wtype/rtype/spread without having to substring-match a Chinese
  // outcome label against an English team name. See sports/page.tsx
  // placeBet payload for canonical field values.
  outcome_field?: string | null;
  outcome_line?: number | null;
  amount_usdt: number;
  odds: number;
  stake_amount?: number;
  stake_currency?: "USDT" | "RMB";
}

export interface PmppmPlaceBetResp {
  ok: boolean;
  bet_id: number;
  new_balance: number;
  new_balance_raw?: number | null;
  promised_payout: number;
  outcome_label: string;
  market_name: string;
}

export interface PmppmBetRow {
  id: number;
  event_id: string;
  market_id: string;
  market_name: string;
  outcome_index: number;
  outcome_label: string;
  amount_usdt: number;
  promised_odds: number;
  promised_payout: number;
  status: "open" | "won" | "lost" | "settled" | "failed";
  payout_usdt: number;
  created_at: string;
  settled_at?: string;
}

export const pmppmApi = {
  /** POST /api/auth/login — sets an HttpOnly `hga_token` cookie on success. */
  login(creds: { username: string; password: string }): Promise<PmppmLoginResp> {
    return request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(creds),
    });
  },
  logout(): Promise<{ ok: boolean }> {
    return request("/api/auth/logout", { method: "POST" });
  },
  /** POST /api/auth/set-loginname — first login: set login account name. */
  setLoginname(loginname: string): Promise<{ ok: boolean; username?: string; detail?: string }> {
    return request("/api/auth/set-loginname", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loginname }),
    });
  },
  /** POST /api/auth/change-pwd — forced password change. */
  changePwd(old_password: string, new_password: string): Promise<{ ok: boolean; detail?: string }> {
    return request("/api/auth/change-pwd", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ old_password, new_password }),
    });
  },
  /** GET /api/auth/me — current user from the auth cookie. */
  me(): Promise<{ user: PmppmUser }> {
    return request("/api/auth/me");
  },
  /** GET /api/credit/me — credit balance, used by header + profile pills. */
  creditMe(): Promise<PmppmCreditMe> {
    return request("/api/credit/me");
  },
  /** POST /api/pmppm/place-bet — atomic off-chain credit deduction + bet. */
  placeBet(body: PmppmPlaceBetReq): Promise<PmppmPlaceBetResp> {
    return request("/api/pmppm/place-bet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  /** GET /api/pmppm/my-bets — this user's off-chain bet history. */
  myBets(): Promise<{ ok: boolean; bets: PmppmBetRow[] }> {
    return request("/api/pmppm/my-bets");
  },

  // ---- agent ops --------------------------------------------------------
  /** GET /api/agent/list-users — agents see their direct downline. */
  agentListUsers(): Promise<{ ok: boolean; users: PmppmUser[]; count: number }> {
    return request("/api/agent/list-users");
  },
  /** GET /api/agent/sub-agents — sub-agents (L+1 tier) under this agent. */
  agentSubAgents(): Promise<{ ok: boolean; sub_agents: PmppmUser[]; count: number }> {
    return request("/api/agent/sub-agents");
  },
  /** GET /api/agent/credit/list — credit accounts I (the agent) have issued. */
  agentCreditList(): Promise<{ users: Array<PmppmUser & { credit_balance: number }> }> {
    return request("/api/agent/credit/list");
  },
  /**
   * POST /api/pmppm/agent/create-user — off-chain "one-shot" provisioning:
   * creates `count` users with `is_credit=TRUE` and an initial credit
   * authorisation. Returns plaintext password ONCE so the agent can hand
   * it off; the backend never exposes it again.
   *
   * NB: we intentionally use the off-chain `/api/pmppm/agent/create-user`
   * here, not the upstream `/api/agent/credit/create`, because the
   * upstream variant requires a configured agent mother-wallet (BSC).
   */
  agentCreateUser(count = 1, initialCredit = 1000): Promise<{
    ok: boolean;
    count: number;
    users: Array<{ user_id: number; username: string; password: string; credit_balance: number }>;
  }> {
    return request("/api/pmppm/agent/create-user", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count, initial_credit: initialCredit }),
    });
  },
  /**
   * POST /api/agent/credit/topup — add to a downline user's credit.
   * Backend field name is `delta` (signed: positive credits, negative
   * debits the balance).
   */
  agentCreditTopup(userId: number, delta: number): Promise<{ ok: boolean; balance: number }> {
    return request("/api/agent/credit/topup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: userId, delta }),
    });
  },
};

// ---------------------------------------------------------------------------
// api-sports.io → right-sidebar widget payloads (statistics / events /
// h2h / standings / stream / tracker). All proxied through api_v2.php so
// the upstream key never leaves the server.
// ---------------------------------------------------------------------------

export interface MatchStreamResp {
  ok: boolean;
  url: string | null;
  reason?: string;
}

export interface MatchTrackerResp {
  ok: boolean;
  widget_url: string | null;
}

export interface MatchStatItem {
  type: string;          // e.g. "Ball Possession", "Shots on Goal"
  value: string | number | null;
}

export interface MatchStatTeam {
  team: { id: number | null; name: string | null; logo: string | null };
  stats: MatchStatItem[];
}

export interface MatchStatisticsResp {
  ok: boolean;
  mapped: boolean;
  teams: MatchStatTeam[];
}

export interface MatchEventItem {
  minute: number | null;
  extra: number | null;
  team: string | null;
  team_id: number | null;
  player: string | null;
  assist: string | null;
  type: string;          // "Goal" | "Card" | "subst" | ...
  detail: string;        // "Yellow Card" | "Normal Goal" | ...
  comments: string | null;
}

export interface MatchEventsResp {
  ok: boolean;
  mapped: boolean;
  events: MatchEventItem[];
}

// Lineup payload returned by /api/external/match/{gid}/lineups.
// Mirrors api-sports.io `/fixtures/lineups` after PHP-side simplification:
// the H5 frontend consumes formation + 11 player grid coords to render a
// 22-dot SVG pitch view ("战术" tab).
export interface LineupPlayer {
  id: number | null;
  number: number | null;
  name: string;
  pos: "G" | "D" | "M" | "F" | null;
  grid: string | null;                   // "row:col" — row 1=GK, 4=FWD
}

export interface LineupTeam {
  team: { id: number | null; name: string | null; logo: string | null } | null;
  formation: string | null;              // e.g. "4-3-3"
  coach: { id?: number | null; name?: string | null; photo?: string | null } | null;
  startXI: LineupPlayer[];
  substitutes: LineupPlayer[];
}

export interface MatchLineupsResp {
  ok: boolean;
  mapped: boolean;
  teams: LineupTeam[];
}

export interface H2HFixtureSummary {
  fixture_id: number | null;
  date_iso: string | null;
  league: string | null;
  venue: string | null;
  home: string | null;
  away: string | null;
  home_id: number | null;
  away_id: number | null;
  home_winner: boolean | null;
  away_winner: boolean | null;
  score_home: number | null;
  score_away: number | null;
}

export interface MatchH2HResp {
  ok: boolean;
  mapped: boolean;
  home?: { id: number | null; name: string | null };
  away?: { id: number | null; name: string | null };
  league_id?: number | null;
  season?: number | null;
  h2h: H2HFixtureSummary[];
  home_form: H2HFixtureSummary[];
  away_form: H2HFixtureSummary[];
}

export interface StandingsRow {
  rank: number | null;
  team_id: number | null;
  team_name: string | null;
  team_logo: string | null;
  played: number | null;
  win: number | null;
  draw: number | null;
  lose: number | null;
  goals_for: number | null;
  goals_against: number | null;
  goals_diff: number | null;
  points: number | null;
  form: string | null;     // "WLDLW"
  group: string | null;
}

export interface MatchStandingsResp {
  ok: boolean;
  mapped: boolean;
  league_id?: number | null;
  season?: number | null;
  league_name?: string | null;
  home_team_id?: number | null;
  away_team_id?: number | null;
  standings: StandingsRow[];
}

// ---------------------------------------------------------------------------
// Outrights / futures (the-odds-api.com proxy via /api/external/outrights).
// odds-api.io doesn't carry these for soccer, so we layer this in for the
// 冠军 page (currently the only configured sport key is the FIFA World
// Cup winner; see crown-explorer/backend/app/routers/outrights.py).
// ---------------------------------------------------------------------------

export interface OutrightOutcome {
  name: string;                                   // e.g. "Spain" (bookmaker spelling)
  price: number;                                  // best decimal odds
  bookmaker: string;                              // who has the best price
  books: Record<string, number>;                  // all bookmakers' prices
  // Set by the backend for ``soccer_fifa_world_cup_winner`` events:
  // Crown's canonical team_h_en (e.g. "Korea Republic") plus the group
  // letter (A-L) derived from foot_match fixtures.  null/missing for
  // sports that don't have group structure.
  canonical_name?: string;
  group?: string;
}

export interface OutrightGroup {
  label: string;             // "A".."L"
  teams: string[];           // canonical Crown team_h_en strings
  earliest_kickoff: number;  // unix seconds
}

export interface OutrightEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string | null;                   // ISO 8601
  bookmakers: string[];
  outcomes: OutrightOutcome[];
  outcome_count: number;
  // Group definitions (FIFA WC only).  Empty / missing for other sports.
  groups?: OutrightGroup[];
}

export interface OutrightListResp {
  items: OutrightEvent[];
  total: number;
  sport_keys: string[];
  available: boolean;
}

// NOTE 2026-05-24: The Crown sfs_match outright catalog types
// (`CrownOutrightCatalog` / `CrownOutrightMarket` / `CrownOutrightOutcome`)
// and the `listCrownOutrights()` client were removed here because the
// underlying `db_sports.sfs_match` table is a frozen dump from March 2026
// with no live upstream — surfacing those prices risked stale-odds
// arbitrage.  Backend route `/api/external/sfs/outrights` and the helper
// `mysqldb.crown_outrights()` are similarly retired (route removed,
// helper kept dormant for documentation only).  If we ever wire a live
// outright feed (e.g. extra the-odds-api.com markets), the catalog
// approach can be revived from git history (see this commit's parent).

export const oddsApi = {
  listLeagues(): Promise<OddsLeagueListResp> {
    return request("/api/external/leagues");
  },
  /** Region → country → leagues tree from `db_sports.foot_league`. */
  listLeagueCatalog(opts: { tier?: "top" | "core" | "major" | "all" } = {}): Promise<LeagueCatalogResp> {
    return request(`/api/external/leagues/catalog${qs(opts)}`);
  },
  /** Per-league counts of matches by date (UTC date key "YYYY-MM-DD"). */
  listLeaguesDailyCounts(opts: { days?: number } = {}): Promise<LeagueDailyCountsResp> {
    return request(`/api/external/leagues/daily-counts${qs(opts)}`);
  },
  /** Free-text search across slug / name_en / name_cn / country. */
  searchLeagues(q: string, limit = 30): Promise<LeagueSearchResp> {
    return request(`/api/external/leagues/search${qs({ q, limit })}`);
  },
  listOutrights(opts: { sport_keys?: string } = {}): Promise<OutrightListResp> {
    return request(`/api/external/outrights${qs(opts)}`);
  },
  listEvents(opts: {
    league?: string;
    leagues?: string;
    filter?: string;
    date?: string;
    status?: OddsEventStatus | string;
    q?: string;
    min_ts?: number;
    max_ts?: number;
    only_active?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<OddsEventListResp> {
    return request(`/api/external/events${qs(opts)}`);
  },
  getEvent(eventId: string | number): Promise<OddsEvent> {
    return request(`/api/external/events/${encodeURIComponent(String(eventId))}`);
  },
  listMarkets(eventId: string | number): Promise<OddsEventMarketsResp> {
    return request(`/api/external/events/${encodeURIComponent(String(eventId))}/markets`);
  },

  // ---- right-sidebar widgets ------------------------------------------
  getStream(eventId: string | number): Promise<MatchStreamResp> {
    return request(`/api/external/match/${encodeURIComponent(String(eventId))}/stream`);
  },
  getTracker(eventId: string | number): Promise<MatchTrackerResp> {
    return request(`/api/external/match/${encodeURIComponent(String(eventId))}/tracker`);
  },
  getStatistics(eventId: string | number): Promise<MatchStatisticsResp> {
    return request(`/api/external/match/${encodeURIComponent(String(eventId))}/statistics`);
  },
  getLineups(eventId: string | number): Promise<MatchLineupsResp> {
    return request(`/api/external/match/${encodeURIComponent(String(eventId))}/lineups`);
  },
  getMatchEvents(eventId: string | number): Promise<MatchEventsResp> {
    return request(`/api/external/match/${encodeURIComponent(String(eventId))}/events`);
  },
  getH2H(eventId: string | number, last = 10): Promise<MatchH2HResp> {
    return request(`/api/external/match/${encodeURIComponent(String(eventId))}/h2h${qs({ last })}`);
  },
  getStandings(eventId: string | number): Promise<MatchStandingsResp> {
    return request(`/api/external/match/${encodeURIComponent(String(eventId))}/standings`);
  },
};

// ===========================================================================
// Crown (db_client forensic snapshot)
// ---------------------------------------------------------------------------

export const crownApi = {
  health(): Promise<{ ok: boolean; service: string }> {
    return request("/health");
  },
  overview(): Promise<OverviewResp> {
    return request("/api/stats/overview");
  },
  listMatches(opts: {
    gtype?: string;
    league?: string;
    q?: string;
    only_open?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<MatchListResp> {
    return request(`/api/matches${qs(opts)}`);
  },
  getMatch(matchId: string | number): Promise<MatchSummary> {
    return request(`/api/matches/${encodeURIComponent(String(matchId))}`);
  },
  listMarkets(matchId: string | number): Promise<MarketsResp> {
    return request(`/api/matches/${encodeURIComponent(String(matchId))}/markets`);
  },
  listBets(opts: {
    q?: string;
    gtype?: string;
    ptype?: string;
    rtype?: string;
    only_unresolved?: boolean;
    only_inball?: boolean;
    only_cancelled?: boolean;
    only_edited?: boolean;
    limit?: number;
    offset?: number;
    reveal?: boolean;
  } = {}): Promise<BetsResp> {
    return request(`/api/bets${qs(opts)}`);
  },
};

// ---------- Crown wtype → PmPm tab classifier --------------------------------
// Crown sportsbook codes are terse; group them into tabs the H5 already
// renders. Anything unmapped falls under "other".

export type ProTabKey =
  | "hot"
  | "winner"
  | "handicap"
  | "goals"
  | "score"
  | "half"
  | "corners"
  | "cards"
  | "team"
  | "other";

export function classifyMarket(opt: MarketOption): ProTabKey {
  const w = (opt.wtype || "").toUpperCase();
  const p = (opt.ptype || "").toUpperCase();
  // Half-time markets (ptype = "N" = first half in Crown's enum).
  if (p === "N") return "half";
  // Score-based markets (RPD = correct score / parlay-direct on Crown).
  if (w === "RPD" || w.includes("PD")) return "score";
  // Over/under totals.
  if (w === "OU" || w === "ROU" || w === "R") return "goals";
  // Handicap variants.
  if (w === "HDP" || w === "RH" || w === "RM") return "handicap";
  // Win / draw / lose (Crown sometimes uses M for moneyline).
  if (w === "M" || w === "RE" || w === "WDL") return "winner";
  // Corner / cards rarely encoded; fall through to other.
  return "other";
}

// Format a Unix epoch (seconds) as a kickoff label like "今天 23:00" /
// "明天 04:00" / "MM/DD HH:mm" — kept here so any screen can use it.
export function formatKickoff(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay(d, now)) return `今天 ${hh}:${mm}`;
  if (sameDay(d, tomorrow)) return `明天 ${hh}:${mm}`;
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}/${day} ${hh}:${mm}`;
}

export function formatMoneyUSDT(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "0.00 USDT";
  return `${value.toFixed(2)} USDT`;
}

export function formatStakeShort(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M USDT`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K USDT`;
  return `${value.toFixed(0)} USDT`;
}
