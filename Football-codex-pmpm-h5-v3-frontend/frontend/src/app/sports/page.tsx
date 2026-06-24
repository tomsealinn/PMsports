"use client";

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  ApiError,
  crownApi,
  formatKickoff,
  oddsApi,
  pmppmApi,
  type BetRow,
  type H2HFixtureSummary,
  type MatchEventItem,
  type MatchH2HResp,
  type MatchStandingsResp,
  type MatchLineupsResp,
  type LineupTeam,
  type MatchStatisticsResp,
  type OddsBookmaker,
  type OddsEvent,
  type OddsMarket,
  type OddsMarketRow,
  type ApiSportsLiveEvent,
  type OutrightEvent,
  type PmppmUser,
  type StandingsRow,
} from "@/lib/api";
import {
  leagueFullName,
  leagueLogoUrl,
  leagueMeta,
  translateLeague,
  translateMarket,
  translateTeam,
} from "@/lib/i18n-teams";
import { OddsWsClient, type OddsWsMessage } from "@/lib/oddsWs";

// Map a placeBet() failure to a user-facing Chinese toast.  The backend
// (api_v2.php → /api/pmppm/place-bet) emits a small JSON envelope for
// every rejected bet — `{"detail":"market_closed","phase":"inplay",…}`
// being the most common in-play case.  Surfacing the raw envelope (or
// worse, "409 {…}") in the toast is hostile to non-developers, so we
// translate each known `detail` into a phrase the cashier desk would
// actually say.  Unknown errors fall through to a generic prompt so
// the user is never left staring at a stack trace.
function friendlyPlaceBetError(err: unknown): string {
  if (err instanceof ApiError) {
    let detail: string | null = null;
    let parsed: Record<string, unknown> | null = null;
    if (err.body) {
      try { parsed = JSON.parse(err.body) as Record<string, unknown>; } catch { /* not JSON */ }
      if (parsed && typeof parsed.detail === "string") detail = parsed.detail;
    }
    switch (detail) {
      case "market_closed":
      case "market_not_open":
        return "本滚球盘口未开放";
      case "phase_transitioned":
        return "盘口已切换至滚球，请刷新后重新下单";
      case "odds_changed": {
        const cur = parsed && (parsed.current as number | undefined);
        return typeof cur === "number"
          ? `赔率已变更（当前 ${cur}），请刷新后重试`
          : "赔率已变更，请刷新后重试";
      }
      case "insufficient_credit":
      case "balance_insufficient":
        return "信用额度不足";
      case "stake_below_min":
        return "投入金额低于最低限额";
      case "stake_above_max":
        return "投入金额超过最高限额";
    }
    if (err.status === 401 || err.status === 403) return "请先登录账户";
    if (err.status === 409)                       return "本滚球盘口未开放";
    if (err.status >= 500)                        return "服务暂时不可用，请稍后再试";
    return "下单失败，请稍后重试";
  }
  if (err instanceof Error && err.message) {
    // Network failure, parse failure, etc. — keep the original message
    // so it's still actionable in DevTools but prefix it so non-tech
    // users get a clear "下单失败" header.
    return `下单失败：${err.message}`;
  }
  return "下单失败，请稍后重试";
}

type Screen =
  | "discover"
  | "footballList"
  | "football"
  | "pro"
  | "betslip"
  | "confirm"
  | "positions"
  | "locked"
  | "create"
  | "invite"
  | "circles"
  | "orders"
  | "settle"
  | "profile"
  | "manage"
  | "agent";

type SlipMode = "single" | "parlay";
type ProTab = "hot" | "winner" | "handicap" | "goals" | "score" | "half" | "corners" | "cards" | "team";
type FootballListFilter = "all" | "live" | "today" | "soon" | "early" | "hot" | "wc" | "parlay" | "favorites" | "outrights";
// Top market-view filter tabs. Mirrors the legacy SPA's secondary nav row
// where the user picks a category to focus the row's odds columns on. We
// expanded the original 4-tab set to cover all 62 markets the upstream
// odds-api delivers per match (handicap / totals / corners / cards /
// goalscorer / etc.). The "main" tab keeps the curated multi-column
// layout; every other tab shifts the row into a category-specific
// column slot so users can scan the same market type across the league.
type MarketViewFilter =
  | "main"
  | "handicap"
  | "totals"
  | "ml"
  | "correct_score"
  | "halftime"
  | "goals"
  | "goalscorer"
  | "corners"
  | "cards"
  | "player"
  | "specials";
type SortMode = "league" | "time";
type SelectionStatus = "active" | "quote_changed" | "locked" | "conflict";
type DiscoverCategory = "all" | "football" | "crypto" | "ai" | "circle";
type Tone = "soft" | "blue" | "green" | "red" | "orange" | "purple";

// In-play (滚球) odds are sourced strictly from Odds-API.io's WebSocket
// push.  The relay daemon (deploy/pmppm-com/ws-relay/) maintains one
// upstream connection and fans out per-event filtered subscriptions to
// browsers via /api/external/ws.  Pre-match odds still come from the
// /api/external/events REST snapshot.
const ODDS_WS_ENABLED = true;
// Cap on the number of in-play event IDs we subscribe to at once.
// odds-api.io limits filters to 50 eventIds per WS connection — we
// stay below that and prioritise the earliest-listed matches so the
// user sees real-time deltas on the rows they're actually viewing.
const ODDS_WS_MAX_EVENTS = 48;
const FAVORITE_MATCHES_KEY = "crown_gold_h5_favorite_matches";

type OutcomeOption = {
  id: string;
  marketId: string;
  marketTitle: string;
  eventId: string;
  matchId?: string;
  title: string;
  label: string;
  odds: number;
  previousOdds?: number;
  line?: number;
  field: string;
  version: number;
  status?: SelectionStatus;
};

type SlipSelection = OutcomeOption & {
  selectionId: string;
  stake: number;
};

type OrderItem = {
  id: string;
  title: string;
  meta: string;
  stake: number;
  status: string;
  tag: "open" | "locked" | "settled" | "circle";
  canSell: boolean;
  // Raw upstream bet row, kept so the 详情 panel can render the full set of
  // Crown bet fields without re-fetching. Optional because not every order
  // origin (朋友局, etc.) has a corresponding bet row.
  bet?: BetRow;
};

type PositionItem = {
  id: string;
  title: string;
  outcome: string;
  stake: number;
  shares: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  canSell: boolean;
  lockedReason?: string;
};

type TrendItem = {
  id: string;
  category: Exclude<DiscoverCategory, "all">;
  tag: string;
  title: string;
  yes: number;
  pool: string;
  heat: number;
  tone: Tone;
  meta: string;
};

type CreatedPrediction = {
  question: string;
  resultType: string;
  scope: string;
  stakeCap: string;
  deadline: string;
  adjudicator: string;
  evidence: string;
};

type CircleRoom = CreatedPrediction & {
  id: string;
  pool: string;
  participants: number;
  yes: number;
  status: string;
  joined?: boolean;
};

type FootballMatch = {
  id: string;
  homeId: string;
  awayId: string;
  homeEn: string;
  awayEn: string;
  home: string;
  away: string;
  group: string;
  stage: string;
  leagueSlug?: string | null;
  leagueName?: string | null;
  kickoff: string;
  lockLabel: string;
  pool: string;
  heat: string;
  markets: number;
  status: "open" | "soon" | "locked";
  featured?: boolean;
  // Extra fields used by the pmpm.uk-styled match card. All optional so
  // the type stays usable for non-football screens that still poke at it.
  rawStatus?: string;             // upstream odds-api: pending|inplay|live|settled|cancelled
  scoreHome?: number | null;
  scoreAway?: number | null;
  scoreHomeHt?: number | null;
  scoreAwayHt?: number | null;
  commenceTs?: number | null;     // for live ticker / "X' 进行中"
  // Authoritative game state from api-sports.io (`fixture.status.elapsed` /
  // `.short`).  When present and `apisportsSeenAt` is recent, the live
  // ticker uses these; otherwise it falls back to the wall-clock heuristic.
  elapsedMinute?: number | null;
  statusShort?: string | null;
  apisportsSeenAt?: number | null;
  apisportsFixtureId?: number | null;
  // Yellow / red cards from api-sports' live `events` array.  Counted by
  // the cron, not by us — cron only writes 0 once a fixture is matched,
  // so null vs 0 distinguishes "no api-sports coverage" from "matched but
  // clean game so far".  Used by MatchListRow to show 黄/红 tally chips.
  ycHome?: number | null;
  ycAway?: number | null;
  rcHome?: number | null;
  rcAway?: number | null;
  // Corners come from a separate `/fixtures/statistics` endpoint and are
  // refreshed every 2 min.  FastAPI hides values older than 5 min, so a
  // non-null value here is always recent.  Coverage is partial (top-tier
  // leagues only); rendering code must hide the chip when null.
  cornersHome?: number | null;
  cornersAway?: number | null;
  // Live-event timeline forwarded from the backend.  Empty array (not
  // null) when the cron is healthy but the match has had no events yet,
  // null when api-sports has no fixture for this gid at all.  Rendered
  // by `<LiveEventsTimeline>` inside `<FootballScreen>`.
  liveEvents?: ApiSportsLiveEvent[] | null;
  mainOdds?: {
    reH: number; reLine: number; reC: number;
    ouOver: number; ouLine: number; ouUnder: number;
    mH: number; mN: number; mC: number;
    bttsY?: number; bttsN?: number;
    htH?: number; htN?: number; htC?: number;
    rehH?: number; rehLine?: number; rehC?: number;
    ouhOver?: number; ouhLine?: number; ouhUnder?: number;
    bttsHtY?: number; bttsHtN?: number;
    dc1x?: number; dcX2?: number; dc12?: number;
    dnbH?: number; dnbC?: number;
    cornersOver?: number; cornersLine?: number; cornersUnder?: number;
  } | null;
  extraMarkets?: { name: string; outcomes: number }[];
};

// ----------------------------------------------------------------------------
// Layout constants — Crown Gold responsive layout
// Desktop ≥1024px: 66.6% content + 33.3% bet-slip panel
// Mobile: 56px header + 58px bottom nav, bet slip slides up
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// UI metadata — describes the prototype's tabs, screen list, default form
// scaffolding etc. NOT operational data, so it stays in source.
// ----------------------------------------------------------------------------
const categoryMeta: Record<Exclude<DiscoverCategory, "all">, { label: string; tone: Tone; helper: string }> = {
  football: { label: "足球", tone: "green", helper: "odds-api.io · 英意西法德 + 欧冠欧联" },
  crypto: { label: "加密", tone: "orange", helper: "BTC、ETH、链上事件和价格区间" },
  ai: { label: "人工智能", tone: "blue", helper: "模型发布、产品上线、行业事件" },
  circle: { label: "朋友局", tone: "purple", helper: "身边问题、邀请制和 USD 小额局" },
};

const defaultCreatedPrediction: CreatedPrediction = {
  question: "",
  resultType: "是 / 否",
  scope: "仅邀请朋友可见",
  stakeCap: "20",
  deadline: "",
  adjudicator: "创建者 + 朋友投票",
  evidence: "聊天截图、定位或现场照片",
};

// Header nav = the primary sport-view tabs matching the original Crown Gold SPA
// header (滚球 → 综合过关). These map to screens or screen+filter combos.
const headerNavTabs: Array<{ filter: FootballListFilter; title: string; icon?: string }> = [
  { filter: "live",      title: "滚球",     icon: "🔴" },
  { filter: "wc",        title: "世界杯",   icon: "🏆" },
  { filter: "today",     title: "今日" },
  { filter: "soon",      title: "即将开赛" },
  { filter: "early",     title: "早盘" },
  { filter: "outrights", title: "冠军" },
  { filter: "parlay",    title: "综合过关" },
];

const marketViewTabs: Array<{ id: MarketViewFilter; label: string }> = [
  { id: "main", label: "主要玩法" },
  { id: "handicap", label: "让球" },
  { id: "totals", label: "大小" },
  { id: "ml", label: "独赢" },
  { id: "correct_score", label: "波胆" },
  { id: "halftime", label: "半场" },
  { id: "goals", label: "进球" },
  { id: "goalscorer", label: "进球者" },
  { id: "corners", label: "角球" },
  { id: "cards", label: "黄牌" },
  { id: "player", label: "球员" },
  { id: "specials", label: "特殊玩法" },
];

// Bottom nav = the 5 hubs for mobile navigation
const sidebarScreens: Array<{ id: Screen; title: string; note: string }> = [
  { id: "discover",     title: "首页", note: "赛事入口" },
  { id: "footballList", title: "下注", note: "赛事 · 盘口" },
  { id: "profile",      title: "钱包", note: "余额 / 记录" },
  { id: "manage",       title: "管理", note: "盘口 / 佣金" },
  { id: "agent",        title: "代理", note: "下级 / 佣金" },
];

const proTabs: Array<{ id: ProTab; label: string }> = [
  { id: "hot", label: "热门" },
  { id: "winner", label: "胜负" },
  { id: "handicap", label: "让球" },
  { id: "goals", label: "进球" },
  { id: "score", label: "比分" },
  { id: "half", label: "半场" },
  { id: "corners", label: "角球" },
  { id: "cards", label: "红黄牌" },
  { id: "team", label: "单队" },
];

// ----------------------------------------------------------------------------
// PmPm-specific UI surfaces (Yes/No predictions, friend circles, positions
// with secondary-market sell, on-chain wallet) currently have no backend in
// crown-explorer. They render with these empty arrays + explicit empty states
// instead of hardcoded mock entries, so the user can see exactly what is
// "live from Crown" vs what is "awaiting backend".
// ----------------------------------------------------------------------------
const initialTrendItems: TrendItem[] = [];
const initialCircleRooms: CircleRoom[] = [];
const initialPositions: PositionItem[] = [];
const initialOrders: OrderItem[] = [];

// ----------------------------------------------------------------------------
// Sub-component prop shape aliases (were formerly `typeof beginnerMarkets`
// and `typeof proGroups`; promoted to named types now that the underlying
// data is hydrated from API state).
// ----------------------------------------------------------------------------
type BeginnerMarketGroup = { title: string; explain: string; options: OutcomeOption[] };
type ProMarketGroup = { tab: ProTab; title: string; explain: string; mapping: string[]; options: OutcomeOption[] };

// ----------------------------------------------------------------------------
// odds-api.io → PmPm transforms.
// ----------------------------------------------------------------------------
//
// The football fixture list, beginner markets and pro markets are all
// powered by odds-api.io (via crown-explorer /api/external/*). Team and
// league names come from the upstream feed in English; translateTeam /
// translateLeague produce the simplified-Chinese display strings.
//
// Crown bet history is still used for the "orders" screen because that's
// the only ledger we have; see crownBetToOrder below.
// ----------------------------------------------------------------------------

// Cosmetic kickoff label for the football list ("今天 23:00" / "明天 04:00"
// / "MM/DD HH:mm"). The `commence_ts` is already epoch seconds in UTC.
function kickoffLabel(ts: number | null): string {
  if (!ts) return "待定";
  return formatKickoff(ts);
}

// Pick a human heat label out of the event status / market count, so the
// existing UI chip stays meaningful even though there's no real "热度"
// signal in the odds-api payload.
function eventHeat(ev: OddsEvent): string {
  if (ev.status === "inplay" || ev.status === "live") return "滚球";
  if (ev.market_count >= 50) return "热门";
  if (ev.market_count >= 20) return "活跃";
  return "新开";
}

// ---------------------------------------------------------------------------
// Polling reconcile helpers
//
// The /events poll fires every 15s.  Without an equality short-circuit each
// poll allocates fresh objects for every match — even ones whose data didn't
// change — invalidating every downstream useMemo and re-rendering all ~100
// match cards.  These helpers compare prev vs incoming at the field level so
// we can preserve referential equality when nothing actually moved.
//
// The fields below cover everything the list-view UI actually shows; if a
// detail-only field changes (e.g. apisports_match_iso for the H2H pane) it
// won't trigger a row re-render but the next loud refetch / detail open
// will fold it in.  This trade-off is acceptable because the list view is
// where the flicker is most visible.
// ---------------------------------------------------------------------------

// O(1) signature of a timeline's most-recent entry — used by the equality
// helper below to short-circuit re-renders when nothing actually changed.
// Returns "" for empty/null arrays so two empty timelines compare equal.
function _lastEventSig(events: ApiSportsLiveEvent[] | null | undefined): string {
  if (!events || events.length === 0) return "";
  const e = events[events.length - 1];
  return `${e.m}|${e.x ?? 0}|${e.s}|${e.t}|${e.d}|${e.p ?? ""}`;
}

function _mainOddsEqual(
  a: OddsEvent["main_odds"] | undefined,
  b: OddsEvent["main_odds"] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  // Compare every numeric column we might render in the inline price grid.
  // `undefined === undefined` is true so missing optionals match.
  return (
    a.re_h === b.re_h && a.re_line === b.re_line && a.re_c === b.re_c &&
    a.ou_over === b.ou_over && a.ou_line === b.ou_line && a.ou_under === b.ou_under &&
    a.m_h === b.m_h && a.m_n === b.m_n && a.m_c === b.m_c &&
    a.btts_yes === b.btts_yes && a.btts_no === b.btts_no &&
    a.ht_h === b.ht_h && a.ht_n === b.ht_n && a.ht_c === b.ht_c &&
    a.reh_h === b.reh_h && a.reh_line === b.reh_line && a.reh_c === b.reh_c &&
    a.ouh_over === b.ouh_over && a.ouh_line === b.ouh_line && a.ouh_under === b.ouh_under &&
    a.btts_ht_yes === b.btts_ht_yes && a.btts_ht_no === b.btts_ht_no &&
    a.dc_1x === b.dc_1x && a.dc_x2 === b.dc_x2 && a.dc_12 === b.dc_12 &&
    a.dnb_h === b.dnb_h && a.dnb_c === b.dnb_c &&
    a.corners_over === b.corners_over && a.corners_line === b.corners_line && a.corners_under === b.corners_under
  );
}

function oddsEventShallowEqual(a: OddsEvent, b: OddsEvent): boolean {
  // Cheap-first identity / id check.
  if (a === b) return true;
  if (a.id !== b.id) return false;
  return (
    a.status === b.status &&
    a.score_home === b.score_home &&
    a.score_away === b.score_away &&
    a.score_home_ht === b.score_home_ht &&
    a.score_away_ht === b.score_away_ht &&
    a.elapsed_minute === b.elapsed_minute &&
    a.status_short === b.status_short &&
    a.apisports_seen_at === b.apisports_seen_at &&
    a.yc_home === b.yc_home &&
    a.yc_away === b.yc_away &&
    a.rc_home === b.rc_home &&
    a.rc_away === b.rc_away &&
    a.corners_home === b.corners_home &&
    a.corners_away === b.corners_away &&
    // Cheap timeline equality: same length AND same most-recent entry
    // signature.  Since the cron sorts events chronologically and only
    // appends, this catches every meaningful update with O(1) work.
    (a.apisports_events?.length ?? 0) === (b.apisports_events?.length ?? 0) &&
    _lastEventSig(a.apisports_events) === _lastEventSig(b.apisports_events) &&
    a.market_count === b.market_count &&
    a.commence_ts === b.commence_ts &&
    a.league_slug === b.league_slug &&
    a.league_name === b.league_name &&
    a.home === b.home &&
    a.away === b.away &&
    _mainOddsEqual(a.main_odds, b.main_odds)
  );
}

const LIVE_WINDOW_SEC = 120 * 60;
function eventStatus(ev: OddsEvent): "open" | "soon" | "locked" {
  if (ev.status === "settled" || ev.status === "cancelled") return "locked";
  const now = Math.floor(Date.now() / 1000);
  if (ev.commence_ts && now - ev.commence_ts > LIVE_WINDOW_SEC) return "locked";
  if (ev.commence_ts && ev.commence_ts <= now && ev.status !== "inplay" && ev.status !== "live") return "locked";
  if (ev.commence_ts && ev.commence_ts - now < 30 * 60 && ev.status !== "inplay" && ev.status !== "live") return "soon";
  return "open";
}

function oddsEventToFootball(ev: OddsEvent): FootballMatch {
  const computedStatus = eventStatus(ev);
  const nowSec = Math.floor(Date.now() / 1000);
  const staleEnded =
    ev.commence_ts != null &&
    (nowSec - ev.commence_ts > LIVE_WINDOW_SEC ||
      (ev.commence_ts <= nowSec && ev.status !== "inplay" && ev.status !== "live"));
  const lockLabel =
    ev.status === "settled" || staleEnded
      ? "已完场"
      : ev.status === "cancelled"
        ? "已取消"
        : ev.status === "inplay" || ev.status === "live"
          ? "进行中"
          : "未开赛";
  return {
    id: String(ev.id),
    homeId: String(ev.home_id ?? ev.home ?? ""),
    awayId: String(ev.away_id ?? ev.away ?? ""),
    homeEn: ev.home ?? "",
    awayEn: ev.away ?? "",
    home: translateTeam(ev.home),
    away: translateTeam(ev.away),
    // Backend stamps `group: "A".."L"` on FIFA World Cup fixtures (lid=108)
    // by union-find on the foot_match graph; null/missing for everything
    // else.  Surface as empty string for non-WC so downstream group-by
    // helpers know there's nothing to group on.
    group: typeof ev.group === "string" ? ev.group : "",
    stage: translateLeague(ev.league_slug, ev.league_name),
    leagueSlug: ev.league_slug ?? null,
    leagueName: ev.league_name ?? null,
    kickoff: kickoffLabel(ev.commence_ts),
    lockLabel,
    pool: ev.market_count > 0 ? `${ev.market_count} 个盘口` : "待报价",
    heat: eventHeat(ev),
    markets: ev.market_count,
    status: computedStatus,
    featured: ev.market_count >= 50,
    rawStatus: ev.status,
    scoreHome: ev.score_home,
    scoreAway: ev.score_away,
    scoreHomeHt: ev.score_home_ht ?? null,
    scoreAwayHt: ev.score_away_ht ?? null,
    commenceTs: ev.commence_ts,
    elapsedMinute: ev.elapsed_minute ?? null,
    statusShort: ev.status_short ?? null,
    apisportsSeenAt: ev.apisports_seen_at ?? null,
    apisportsFixtureId: ev.apisports_fixture_id,
    ycHome:    ev.yc_home    ?? null,
    ycAway:    ev.yc_away    ?? null,
    rcHome:    ev.rc_home    ?? null,
    rcAway:    ev.rc_away    ?? null,
    cornersHome: ev.corners_home ?? null,
    cornersAway: ev.corners_away ?? null,
    liveEvents:  ev.apisports_events ?? null,
    mainOdds: ev.main_odds ? {
      reH: ev.main_odds.re_h, reLine: ev.main_odds.re_line, reC: ev.main_odds.re_c,
      ouOver: ev.main_odds.ou_over, ouLine: ev.main_odds.ou_line, ouUnder: ev.main_odds.ou_under,
      mH: ev.main_odds.m_h, mN: ev.main_odds.m_n, mC: ev.main_odds.m_c,
      bttsY: ev.main_odds.btts_yes, bttsN: ev.main_odds.btts_no,
      htH: ev.main_odds.ht_h, htN: ev.main_odds.ht_n, htC: ev.main_odds.ht_c,
      rehH: ev.main_odds.reh_h, rehLine: ev.main_odds.reh_line, rehC: ev.main_odds.reh_c,
      ouhOver: ev.main_odds.ouh_over, ouhLine: ev.main_odds.ouh_line, ouhUnder: ev.main_odds.ouh_under,
      bttsHtY: ev.main_odds.btts_ht_yes, bttsHtN: ev.main_odds.btts_ht_no,
      dc1x: ev.main_odds.dc_1x, dcX2: ev.main_odds.dc_x2, dc12: ev.main_odds.dc_12,
      dnbH: ev.main_odds.dnb_h, dnbC: ev.main_odds.dnb_c,
      cornersOver: ev.main_odds.corners_over, cornersLine: ev.main_odds.corners_line, cornersUnder: ev.main_odds.corners_under,
    } : null,
    extraMarkets: ev.extra_markets ?? [],
  };
}

function demoOddsEvents(nowSec = Math.floor(Date.now() / 1000)): OddsEvent[] {
  const fetchedAt = nowSec;
  const makeEvent = (
    id: number,
    leagueSlug: string,
    leagueName: string,
    home: string,
    away: string,
    offsetSec: number,
    status: "inplay" | "pending",
    scoreHome: number | null,
    scoreAway: number | null,
    marketCount: number,
    oddsShift = 0,
    group: string | null = null,
  ): OddsEvent => {
    const commenceTs = nowSec + offsetSec;
    return {
      id,
      sport_slug: "football",
      league_slug: leagueSlug,
      league_name: leagueName,
      home,
      away,
      home_id: `${id}-home`,
      away_id: `${id}-away`,
      commence_iso: new Date(commenceTs * 1000).toISOString(),
      commence_ts: commenceTs,
      status,
      score_home: scoreHome,
      score_away: scoreAway,
      score_home_ht: status === "inplay" ? 0 : null,
      score_away_ht: status === "inplay" ? 0 : null,
      is_finished: false,
      elapsed_minute: status === "inplay" ? 32 + (id % 20) : null,
      status_short: status === "inplay" ? "1H" : "NS",
      apisports_seen_at: status === "inplay" ? nowSec : null,
      yc_home: status === "inplay" ? id % 3 : null,
      yc_away: status === "inplay" ? (id + 1) % 3 : null,
      rc_home: 0,
      rc_away: 0,
      corners_home: status === "inplay" ? 2 + (id % 4) : null,
      corners_away: status === "inplay" ? 1 + (id % 3) : null,
      apisports_events: status === "inplay" ? [{ m: 18, s: "h", t: "Goal", d: "Normal Goal", p: home }] : null,
      group,
      fetched_at: fetchedAt,
      market_count: marketCount,
      apisports_fixture_id: null,
      apisports_match_iso: null,
      main_odds: {
        re_h: Number((1.86 + oddsShift).toFixed(2)),
        re_line: -0.5,
        re_c: Number((2.02 - oddsShift).toFixed(2)),
        ou_over: Number((1.92 + oddsShift).toFixed(2)),
        ou_line: 2.5,
        ou_under: Number((1.9 - oddsShift).toFixed(2)),
        m_h: Number((2.16 + oddsShift).toFixed(2)),
        m_n: Number((3.25 - oddsShift).toFixed(2)),
        m_c: Number((2.74 - oddsShift).toFixed(2)),
        btts_yes: Number((1.78 + oddsShift).toFixed(2)),
        btts_no: Number((1.98 - oddsShift).toFixed(2)),
        ht_h: Number((2.72 + oddsShift).toFixed(2)),
        ht_n: 2.05,
        ht_c: Number((3.2 - oddsShift).toFixed(2)),
        reh_h: Number((1.9 + oddsShift).toFixed(2)),
        reh_line: -0.25,
        reh_c: Number((1.96 - oddsShift).toFixed(2)),
        ouh_over: 1.84,
        ouh_line: 1.0,
        ouh_under: 2.02,
        btts_ht_yes: 2.42,
        btts_ht_no: 1.48,
        dc_1x: 1.36,
        dc_x2: 1.62,
        dc_12: 1.28,
        dnb_h: 1.64,
        dnb_c: 2.18,
        corners_over: 1.88,
        corners_line: 8.5,
        corners_under: 1.92,
      },
      extra_markets: [
        { name: "Correct Score", outcomes: 18 },
        { name: "Half Time", outcomes: 3 },
        { name: "Corners", outcomes: 6 },
      ],
    };
  };

  return [
    makeEvent(900001, "fifa-world-cup", "FIFA World Cup", "Argentina", "France", -18 * 60, "inplay", 1, 0, 64, 0.02, "A"),
    makeEvent(900002, "england-premier-league", "England Premier League", "Manchester City", "Liverpool", 35 * 60, "pending", null, null, 58, -0.01),
    makeEvent(900003, "spain-la-liga", "Spain La Liga", "Barcelona", "Real Madrid", 3 * 60 * 60, "pending", null, null, 52, 0.01),
    makeEvent(900004, "italy-serie-a", "Italy Serie A", "Inter", "Juventus", 28 * 60 * 60, "pending", null, null, 46, 0),
  ];
}

// ---- Market expansion ------------------------------------------------------
//
// Each row of `OddsMarket.odds` is a record with shape varying by market
// type. We turn it into a flat list of OutcomeOptions ready for the UI.
//
//   ML                 → {home, draw, away}             3 outcomes
//   Spread             → {hdp, home, away}              2 outcomes + line
//   Totals             → {hdp, over, under}             2 outcomes + line
//   Draw No Bet        → {home, away}                   2 outcomes
//   Double Chance      → {label, under}      × N rows   each row one outcome
//   Correct Score      → {label?, score?, odds?, ...}   per-row outcome
//
// Anything we don't recognise still gets best-effort numeric-field
// extraction so no market is silently dropped.

// Render-friendly label for a price field within a row.
function outcomeLabel(
  field: string,
  row: OddsMarketRow,
  ev: OddsEvent,
  hdp: number | null,
): string {
  const home = translateTeam(ev.home) || "主队";
  const away = translateTeam(ev.away) || "客队";
  // 当某行带 label（半场胜负 / 比分 / 角球区间 / 取胜方式 等），
  // 优先用翻译后的 label，避免出现 "Draw"、"Over 3 goals" 等英文。
  const rowLabel = typeof row.label === "string" && row.label.trim().length > 0 ? row.label : null;
  if (rowLabel && field !== "home" && field !== "away" && field !== "draw" && field !== "yes" && field !== "no") {
    return translateDescribedOutcome(rowLabel, ev, home, away);
  }
  switch (field) {
    case "home":  return hdp == null ? home : `${home} ${formatHdp(hdp, "home")}`;
    case "away":  return hdp == null ? away : `${away} ${formatHdp(hdp, "away")}`;
    case "draw":  return "平局";
    case "over":  return hdp == null ? "大" : `大 ${hdp}`;
    case "under": return hdp == null ? "小" : `小 ${hdp}`;
    case "yes":   return "是";
    case "no":    return "否";
    default:      return field;
  }
}

function formatHdp(hdp: number, side: "home" | "away"): string {
  if (hdp === 0) return "PK";
  const value = side === "home" ? hdp : -hdp;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 把 odds-api 返回的英文 label 尽量翻成中文。覆盖：
//   - "Draw" / "1" / "2"                       (半场胜负、取胜方式)
//   - "Over N goals" / "Under N goals"         (进球区间)
//   - "N Goals" / "N+ Goals"                   (精确总进球)
//   - "Under N" / "Over N" / "N - M"           (角球区间)
//   - "<队名> or Draw"                         (双重机会)
//   - "<比分>" 形如 "1-0"                      (比分)
//   - "90 Mins (1)" / "90 Mins (2)"           (取胜方式)
// 没匹配上的 label 原样返回，至少不会丢信息。
function translateDescribedOutcome(label: string, ev: OddsEvent, home: string, away: string): string {
  let s = label.trim();
  // 球队全名替换（区分大小写 i 标志）。
  // odds-api.io 的 `ev.home/ev.away` 常带 "FC/CF/SC/AC" 后缀（如 "Qingdao Hainiu FC"），
  // 但 market label 里的队名经常省略后缀（如 "Qingdao Hainiu or Chongqing Tonglianglong"），
  // 直接用 ev.home 做正则会匹配不上，导致中英文混排。这里同时尝试 (a) 完整名，
  // (b) 去掉 FC/CF/SC/AC 等尾缀的短名 —— 两个都会被替换为已翻译的中文短名。
  const trimSuffix = (n: string) => n
    .replace(/\s+\b(FC|CF|SC|AC|FK|CD|SK|SV)\s*$/i, '')
    .replace(/\s+\b(United|City)\s*$/i, (m) => m) // keep these (they're part of the name)
    .trim();
  if (ev.home) {
    s = s.replace(new RegExp(escapeRegExp(ev.home), "gi"), home);
    const homeShort = trimSuffix(ev.home);
    if (homeShort && homeShort !== ev.home) {
      s = s.replace(new RegExp(escapeRegExp(homeShort), "gi"), home);
    }
  }
  if (ev.away) {
    s = s.replace(new RegExp(escapeRegExp(ev.away), "gi"), away);
    const awayShort = trimSuffix(ev.away);
    if (awayShort && awayShort !== ev.away) {
      s = s.replace(new RegExp(escapeRegExp(awayShort), "gi"), away);
    }
  }
  // 90 Mins (1)/(2) → 90 分钟 主队 / 客队
  s = s.replace(/\b90\s*Mins?\s*\(\s*1\s*\)/gi, `90 分钟 ${home}`);
  s = s.replace(/\b90\s*Mins?\s*\(\s*2\s*\)/gi, `90 分钟 ${away}`);
  s = s.replace(/\bMins?\b/gi, "分钟");
  // 单字符 1/2 表队，作为整段（HT Result）或 N - M 比分另行处理
  if (/^\s*1\s*$/.test(s)) return home;
  if (/^\s*2\s*$/.test(s)) return away;
  s = s.replace(/\bDraw\b/gi, "平");
  s = s.replace(/\bor\b/gi, "或");
  // "Over 3 goals" / "Over 6"
  s = s.replace(/\bOver\s+(\d+(?:\.\d+)?)(\s*goals?)?/gi, (_m, n: string, g?: string) => g ? `${n} 球以上` : `${n} 以上`);
  s = s.replace(/\bUnder\s+(\d+(?:\.\d+)?)(\s*goals?)?/gi, (_m, n: string, g?: string) => g ? `${n} 球以下` : `${n} 以下`);
  // "2 or 3 goals" → "2 或 3 球"
  s = s.replace(/\b(\d+)\+?\s*Goals?\b/gi, (_m, n: string) => `${n} 球`);
  // 角球区间 "9 - 11" 保持原样（数字可读）
  // 头球 / 禁区外 等进球方式
  s = s.replace(/\(Header\)/gi, "（头球）");
  s = s.replace(/\(Outside the Box\)/gi, "（禁区外）");
  s = s.replace(/\(Inside the Box\)/gi, "（禁区内）");
  s = s.replace(/\(Penalty\)/gi, "（点球）");
  s = s.replace(/\(Free Kick\)/gi, "（任意球）");
  // 末尾 "(1)" / "(2)" 表第几个 — 角标用括号呈现
  s = s.replace(/\((\d+)\)\s*$/g, " ($1)");
  return s;
}

function expandRow(
  market: OddsMarket,
  row: OddsMarketRow,
  rowIdx: number,
  ev: OddsEvent,
): OutcomeOption[] {
  const hdp = typeof row.hdp === "number" ? row.hdp
             : typeof row.hdp === "string" ? Number(row.hdp)
             : null;
  const opts: OutcomeOption[] = [];
  for (const [field, raw] of Object.entries(row)) {
    if (field === "hdp" || field === "label") continue;
    if (raw == null) continue;
    const price = Number(raw);
    if (!Number.isFinite(price) || price <= 0) continue;
    opts.push({
      // Outcome id needs to be globally unique within a slip. Combining
      // event id + 6-digit market id + row idx + field gives stability.
      id: `${ev.id}-${market.market_id}-${rowIdx}-${field}`,
      marketId: `${ev.id}-${market.market_id}-${rowIdx}`,
      marketTitle: translateMarket(market.market_name),
      eventId: String(ev.id),
      matchId: String(ev.id),
      title: `${translateTeam(ev.home)} vs ${translateTeam(ev.away)}`,
      label: outcomeLabel(field, row, ev, hdp == null || Number.isNaN(hdp) ? null : hdp),
      odds: price,
      line: hdp == null || Number.isNaN(hdp) ? undefined : hdp,
      field,
      version: market.updated_at_ts ?? 1,
    });
  }
  return opts;
}

function expandMarket(market: OddsMarket, ev: OddsEvent): OutcomeOption[] {
  const out: OutcomeOption[] = [];
  market.odds.forEach((row, i) => out.push(...expandRow(market, row, i, ev)));
  return out;
}

// Apply a `updated` / `created` WS payload onto the current bookmakers
// state. Patches existing markets in place (preserving their market_id so
// outcome ids stay stable in the bet slip), appends new ones, and bumps
// `updated_at_ts` so the UI's "刚刚更新" indicator can react.
//
// We never *create* a bookmaker entry that didn't exist in the initial
// REST snapshot — a brand-new bookmaker would need full context (market
// catalogue, etc.) which the WS frame doesn't carry. In practice the
// bookmaker filter is fixed to Bet365 by the ingest config so this
// branch wouldn't fire anyway.
function mergeOddsUpdate(
  prev: OddsBookmaker[],
  msg: { bookie: string; markets: Array<{ name: string; updatedAt?: string | null; odds: OddsMarketRow[] }> },
): OddsBookmaker[] {
  if (!msg.bookie || !Array.isArray(msg.markets) || msg.markets.length === 0) {
    return prev;
  }
  const idx = prev.findIndex((b) => b.bookmaker === msg.bookie);
  if (idx < 0) {
    // Bookmaker not in the snapshot — ignore. The next REST refresh will
    // pick it up if it ever becomes relevant.
    return prev;
  }
  const target = prev[idx];
  const byName = new Map(target.markets.map((m) => [m.market_name, m] as const));
  let changed = false;
  for (const incoming of msg.markets) {
    if (!incoming || !incoming.name) continue;
    const updated_at_ts = incoming.updatedAt ? Math.floor(Date.parse(incoming.updatedAt) / 1000) : Math.floor(Date.now() / 1000);
    const existing = byName.get(incoming.name);
    if (existing) {
      byName.set(incoming.name, {
        ...existing,
        odds: incoming.odds,
        updated_at_iso: incoming.updatedAt ?? existing.updated_at_iso,
        updated_at_ts,
      });
      changed = true;
    } else {
      // New market for this bookmaker — synthesize a placeholder
      // market_id (-rowIdx, sorts after real ones) until the next REST
      // refresh assigns the persistent AUTOINCREMENT id.
      const tmp = -(byName.size + 1);
      byName.set(incoming.name, {
        market_id: String(tmp),
        market_id_int: tmp,
        market_name: incoming.name,
        odds: incoming.odds,
        updated_at_iso: incoming.updatedAt ?? null,
        updated_at_ts,
      });
      changed = true;
    }
  }
  if (!changed) return prev;
  const next = prev.slice();
  next[idx] = { ...target, markets: Array.from(byName.values()), market_count: byName.size };
  return next;
}

// ---------------------------------------------------------------------------
// Project an Odds-API.io WS `updated`/`created` message into the
// OddsEvent.main_odds shape used by the list view.  Mirrors
// `extractMainOddsFromWsCache()` in api_v2.php — keep both in sync.
//
// Returns a partial main_odds object that should be MERGED on top of
// the previous main_odds (since each WS message may carry only the
// changed markets).  Pass the previous main_odds as `prev` so we don't
// blank out unchanged columns.
type MainOddsShape = NonNullable<OddsEvent["main_odds"]>;

function projectMainOddsFromWs(
  prev: MainOddsShape | null | undefined,
  msg: { markets?: Array<{ name: string; odds?: Array<Record<string, unknown>> }> },
): MainOddsShape | null {
  const markets = Array.isArray(msg.markets) ? msg.markets : [];
  if (markets.length === 0) return prev ?? null;

  const num = (v: unknown): number => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
    return 0;
  };

  const byName = new Map<string, Array<Record<string, unknown>>>();
  for (const m of markets) {
    if (!m || !m.name) continue;
    byName.set(m.name, Array.isArray(m.odds) ? m.odds : []);
  }
  const first = (name: string): Record<string, unknown> => {
    const rows = byName.get(name);
    return rows && rows[0] && typeof rows[0] === "object" ? rows[0] : {};
  };

  // Seed with previous (or zero-filled) so unchanged columns survive.
  const out: MainOddsShape = prev
    ? { ...prev }
    : {
        re_h: 0, re_line: 0, re_c: 0,
        ou_over: 0, ou_line: 0, ou_under: 0,
        m_h: 0, m_n: 0, m_c: 0,
      };

  if (byName.has("ML")) {
    const r = first("ML");
    out.m_h = num(r.home);
    out.m_n = num(r.draw);
    out.m_c = num(r.away);
  }
  if (byName.has("Spread")) {
    const r = first("Spread");
    out.re_h = num(r.home);
    out.re_c = num(r.away);
    out.re_line = num(r.hdp);
  }
  if (byName.has("Totals")) {
    const r = first("Totals");
    out.ou_over = num(r.over);
    out.ou_under = num(r.under);
    out.ou_line = num(r.hdp);
  }
  if (byName.has("Draw No Bet")) {
    const r = first("Draw No Bet");
    out.dnb_h = num(r.home);
    out.dnb_c = num(r.away);
  }
  if (byName.has("Both Teams To Score") || byName.has("Both Teams to Score")) {
    const r = first(byName.has("Both Teams To Score") ? "Both Teams To Score" : "Both Teams to Score");
    out.btts_yes = num(r.yes);
    out.btts_no = num(r.no);
  }
  if (byName.has("Half Time Result")) {
    const rows = byName.get("Half Time Result") ?? [];
    if (rows.length >= 3) {
      out.ht_h = num(rows[0]?.under ?? rows[0]?.home);
      out.ht_n = num(rows[1]?.under ?? rows[1]?.draw);
      out.ht_c = num(rows[2]?.under ?? rows[2]?.away);
    }
  }
  if (byName.has("Spread HT")) {
    const r = first("Spread HT");
    out.reh_h = num(r.home);
    out.reh_c = num(r.away);
    out.reh_line = num(r.hdp);
  }
  if (byName.has("Totals HT")) {
    const r = first("Totals HT");
    out.ouh_over = num(r.over);
    out.ouh_under = num(r.under);
    out.ouh_line = num(r.hdp);
  }
  if (byName.has("Both Teams To Score HT")) {
    const r = first("Both Teams To Score HT");
    out.btts_ht_yes = num(r.yes);
    out.btts_ht_no = num(r.no);
  }
  if (byName.has("Double Chance")) {
    const rows = byName.get("Double Chance") ?? [];
    if (rows.length >= 3) {
      // Positional fallback matches Odds-API.io's common emission order:
      // [Home or Draw, Home or Away, Draw or Away].
      let dc1x = 0, dc12 = 0, dcx2 = 0;
      for (const r of rows) {
        const label = String(r?.label ?? "").toLowerCase();
        const price = num(r?.under);
        const hasDraw = label.indexOf("draw") !== -1;
        if (!hasDraw) dc12 = price;
        else if (label.indexOf("draw") < 4) dcx2 = price;
        else dc1x = price;
      }
      if (dc1x <= 0 && dcx2 <= 0) {
        dc1x = num(rows[0]?.under);
        dc12 = num(rows[1]?.under);
        dcx2 = num(rows[2]?.under);
      }
      out.dc_1x = dc1x;
      out.dc_x2 = dcx2;
      out.dc_12 = dc12;
    }
  }
  if (byName.has("Corners Totals")) {
    const r = first("Corners Totals");
    out.corners_over = num(r.over);
    out.corners_under = num(r.under);
    out.corners_line = num(r.hdp);
  }

  // If we somehow have no useful main markets at all, return null so
  // the list cell renders empty (matches the WS-only invariant).
  if (out.m_h <= 0 && out.re_h <= 0 && out.ou_over <= 0) return null;
  return out;
}

// 新手模式的"问答式"盘口配置：把 odds-api 的英文盘口名映射成中文问句，
// 每个问题给出候选盘口（按优先级），命中第一个就用，没有就跳过。
//
// `targetLine` 用于将 over/under/让球 等多档行按"距离常用赔付线"远近排序，
// 把最贴近常用线的行排在最前。例如 Totals 取 2.5、角球取 9.5、牌取 4.5。
const BEGINNER_QUESTIONS: Array<{
  question: string;
  intro: string;
  candidates: string[];
  targetLine?: number;
}> = [
  {
    question: "谁会赢？",
    intro: "选主队、客队或平局，全场 90 分钟常规时间结算。",
    candidates: ["ML"],
  },
  {
    question: "进球多不多？",
    intro: "看两队全场总进球数和盘口比，二选一押大或押小。",
    candidates: ["Totals", "Goals Over/Under", "Alternative Total Goals", "Alternative Goal Line"],
    targetLine: 2.5,
  },
  {
    question: "双方都会进球吗？",
    intro: "只看主客两队是否都进球，是 / 否两选项。",
    candidates: ["Both Teams To Score", "Both Teams to Score"],
  },
  {
    question: "角球多不多？",
    intro: "全场角球数大小，可选大 / 小或区间档位。",
    candidates: ["Corners Totals", "Corners", "Total Corners", "Alternative Corners"],
    targetLine: 9.5,
  },
  {
    question: "上半场谁会赢？",
    intro: "只看上半场 45 分钟的比赛结果，主 / 客 / 平三选一。",
    candidates: ["Half Time Result"],
  },
  {
    question: "上半场进球多不多？",
    intro: "上半场两队总进球数和盘口比，押大或押小。",
    candidates: ["Totals HT", "First Half Totals", "1st Half Goal Line"],
    targetLine: 1.25,
  },
  {
    question: "主队能进几个？",
    intro: "猜主队全场进球数，覆盖 0.5 - 4.5 多档大小。",
    candidates: ["Team Total Goals Home"],
    targetLine: 1.5,
  },
  {
    question: "客队能进几个？",
    intro: "猜客队全场进球数，覆盖 0.5 - 4.5 多档大小。",
    candidates: ["Team Total Goals Away"],
    targetLine: 1.5,
  },
  {
    question: "牌会多吗？",
    intro: "全场红黄牌总数大小，盘口一般在 3.5 - 5.5 张。",
    candidates: ["Number of Cards In Match", "Cards Totals"],
    targetLine: 4.5,
  },
  {
    question: "罚牌积分多不多？",
    intro: "按罚牌积分计算（黄=10、红=25），看总积分大或小。",
    candidates: ["Bookings Totals"],
    targetLine: 4.5,
  },
  {
    question: "总进球数猜一猜",
    intro: "精确猜全场总进球数，命中赔率高。",
    candidates: ["Exact Total Goals", "Number of Goals In Match"],
  },
  {
    question: "比分猜一猜",
    intro: "猜全场最终比分，命中赔率最高，可点击展开全部。",
    candidates: ["Correct Score"],
  },
  {
    question: "让球后谁会赢？",
    intro: "经亚洲 / 欧洲让球修正后再决出胜负，盘口越接近 0 越平衡。",
    candidates: ["Spread", "European Handicap", "Alternative Asian Handicap"],
    targetLine: 0,
  },
];

function firstBookmaker(bookmakers: OddsBookmaker[]): OddsBookmaker | null {
  return bookmakers[0] ?? null;
}

// 默认按"距离常用线"远近排序行；无 targetLine 时按原顺序。
function rowSortIndex(market: OddsMarket, targetLine: number | undefined): Map<number, number> {
  const idxMap = new Map<number, number>();
  if (targetLine === undefined) {
    market.odds.forEach((_, i) => idxMap.set(i, i));
    return idxMap;
  }
  const ranked = market.odds
    .map((row, i) => {
      const hdp = typeof row.hdp === "number" ? row.hdp
                : typeof row.hdp === "string" ? Number(row.hdp)
                : NaN;
      const dist = Number.isFinite(hdp) ? Math.abs(hdp - targetLine) : Number.POSITIVE_INFINITY;
      return { i, dist };
    })
    .sort((a, b) => a.dist - b.dist || a.i - b.i);
  ranked.forEach((entry, order) => idxMap.set(entry.i, order));
  return idxMap;
}

// 按 targetLine 排序后展开 outcomes（同一行的 home/draw/away/over/under 顺序保持，
// 行之间按距 targetLine 由近到远）。
function expandMarketRanked(market: OddsMarket, ev: OddsEvent, targetLine?: number): OutcomeOption[] {
  const order = rowSortIndex(market, targetLine);
  const opts: OutcomeOption[] = [];
  const rowsByOrder = market.odds
    .map((row, i) => ({ row, i }))
    .sort((a, b) => (order.get(a.i) ?? 0) - (order.get(b.i) ?? 0));
  for (const { row, i } of rowsByOrder) {
    opts.push(...expandRow(market, row, i, ev));
  }
  return opts;
}

function buildBeginnerMarkets(
  bookmakers: OddsBookmaker[],
  ev: OddsEvent | null,
): BeginnerMarketGroup[] {
  if (!ev) return [];
  const book = firstBookmaker(bookmakers);
  if (!book) return [];
  const byName = new Map(book.markets.map((m) => [m.market_name, m] as const));
  const groups: BeginnerMarketGroup[] = [];
  for (const q of BEGINNER_QUESTIONS) {
    let picked: OddsMarket | null = null;
    for (const name of q.candidates) {
      const m = byName.get(name);
      if (m) { picked = m; break; }
    }
    if (!picked) continue;
    const options = expandMarketRanked(picked, ev, q.targetLine);
    if (options.length === 0) continue;
    groups.push({
      title: q.question,
      explain: q.intro,
      options,
    });
  }
  return groups;
}

// ---- Pro mode categoriser --------------------------------------------------

// Order-of-checks matters: a market_name like "Corners Totals" or
// "Corners Spread" must be caught by the corner rule *before* the
// generic "total" / "spread" rules — otherwise it leaks into the
// 进球 (goals) or 让球 (handicap) tabs. To make this regression
// impossible, the corner / card / half-time keywords are checked
// in their own pass and short-circuit before anything else.
function classifyOddsMarket(name: string): ProTab {
  const n = name.toLowerCase();

  // Body-part group: ANY mention of corners/cards/bookings wins
  // outright — these are physical-event markets and never belong to
  // the "进球" or "比分" tabs.
  if (n.includes("corner")) return "corners";
  if (n.includes("booking") || n.includes("card") || n.includes("booked")) return "cards";

  // Half-time / second-half / early-minute markets — anything that
  // contains a half-time qualifier should land under 半场, regardless
  // of whether it's also a totals or handicap row.
  if (
    n.includes("ht") ||
    n.includes("half") ||
    n.includes("first half") ||
    n.includes("2h") ||
    n.includes("second half") ||
    n.startsWith("1st half") ||
    n.includes("minutes")
  ) return "half";

  // Correct-score / goal-method / exact-total — narrow definition of
  // 比分 so it does not eat any generic "*totals" market.
  if (
    n.includes("correct score") ||
    n.includes("goal method") ||
    n.includes("exact total")
  ) return "score";

  if (
    n.includes("goalscorer") ||
    n.includes("team total") ||
    n.includes("both teams") ||
    n.includes("clean sheet") ||
    n.includes("multi scorers") ||
    n.includes("team shots") ||
    n.includes("team corners") ||
    n.includes("team cards") ||
    n.includes("team tackles") ||
    n.includes("team offsides") ||
    n.includes("goalkeeper") ||
    n.startsWith("player ") ||
    n.includes("score or assist")
  ) return "team";

  if (n.includes("handicap") || n.includes("spread")) return "handicap";
  if (
    n.includes("total") ||
    n.includes("over/under") ||
    n.includes("goal line") ||
    n.includes("goals over") ||
    n.startsWith("match shots") ||
    n.startsWith("match tackles") ||
    n.startsWith("match offsides") ||
    n.includes("number of goals")
  ) return "goals";

  if (
    n.includes("draw no bet") ||
    n.includes("double chance") ||
    n.startsWith("ml") ||
    n === "ml"
  ) return "winner";

  return "hot";
}

function buildProGroups(
  bookmakers: OddsBookmaker[],
  ev: OddsEvent | null,
  activeTab: ProTab,
): ProMarketGroup[] {
  if (!ev) return [];
  const book = firstBookmaker(bookmakers);
  if (!book) return [];
  const filtered = book.markets.filter((m) => activeTab === "hot" ? true : classifyOddsMarket(m.market_name) === activeTab);
  if (filtered.length === 0) return [];
  return filtered.map((m) => ({
    tab: activeTab,
    title: `${translateMarket(m.market_name)}`,
    explain: translateMarket(m.market_name),
    mapping: ["盘口编号", "玩法", "赔率"],
    options: expandMarket(m, ev),
  }));
}

// Map Crown bet `wtype` codes → Simplified Chinese display labels.
// Codes are produced by api_v2.php → parseSettlementHints(); see api_v2.php
// for the full list. Anything we don't recognise falls back to the raw code.
const WTYPE_CN: Record<string, string> = {
  ML: "独赢",
  HT_ML: "半场独赢",
  "1X2": "独赢",
  DNB: "和局退款",
  DC: "双重机会",
  SP: "让球",
  HT_SP: "半场让球",
  OU: "大小球",
  HT_OU: "半场大小",
  OE: "单双",
  BTS: "双方进球",
  HT_BTS: "半场双方进球",
  CS: "正确比分",
  PARLAY: "串关",
};

function translateWtype(bet: BetRow): string {
  const code = (bet.wtype || "").toUpperCase();
  if (code && WTYPE_CN[code]) return WTYPE_CN[code];
  // Fall back to the server-provided label if it looks like Chinese (server
  // currently echoes wtype as wtype_label, but a future migration may map
  // it). Otherwise return whatever code we have.
  return bet.wtype_label || code || "";
}

// Build a Chinese outcome-direction label for a Crown bet row, e.g.:
//   "卡塔尔" (outright winner)
//   "主胜" / "客胜" (1X2 / handicap, derived from chose_team H|C)
//   "大 2.5" / "小 2.5" (over/under, parsed from betstr)
//   "Match A 主胜 / Match B 客胜" (parlay legs, condensed from betstr)
// Falls back to the raw betstr if we can't infer a structured label so the
// information never disappears entirely.
function describeBetOutcome(bet: BetRow): string {
  const wtype = (bet.wtype || "").toUpperCase();
  const betstr = (bet.betstr || "").trim();
  const teamHZh = translateTeam(bet.team_h || "") || bet.team_h || "";
  const teamCZh = translateTeam(bet.team_c || "") || bet.team_c || "";

  // Parlay: betstr is "Title｜Market｜Outcome / Title｜Market｜Outcome / ..."
  // (see submitOrder's parlay payload).  Render as "<n> 串 1 · A 主胜 / B 客胜".
  if (wtype === "PARLAY") {
    if (!betstr) return "串关";
    const legs = betstr.split(/\s*\/\s*/).filter(Boolean);
    const condensed = legs
      .map((leg) => {
        const parts = leg.split("｜").map((s) => s.trim()).filter(Boolean);
        // Prefer "<title> <outcome>" — drop the middle "marketTitle" segment.
        if (parts.length >= 3) return `${parts[0]} ${parts[parts.length - 1]}`;
        return parts.join(" ");
      })
      .join(" / ");
    return condensed || betstr;
  }

  // 1X2 / 独赢 / 让球: chose_team gives the side directly.
  const chose = (bet.chose_team || "").toUpperCase();
  if (chose === "H" && teamHZh) return teamHZh;
  if (chose === "C" && teamCZh) return teamCZh;
  if (chose === "D" || chose === "X") return "和局";

  // Outright (SP=冠军 in Crown's gtype map): betstr is the picked team name.
  // Translate vendor English → Chinese where the i18n map covers it.
  if (betstr) {
    const translated = translateTeam(betstr);
    return translated || betstr;
  }
  return "";
}

function crownBetToOrder(bet: BetRow): OrderItem {
  const stake = parseFloat(bet.bet_golds || "0") || 0;
  const memResult = parseFloat(bet.mem_result || "0") || 0;
  const teamH = translateTeam(bet.team_h || "") || bet.team_h || "";
  const teamC = translateTeam(bet.team_c || "") || bet.team_c || "";
  const wtypeLabel = translateWtype(bet);
  const spreadPart = bet.spread ? ` ${bet.spread}` : "";
  const odds = bet.ioratio ?? "?";
  const resolved = (bet.isResult ?? 0) === 1;
  const resultText = resolved
    ? `结算 ${memResult >= 0 ? "+" : ""}${memResult.toFixed(2)} ${curName('USDT')}`
    : "未结算";
  const tag: OrderItem["tag"] = resolved ? "settled" : "locked";
  const status = resolved
    ? `已结算 · ${bet.result ?? ""}`
    : (bet.cancel ?? 0) === 1
      ? "已取消"
      : "已锁单 · 等待结算";
  // Title composition:
  //   <event head> · <market type><spread> · <outcome direction>
  // - Event head: "<H> vs <C>" for match bets, league/league_label for
  //   outright bets where team_h/team_c are empty.
  // - Market type: 独赢 / 让球 / 大小 / 串关 / etc. (translated wtype).
  // - Outcome direction: derived from chose_team + betstr — this is the
  //   piece the previous version was missing, so users couldn't tell
  //   which side they had actually picked.
  const outcome = describeBetOutcome(bet);
  const isOutright = !teamH && !teamC;
  const head = isOutright
    ? (translateLeague(bet.league || "") || bet.league || "冠军盘")
    : `${teamH || "主队待公布"} vs ${teamC || "对手待公布"}`;
  const marketSegment = wtypeLabel ? ` · ${wtypeLabel}${spreadPart}` : "";
  const outcomeSegment = outcome ? ` · ${outcome}` : "";
  return {
    id: `bet-${bet.ID}`,
    title: `${head}${marketSegment}${outcomeSegment}`,
    meta: `投入 ${stake.toFixed(2)} ${curName('USDT')} · 赔率 ${odds} · ${resultText}`,
    stake,
    status,
    tag,
    canSell: false,
    bet,
  };
}

// ----------------------------------------------------------------------------
// Shared utilities used by both the page and its sub-components.
// ----------------------------------------------------------------------------
function matchTitle(match: FootballMatch) {
  return `${match.home} vs ${match.away}`;
}

function matchIdentity(match: FootballMatch): string {
  return `${match.id}|${match.homeId}|${match.awayId}`;
}

function cx(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

function money(value: number) {
  if (!Number.isFinite(value)) return "0.00 USD";
  return `${value.toFixed(2)} USD`;
}
function curName(c: string): string {
  if (c === 'USDT' || c === 'USD') return 'USD（U币）';
  return c;
}
function curSymbol(c: string): string {
  if (c === 'USDT' || c === 'USD') return '$';
  if (c === 'RMB' || c === 'CNY') return '¥';
  return c;
}

function numeric(value: string) {
  const next = Number(value);
  return Number.isFinite(next) ? Math.max(0, next) : 0;
}

function formatCreditAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Global back-navigation handler. The main SportsPage Provider wires this to
// goBack(); any AppHeader that doesn't override `back` automatically renders
// a working "返回" button.
const GoBackContext = createContext<(() => void) | null>(null);

export default function SportsPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [screen, setScreen] = useState<Screen>("discover");
  // Screen navigation history. Used by goBack() so every screen can render a
  // generic "返回" button that pops to whichever screen the user came from.
  const [screenStack, setScreenStack] = useState<Screen[]>(["discover"]);
  const [selectedMatchId, setSelectedMatchId] = useState<string>("");
  const [footballFilter, setFootballFilter] = useState<FootballListFilter>("all");
  // Discover screen sub-tab: the original SPA splits 早盘 into 赛事 (events)
  // and 冠军 (outrights), with 梦幻赛 as a tertiary tab. We lift this state to
  // the page so the top-level header tabs can switch it directly.
  const [discoverSubTab, setDiscoverSubTab] = useState<"events" | "outrights" | "fantasy">("events");
  const [favoriteMatchIds, setFavoriteMatchIds] = useState<Set<string>>(() => new Set());
  const [checkedLeagueIds, setCheckedLeagueIds] = useState<Set<string>>(() => new Set());

  // Dynamic league registry catalog — replaces the legacy hard-coded
  // FALLBACK_LEAGUE_REGIONS list.  Fetched once on mount; the catalog
  // covers ~417 leagues.  We default to ``tier=major`` (≤80 leagues) so
  // the picker stays manageable; users can drill into the long tail via
  // the search box on the discover page.
  const [leagueCatalog, setLeagueCatalog] = useState<import("@/lib/api").LeagueCatalogResp | null>(null);
  const [dailyCounts, setDailyCounts] = useState<import("@/lib/api").LeagueDailyCountsResp | null>(null);

  useEffect(() => {
    let alive = true;
    oddsApi.listLeagueCatalog({ tier: "major" }).then(
      (resp) => { if (alive) setLeagueCatalog(resp); },
      (err) => { console.warn("[sports] catalog fetch failed:", err); },
    );
    
    const fetchCounts = () => {
      oddsApi.listLeaguesDailyCounts().then(
        (resp) => { if (alive) setDailyCounts(resp); },
        (err) => { console.warn("[sports] daily counts fetch failed:", err); },
      );
    };
    
    fetchCounts();
    const interval = setInterval(fetchCounts, 60000); // Poll counts every 60s
    
    return () => { 
      alive = false; 
      clearInterval(interval);
    };
  }, []);
  const leagueRegions = useMemo(
    () => catalogToRegions(leagueCatalog, /*maxPriority*/ 50),
    [leagueCatalog],
  );
  // DiscoverScreen 早盘 date pill — "all" means no date constraint, otherwise
  // a local-tz date key like "2026-05-26". Lifted to the page so it can also
  // filter the downstream FootballListScreen when the user clicks 查看赛事.
  const [discoverDateFilter, setDiscoverDateFilter] = useState<string>("all");
  const [proTab, setProTab] = useState<ProTab>("hot");
  const [activeCategory, setActiveCategory] = useState<DiscoverCategory>("all");
  const [selections, setSelections] = useState<SlipSelection[]>([]);
  const [slipMode, setSlipMode] = useState<SlipMode>("single");
  const [parlayStake, setParlayStake] = useState("10.00");
  const [quoteSeconds, setQuoteSeconds] = useState(18);
  const [riskAccepted, setRiskAccepted] = useState(false);
  // Credit-account session (sportsbook model: agent issues username +
  // password and authorises a credit limit). The state vars keep their
  // original `wallet*` names so we don't churn 30+ props, but their
  // meaning is:
  //   walletConnected → account logged in
  //   walletAddress   → e.g. "代理 PMPM-A1 · zhang3"
  //   walletBalance   → e.g. "信用 1,000.00 USDT"
  // A real backend would replace the mock login in `LoginDrawer` with a
  // POST /api/auth + session cookie.
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string>("");
  // `walletBalance` is the human-facing string, e.g. "信用 73,410.99 RMB" —
  // it follows the player's *native* currency (member.currency in db_client),
  // not USDT. Components downstream just display the string verbatim.
  // The numeric counterparts are tracked separately so the header pill can
  // pick the value up without parsing the string, and so we can re-derive
  // the native amount after bet placement (which mutates the USDT side).
  const [walletBalance, setWalletBalance] = useState<string>("");
  const [walletCurrency, setWalletCurrency] = useState<string>("USDT");
  const [walletBalanceNative, setWalletBalanceNative] = useState<number | null>(null);
  const [walletBalanceUsdt, setWalletBalanceUsdt] = useState<number | null>(null);
  const [walletFxRate, setWalletFxRate] = useState<number>(1);
  const [stakeCurrency, setStakeCurrency] = useState<"USDT" | "RMB">("RMB");
  const [walletDrawerOpen, setWalletDrawerOpen] = useState(false);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  // ─── Display preferences (mirror old PHP right-drawer toggles, persisted to localStorage)
  // Display preferences mirror the legacy PHP right-drawer toggles.
  // 语言 and 盘口类型 are LOCKED to their canonical values ("zh-cn" /
  // "Euro") because the H5 frontend only ships Simplified-Chinese copy
  // and only renders European decimal odds — exposing other choices in
  // the UI created the impression of features that didn't exist.  The
  // state remains as a useState so future builds can reintroduce the
  // toggles without touching everything that reads them.
  const [prefLang, setPrefLang] = useState<"zh-cn" | "zh-tw" | "en-us">("zh-cn");
  const [prefMarket, setPrefMarket] = useState<"HK" | "Malay" | "Indo" | "Euro">("Euro");
  const [prefTime, setPrefTime] = useState<"sysTime" | "devTime">("sysTime");
  const [prefOddsNotify, setPrefOddsNotify] = useState<boolean>(true);
  useEffect(() => {
    try {
      // Force canonical values on load to clear stale localStorage from
      // earlier builds that allowed 繁體 / 香港盘 / 马来盘 / 印尼盘.
      localStorage.setItem('cg_pref_lang', 'zh-cn');
      localStorage.setItem('cg_pref_market', 'Euro');
      const tm = localStorage.getItem('cg_pref_time'); if (tm === 'sysTime' || tm === 'devTime') setPrefTime(tm);
      const od = localStorage.getItem('cg_pref_odds_notify'); if (od === '0') setPrefOddsNotify(false); else if (od === '1') setPrefOddsNotify(true);
    } catch {/* ignore */}
  }, []);
  const updatePref = <T extends string | boolean>(key: string, value: T, setter: (v: T) => void) => {
    setter(value);
    try { localStorage.setItem(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value)); } catch {/* ignore */}
  };
  const [mustChangeReason, setMustChangeReason] = useState<'set_loginname' | 'change_password' | ''>('');
  const [betSlipOpen, setBetSlipOpen] = useState(false);
  const [orders, setOrders] = useState<OrderItem[]>(initialOrders);
  const [positions, setPositions] = useState<PositionItem[]>(initialPositions);
  const [sellTarget, setSellTarget] = useState<PositionItem | null>(null);
  const [sellPercent, setSellPercent] = useState(60);
  const [circleRiskAccepted, setCircleRiskAccepted] = useState(false);
  const [createdPrediction, setCreatedPrediction] = useState<CreatedPrediction>(defaultCreatedPrediction);
  const [circleRooms, setCircleRooms] = useState<CircleRoom[]>(initialCircleRooms);
  const [trends] = useState<TrendItem[]>(initialTrendItems);
  const [toast, setToast] = useState("");
  // Live data from crown-explorer:
  //   - odds-api.io fixtures + markets   → football screens (primary source)
  //   - crown bet ledger                 → orders screen (legacy reference)
  const [oddsEvents, setOddsEvents] = useState<OddsEvent[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [matchesError, setMatchesError] = useState<string | null>(null);
  const [oddsBookmakers, setOddsBookmakers] = useState<OddsBookmaker[]>([]);
  // Provenance of `oddsBookmakers` ("ws_live" / "r_cn_snapshot" / "finished").
  // We track it so that the detail screens can distinguish 「滚球盘」 (live
  // WS-pushed odds, bet-able during in-play) from a stale prematch r_cn
  // tree that's still cached in this React state because the user opened
  // the detail page before the match went in-play.  See toggleSelection
  // and FootballScreen/ProScreen for the lock rule:
  //   match in-play + source !== "ws_live"  →  picks DISABLED
  // The fetch effect below also re-fires on rawStatus change so the tree
  // gets replaced with live markets the moment kickoff is detected.
  const [oddsBookmakersSource, setOddsBookmakersSource] = useState<string | null>(null);
  // Outrights / futures from /api/external/outrights (the-odds-api.com proxy).
  // Initially empty so the 冠军 page renders the "待开放" panel until the
  // first fetch completes; on success we get a list of OutrightEvent rows
  // (one per sport_key, e.g. FIFA World Cup Winner).
  const [outrightEvents, setOutrightEvents] = useState<OutrightEvent[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(false);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  // odds-api.io WebSocket bridge: when a match is selected we open a
  // filtered subscription to /api/external/ws and patch the local
  // oddsBookmakers state on every `updated` message. `wsLastTickAt` /
  // `wsConnected` drive the small status badge in the header so the user
  // can see live updates landing in real time.
  const [wsConnected, setWsConnected] = useState(false);
  const [wsLastTickAt, setWsLastTickAt] = useState<number | null>(null);

  useEffect(() => {
    const returnHome = () => {
      setScreen("discover");
      setActiveCategory("all");
      setFootballFilter("all");
      setToast("");
    };
    const openLogin = () => setWalletDrawerOpen(true);
    window.addEventListener("pmpm-home", returnHome);
    window.addEventListener("pmpm-open-login", openLogin);
    return () => {
      window.removeEventListener("pmpm-home", returnHome);
      window.removeEventListener("pmpm-open-login", openLogin);
    };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FAVORITE_MATCHES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        setFavoriteMatchIds(new Set(parsed.map(String)));
      }
    } catch {
      setFavoriteMatchIds(new Set());
    }
  }, []);

  // Centralised "login succeeded" reducer — used by both the boot-time
  // /me probe and the LoginDrawer submit handler so they stay in sync.
  const applyAccountState = useCallback((user: PmppmUser) => {
    setWalletConnected(true);
    const agent = user.is_agent ? `L${1} 代理` : "玩家";
    setWalletAddress(`${agent} · ${user.username}`);
    // Display the player's native-currency balance (e.g. RMB) in the header
    // and any downstream pill that reads the `walletBalance` string. The
    // raw value comes from `credit_balance_raw`; we fall back to
    // `credit_balance` (USDT) for legacy responses that didn't include the
    // FX fields. `currency` defaults to USDT when missing.
    const cur = (user.currency || 'USDT').toUpperCase();
    const native = typeof user.credit_balance_raw === 'number'
      ? user.credit_balance_raw
      : user.credit_balance;
    const usdt = user.credit_balance ?? 0;
    const fx = typeof user.fx_rate === 'number' && user.fx_rate > 0 ? user.fx_rate : 1;
    setWalletCurrency(cur);
    setStakeCurrency(cur === 'RMB' ? 'RMB' : 'USDT');
    setWalletBalanceNative(native);
    setWalletBalanceUsdt(usdt);
    setWalletFxRate(fx);
    setWalletBalance(`信用 ${formatCreditAmount(native)} ${cur}`);
  }, []);

  // On mount, try to restore the session from the HttpOnly cookie that
  // /api/auth/login sets. If the cookie is valid the header pills will
  // populate without the user having to log in again. A 401 just means
  // "no session"; we silently ignore it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await pmppmApi.me();
        if (cancelled) return;
        applyAccountState(me.user);
      } catch {
        /* not logged in — leave header in未登陆 state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyAccountState]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setQuoteSeconds((value) => (value > 0 ? value - 1 : 18));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Crown Gold layout is fully responsive via CSS (Tailwind breakpoints).
  // No JavaScript scaling needed — the layout uses a natural document flow
  // with a fixed header and optional right-side bet-slip panel on desktop.

  // Unified effect: fetch fixtures based on current filter states,
  // then set up a silent 15s polling fallback to keep metadata fresh.
  useEffect(() => {
    let cancelled = false;
    const POLL_MS = 15_000;
    const WS_FRESH_WINDOW_MS = 60_000;

    const fetchMatches = async (silent = false) => {
      const leaguesStr = Array.from(checkedLeagueIds)
        .map(id => id.startsWith("slug:") ? id.substring(5) : id)
        .join(",");
        
      const params: Parameters<typeof oddsApi.listEvents>[0] = {
        only_active: true,
        limit: 2000
      };
      
      if (leaguesStr) {
        params.leagues = leaguesStr;
      }
      
      if (footballFilter !== "all" && footballFilter !== "favorites" && footballFilter !== "outrights") {
        params.filter = footballFilter;
      }
      
      if (discoverDateFilter !== "all" && discoverDateFilter !== "future") {
        params.date = discoverDateFilter;
      }

      if (!silent) {
        setMatchesLoading(true);
        setMatchesError(null);
      }

      try {
        const resp = await oddsApi.listEvents(params);
        if (cancelled) return;
        const incomingItems = resp.items.length > 0 ? resp.items : (!silent ? demoOddsEvents() : null);
        if (!incomingItems) return;

        const wsCutoff = Date.now() - WS_FRESH_WINDOW_MS;
        setOddsEvents((prev) => {
          // Equality short-circuit: if every incoming row matches its prev
          // counterpart 1:1 (same id, same fields), return prev so React's
          // dependent useMemos / list renders skip entirely.  Cheap because
          // most polls land mid-game with no actual data movement (scores
          // unchanged, odds within 60s WS-fresh window already preserved).
          const prevById = new Map(prev.map((e) => [String(e.id), e] as const));
          let anyChanged = prev.length !== incomingItems.length;
          const next = incomingItems.map((incoming) => {
            const id = String(incoming.id);
            const prevEv = prevById.get(id);
            const wsTouched = wsTouchedAtRef.current.get(id) ?? 0;
            // WS-fresh main_odds wins over the cron-snapshot from the poll —
            // unchanged behaviour from the original implementation.
            const candidate: OddsEvent = (prevEv && wsTouched > wsCutoff && prevEv.main_odds)
              ? { ...incoming, main_odds: prevEv.main_odds }
              : incoming;
            // Preserve the prev reference when content matches.  Each row
            // that survives this branch keeps its identity, which means
            // memoised children (and the React reconciler's bail-out for
            // unchanged props) avoid the per-row re-render storm.
            if (prevEv && oddsEventShallowEqual(prevEv, candidate)) {
              return prevEv;
            }
            anyChanged = true;
            return candidate;
          });
          // List unchanged (e.g. mid-game polls where nobody scored, no odds
          // moved): return the prev array reference so downstream useMemos
          // (`matches`, `visibleMatches`, `groups`) all short-circuit and
          // not a single match card re-renders.
          return anyChanged ? next : prev;
        });

        if (incomingItems.length > 0) {
          const currentSelectedExists = incomingItems.some(e => String(e.id) === selectedMatchIdRef.current);
          if (!silent || !currentSelectedExists) {
            setSelectedMatchId(String(incomingItems[0].id));
          }
        }
      } catch {
        if (cancelled) return;
        if (!silent) {
          const fallback = demoOddsEvents();
          setOddsEvents(fallback);
          setSelectedMatchId(String(fallback[0].id));
          setMatchesError(null);
        }
      } finally {
        if (!cancelled && !silent) setMatchesLoading(false);
      }
    };

    fetchMatches(false); // Loud on filter changes
    const timer = window.setInterval(() => fetchMatches(true), POLL_MS); // Polling silent updates

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [footballFilter, checkedLeagueIds, discoverDateFilter]);

  // Fetch outrights (FIFA World Cup winner etc.) once on mount. These
  // change slowly — the backend caches each sport_key for 30 min, and we
  // don't poll on the client. Failure is silent: the 冠军 page falls back
  // to its "待开放" empty-state panel.
  useEffect(() => {
    let cancelled = false;
    oddsApi
      .listOutrights()
      .then((resp) => {
        if (cancelled) return;
        setOutrightEvents(resp.items ?? []);
      })
      .catch(() => {
        // Soft-fail: leave outrightEvents empty so the 冠军 page shows
        // the same "待开放" UI as it does pre-deploy.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch /api/bets whenever the user logs in (and clear on logout). The
  // legacy /d0/, /admin/, /agents/ panels read from the same db_client.bet
  // table joined on member.name = bet.m_name, so on the H5 side we just
  // ask api_v2.php for the current session's bets — it resolves the right
  // m_name via the session uid.
  useEffect(() => {
    if (!walletConnected) {
      setOrders([]);
      return;
    }
    let cancelled = false;
    crownApi
      .listBets({ gtype: "FT", limit: 100 })
      .then((resp) => {
        if (cancelled) return;
        setOrders(resp.items.map(crownBetToOrder));
      })
      .catch(() => {
        // Crown bets are a nice-to-have; just leave the list empty.
      });
    return () => {
      cancelled = true;
    };
  }, [walletConnected]);

  // When the selected match changes — OR when its rawStatus transitions
  // (prematch → inplay/live, or live → settled) — fetch its market book
  // from the backend.  Including rawStatus in the dep array is what
  // guarantees the bookmakers tree gets swapped from a stale r_cn
  // snapshot to fresh WS-served live odds the moment the match kicks
  // off, even if the user keeps the detail page open across the
  // transition.  Without it, the page would keep displaying frozen
  // prematch quotes that the user could mistakenly bet against.
  const selectedRawStatus = oddsEvents.find((e) => String(e.id) === selectedMatchId)?.status ?? null;
  useEffect(() => {
    if (!selectedMatchId) {
      setOddsBookmakers([]);
      setOddsBookmakersSource(null);
      return;
    }
    let cancelled = false;
    // First fetch shows the loading spinner; subsequent silent refreshes
    // (the 15s poll below) must NOT toggle marketsLoading or marketsError
    // back to a transient state — that would flash empty markets while the
    // refetch is in flight.
    const fetchMarkets = (silent: boolean) => {
      if (!silent) {
        setMarketsLoading(true);
        setMarketsError(null);
      }
      oddsApi
        .listMarkets(selectedMatchId)
        .then((resp) => {
          if (cancelled) return;
          setOddsBookmakers(resp.bookmakers);
          setOddsBookmakersSource(resp.source ?? null);
          if (silent) setMarketsError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          const message = err instanceof ApiError ? `${err.status} ${err.message}` : err instanceof Error ? err.message : "unknown error";
          if (!silent) {
            setMarketsError(message);
            setOddsBookmakers([]);
            setOddsBookmakersSource(null);
          }
        })
        .finally(() => {
          if (!cancelled && !silent) setMarketsLoading(false);
        });
    };
    fetchMarkets(false);
    // 15s detail-view market poll as a fallback when the WebSocket bridge is
    // unable to push live updates (CF idle drop, cold reconnect, filter
    // mismatch, etc). Keeps detail-page odds at most ~15s stale even if WS
    // is fully down. The list-view 30s poll above covers main_odds.
    const t = window.setInterval(() => fetchMarkets(true), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [selectedMatchId, selectedRawStatus]);

  // odds-api.io WebSocket: subscribe to ALL currently in-play (滚球)
  // event IDs (capped at ODDS_WS_MAX_EVENTS to stay under odds-api.io's
  // 50-id-per-connection filter limit).  Two state-effects on every
  // message:
  //
  //   1. setOddsBookmakers(...) — patch the detail/markets view's
  //      bookmakers tree for the SELECTED match.  Same behaviour as
  //      before; the rest of the events are dropped from this hook.
  //   2. setOddsEvents(...) — patch the matched row's main_odds so the
  //      9 inline columns in the list reflect the latest WS price.
  //      This is what makes the list view real-time.
  //
  // Reconnect / replay-on-connect / backoff is owned by OddsWsClient,
  // not this hook.  We only re-create the client when the *set* of live
  // event IDs changes (so we don't tear down the WS on every odds tick).
  const liveEventIdsKey = useMemo(() => {
    const ids = oddsEvents
      .filter((ev) => {
        const s = String(ev.status ?? "").toLowerCase();
        return s === "inplay" || s === "live";
      })
      .map((ev) => String(ev.id))
      .slice(0, ODDS_WS_MAX_EVENTS);
    ids.sort();
    return ids.join(",");
  }, [oddsEvents]);

  // Ref so the WS message handler always sees the latest selected match
  // id without us tearing down + re-opening the socket on every click.
  const selectedMatchIdRef = useRef<string | null>(selectedMatchId);
  useEffect(() => { selectedMatchIdRef.current = selectedMatchId; }, [selectedMatchId]);

  // Per-event "last WS tick" timestamp (ms).  The polling effect below
  // refreshes the events list every 30s so prematch odds also flow into
  // the UI without a full page reload, but for events that received a
  // WS message in the last 60s we KEEP the WS-fresh main_odds rather
  // than overwriting it with the cron-snapshot main_odds from the poll.
  // WS therefore always wins over polling — exactly what the user
  // requested ("websocket priority over polling").
  const wsTouchedAtRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!ODDS_WS_ENABLED || liveEventIdsKey === "") {
      setWsConnected(false);
      return;
    }
    const eventIds = liveEventIdsKey.split(",");
    const client = new OddsWsClient({ eventIds });

    const onMsg = (msg: OddsWsMessage) => {
      // First hello flips the badge so the UI doesn't show "未连接"
      // between socket-open and the first odds tick.
      if (msg.type === "hello") {
        setWsConnected(true);
        return;
      }
      if (msg.type === "error") {
        setWsConnected(false);
        return;
      }
      if (msg.type !== "updated" && msg.type !== "created") return;

      const now = Date.now();
      setWsLastTickAt(now);
      const eid = String(msg.id);
      // Mark this event as WS-fresh so the polling effect (below) doesn't
      // overwrite its main_odds with the cron snapshot for the next ~60s.
      wsTouchedAtRef.current.set(eid, now);

      // (1) Detail view: patch bookmakers tree if this is the selected
      // match.  Other events' detail panes update on next open.
      if (eid === String(selectedMatchIdRef.current)) {
        setOddsBookmakers((prev) => mergeOddsUpdate(prev, msg));
      }

      // (2) List view: project the WS deltas into main_odds for the
      // matched row.  We merge on top of the row's previous main_odds
      // so unchanged markets don't get blanked out.
      setOddsEvents((prev) => {
        const idx = prev.findIndex((ev) => String(ev.id) === eid);
        if (idx < 0) return prev;
        const merged = projectMainOddsFromWs(prev[idx].main_odds ?? null, msg);
        if (!merged) return prev;
        // Equality short-circuit — Bet365 retransmits the same prices on
        // every snapshot cycle (~38s), so most WS frames carry no actual
        // movement.  Bail without allocating a new array when the merged
        // odds are byte-equal to what's already in state.
        if (_mainOddsEqual(prev[idx].main_odds, merged)) return prev;
        const next = prev.slice();
        next[idx] = { ...prev[idx], main_odds: merged };
        return next;
      });
    };

    const unlisten = client.addListener(onMsg);
    client.start();

    // Poll the underlying client's `connected` flag so the badge flips
    // even when no updates arrive (silent connect / quiet match).
    const tick = window.setInterval(() => setWsConnected(client.connected), 1000);

    return () => {
      window.clearInterval(tick);
      unlisten();
      client.close();
      setWsConnected(false);
    };
    // selectedMatchId intentionally NOT in deps: we don't want to drop
    // and re-open the WS every time the user clicks a different row.
    // We capture the latest selectedMatchId via the ref-like closure on
    // onMsg, which re-reads it from the enclosing scope each call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEventIdsKey]);


  const matches: FootballMatch[] = useMemo(
    () => oddsEvents.map(oddsEventToFootball),
    [oddsEvents],
  );
  const selectedOddsEvent = useMemo<OddsEvent | null>(
    () => oddsEvents.find((e) => String(e.id) === selectedMatchId) ?? null,
    [oddsEvents, selectedMatchId],
  );
  const selectedMatch = useMemo<FootballMatch | null>(
    () => (selectedOddsEvent ? oddsEventToFootball(selectedOddsEvent) : null),
    [selectedOddsEvent],
  );
  const beginnerMarketsForSelectedMatch = useMemo(
    () => buildBeginnerMarkets(oddsBookmakers, selectedOddsEvent),
    [oddsBookmakers, selectedOddsEvent],
  );
  const activeMarkets = useMemo(
    () => buildProGroups(oddsBookmakers, selectedOddsEvent, proTab),
    [oddsBookmakers, selectedOddsEvent, proTab],
  );

  const slipTotals = useMemo(() => {
    if (selections.length === 0) {
      return { totalStake: 0, maxReturn: 0, profit: 0, combinedOdds: 0, hasConflict: false, conflictText: "" };
    }
    if (slipMode === "single") {
      const totalStake = selections.reduce((sum, item) => sum + item.stake, 0);
      const maxReturn = selections.reduce((sum, item) => sum + item.stake * item.odds, 0);
      return { totalStake, maxReturn, profit: maxReturn - totalStake, combinedOdds: 0, hasConflict: false, conflictText: "" };
    }
    const stake = numeric(parlayStake);
    const combinedOdds = selections.reduce((product, item) => product * item.odds, 1);
    const maxReturn = stake * combinedOdds;
    return {
      totalStake: stake,
      maxReturn,
      profit: maxReturn - stake,
      combinedOdds,
      hasConflict: false,
      conflictText: "",
    };
  }, [parlayStake, selections, slipMode]);

  const activeSelectionIds = useMemo(() => new Set(selections.map((item) => item.id)), [selections]);

  // Auto-switch the slip into parlay (综合过关) when the user crosses 3
  // selections. We never auto-switch BACK to single, so the user can
  // remove a selection without losing the parlay mode they explicitly
  // chose. The trigger fires once per crossing, not on every render.
  const lastSelectionCount = useRef(0);
  useEffect(() => {
    if (selections.length >= 3 && lastSelectionCount.current < 3 && slipMode !== "parlay") {
      setSlipMode("parlay");
    }
    lastSelectionCount.current = selections.length;
  }, [selections.length, slipMode]);

  const go = (next: Screen) => {
    if (next === "footballList") {
      setFootballFilter("all");
    }
    setScreen(next);
    setScreenStack((stack) => {
      // Collapse no-op pushes (re-clicking the same screen) and re-anchor on
      // "discover" so the back history stays meaningful.
      if (stack[stack.length - 1] === next) return stack;
      if (next === "discover") return ["discover"];
      return [...stack, next];
    });
    setToast("");
    // Note: previous seedSlip() inserted hardcoded selections; that's gone now
    // because option ids must come from Crown markets. If you arrive on the
    // betslip screen with nothing selected, the empty state instructs you
    // to pick a match first.
  };

  const goBack = () => {
    setScreenStack((stack) => {
      if (stack.length <= 1) {
        setScreen("discover");
        return ["discover"];
      }
      const next = stack.slice(0, -1);
      setScreen(next[next.length - 1]);
      return next;
    });
    setToast("");
  };

  const goFootballFilter = (filter: FootballListFilter) => {
    // Time-based top tabs (滚球 / 今日 / 即将开赛 / 早盘 / 综合过关 / 我的赛事)
    // are *global* filters — users expect them to show every league with
    // matches in that time window. A leftover `checkedLeagueIds` set from
    // the DiscoverScreen would otherwise silently filter the list down to
    // zero (e.g. World-Cup-only filter + 即将开赛 produces 0 results even
    // though the Italian Serie A has games tonight). Clear the league
    // selection here so the time tabs always show "everything". The
    // 世界杯 button is its own slug-based filter and doesn't need the
    // league checkboxes.
    const TIME_FILTERS: FootballListFilter[] = ["live", "today", "soon", "wc", "parlay", "favorites", "hot", "all"];
    if (TIME_FILTERS.includes(filter)) {
      setCheckedLeagueIds(new Set());
      // Time tabs also reset the 早盘 date pill so the user gets the full
      // time-window range and isn't accidentally narrowed to a single day.
      setDiscoverDateFilter("all");
    }
    // `early` / `outrights` route to the DiscoverScreen because the original
    // Crown SPA lets you pick league + 赛事/冠军 subtab there before
    // entering the actual match list. The other filters land directly on
    // the FootballListScreen list view.
    if (filter === "early") {
      setDiscoverSubTab("events");
      setFootballFilter(filter);
      setScreen("discover");
      setScreenStack((stack) => {
        if (stack[stack.length - 1] === "discover") return stack;
        return [...stack, "discover"];
      });
      setToast("");
      return;
    }
    if (filter === "outrights") {
      setDiscoverSubTab("outrights");
      setFootballFilter(filter);
      setScreen("discover");
      setScreenStack((stack) => {
        if (stack[stack.length - 1] === "discover") return stack;
        return [...stack, "discover"];
      });
      setToast("");
      return;
    }
    setFootballFilter(filter);
    setScreen("footballList");
    setScreenStack((stack) => {
      if (stack[stack.length - 1] === "footballList") return stack;
      return [...stack, "footballList"];
    });
    setToast("");
  };

  const toggleFavoriteMatch = (matchKey: string) => {
    setFavoriteMatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(matchKey)) {
        next.delete(matchKey);
      } else {
        next.add(matchKey);
      }
      try {
        window.localStorage.setItem(FAVORITE_MATCHES_KEY, JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  const openFootballMatch = (match: FootballMatch) => {
    setSelectedMatchId(match.id);
    setRiskAccepted(false);
    setToast("");
    setScreen("football");
  };

  const toggleSelection = (option: OutcomeOption, locked = false) => {
    // Detail-page bet placement rules:
    //   - settled/cancelled  →  always locked (terminal)
    //   - in-play + source="ws_live"      →  bet-able against 滚球盘
    //   - in-play + source="r_cn_snapshot" →  LOCKED, those quotes are
    //     stale prematch lines that the user happens to still have
    //     loaded from before kickoff.  Selecting them would let the user
    //     bet against pre-match odds while the live game runs — a clear
    //     pricing arbitrage we never want to expose.
    //   - prematch + source="r_cn_snapshot" → bet-able
    const rs = selectedMatch?.rawStatus;
    const isInplay = rs === "inplay" || rs === "live";
    const stalePrematch = isInplay && oddsBookmakersSource !== "ws_live" && oddsBookmakersSource !== null;
    const matchLocked = selectedMatch?.status === "locked" || stalePrematch;
    if (locked || matchLocked) {
      setToast(stalePrematch
        ? "比赛已进入滚球，赛前报价已失效。请等滚球盘口推送后再下单。"
        : "本场已锁单，无法继续下单或卖出，等待赛果结算。");
      return;
    }
    setQuoteSeconds(18);
    setToast("");
    setSelections((items) => {
      if (items.some((item) => item.id === option.id)) return items.filter((item) => item.id !== option.id);
      const withoutSameMarket = items.filter((item) => item.marketId !== option.marketId);
      return [...withoutSameMarket, { ...option, selectionId: option.id, stake: 10 }];
    });
  };

  const removeSelection = (selectionId: string) => {
    setSelections((items) => items.filter((item) => item.selectionId !== selectionId));
  };

  const setSelectionStake = (selectionId: string, value: string) => {
    const amount = numeric(value);
    setSelections((items) => items.map((item) => (item.selectionId === selectionId ? { ...item, stake: amount } : item)));
  };

  const changeQuickAmount = (value: number) => {
    if (slipMode === "single") {
      setSelections((items) => items.map((item) => ({ ...item, stake: value })));
    } else {
      setParlayStake(value.toFixed(2));
    }
  };

  const openConfirm = () => {
    if (selections.length === 0) {
      setToast("请先选择一个预测项。");
      return;
    }
    setRiskAccepted(false);
    // The mobile bet-slip slide-up overlay is rendered via `betSlipOpen`
    // and stays on top of the screen stack. If we navigate to the confirm
    // screen without closing it, the user sees nothing change and the
    // "确认下单" CTA inside the overlay appears unresponsive — they can't
    // see (or click) the real ConfirmScreen sitting underneath.
    setBetSlipOpen(false);
    setScreen("confirm");
  };

  const submitOrder = async () => {
    if (!walletConnected) {
      setWalletDrawerOpen(true);
      return;
    }
    if (!riskAccepted) {
      setToast("请先勾选风险提示。");
      return;
    }
    if (selections.length === 0) {
      setToast("预测单为空。");
      return;
    }
    // Compose a human-readable order title that also shows the picked side.
    // - Single (1 selection): "<title> · <label>"           e.g. "FIFA 世界杯冠军 2026 · 冠军 · 卡塔尔"
    // - Multi single (n>1):  "<first title> 等 n 项"        — full leg breakdown shown on the orders page
    // - Parlay:              "<title1> <label1> / <title2> <label2> / …"
    const orderTitle = (() => {
      if (selections.length === 0) return selectedMatch ? matchTitle(selectedMatch) : "未选择赛事";
      const fmtLeg = (sel: SlipSelection) => sel.label ? `${sel.title} · ${sel.label}` : sel.title;
      if (slipMode === "parlay") {
        return selections
          .map((sel) => sel.label ? `${sel.title} ${sel.label}` : sel.title)
          .join(" / ");
      }
      if (selections.length === 1) return fmtLeg(selections[0]);
      return `${fmtLeg(selections[0])} 等 ${selections.length} 项`;
    })();
    let placed = 0;
    let lastBalance: number | null = null;
    let lastBalanceRaw: number | null = null;
    let firstError: string | null = null;
    const betPayloads = slipMode === "parlay"
      ? [{
          event_id: selections.map((sel) => sel.eventId).join(","),
          market_id: "PARLAY",
          market_name: `${selections.length} 串 1`,
          outcome_index: 0,
          outcome_label: selections.map((sel) => `${sel.title}｜${sel.marketTitle}｜${sel.label}`).join(" / "),
          stake_amount: numeric(parlayStake),
          stake_currency: stakeCurrency,
          amount_usdt: numeric(parlayStake),
          odds: slipTotals.combinedOdds,
        }]
      : selections.map((sel) => {
      // marketId in our slip is `<event_id>-<6digit_market_id>-<rowIdx>`;
      // strip the row suffix so the backend gets the canonical 6-digit
      // market_id (the same one /api/external/events/{id}/markets emits).
      const parts = sel.marketId.split("-");
      const eventId = parts[0] ?? sel.eventId ?? "";
      const sixDigit = parts[1] ?? "";
      return {
        event_id:      eventId,
        market_id:     sixDigit,
        market_name:   sel.marketTitle,
        outcome_index: 0,
        outcome_label: sel.label,
        // Settlement hints. `outcome_field` is one of: home/away/draw/over/
        // under/yes/no/1x/x2/12 (main_odds rows) or any custom field name
        // from /api/external/events/{id}/markets. `outcome_line` is the
        // numeric spread/total for SP/OU/Corners markets when present.
        // These let the backend resolve wtype/rtype/spread without trying
        // to substring-match Chinese labels against English team names.
        outcome_field: sel.field || null,
        outcome_line:  typeof sel.line === "number" ? sel.line : null,
        stake_amount:  sel.stake,
        stake_currency: stakeCurrency,
        amount_usdt:   sel.stake,
        odds:          sel.odds,
      };
    });
    for (const payload of betPayloads) {
      try {
        const resp = await pmppmApi.placeBet(payload);
        placed += 1;
        lastBalance = resp.new_balance;
        lastBalanceRaw = resp.new_balance_raw ?? null;
      } catch (err) {
        firstError = friendlyPlaceBetError(err);
        break;
      }
    }

    if (lastBalance != null) {
      // `new_balance` = USDT, `new_balance_raw` = native currency (e.g. RMB).
      // Use the raw value when the backend provides it; fall back to FX re-derivation.
      const nativeAfter = lastBalanceRaw != null ? lastBalanceRaw : (walletFxRate > 0 ? lastBalance * walletFxRate : lastBalance);
      setWalletBalanceUsdt(lastBalance);
      setWalletBalanceNative(nativeAfter);
      setWalletBalance(`信用 ${formatCreditAmount(nativeAfter)} ${walletCurrency}`);
    }
    if (placed === betPayloads.length) {
      const typeText = slipMode === "parlay" ? `${selections.length} 串 1` : `单关 ${selections.length} 项`;
      const nativeAfterToast = lastBalanceRaw != null ? lastBalanceRaw : (lastBalance != null && walletFxRate > 0 ? lastBalance * walletFxRate : null);
      const balText = nativeAfterToast != null
        ? `${formatCreditAmount(nativeAfterToast)} ${walletCurrency}`
        : `${formatCreditAmount(lastBalance)} ${curName('USDT')}`;
      setOrders((items) => [
        {
          id: `order-${Date.now()}`,
          title: `${orderTitle} · ${typeText}`,
          meta: `投入 ${formatCreditAmount(slipTotals.totalStake)} ${stakeCurrency} · 最高返还 ${formatCreditAmount(slipTotals.maxReturn)} ${stakeCurrency} · 信用 ${balText}`,
          stake: slipTotals.totalStake,
          status: "已下单 · 待结算",
          tag: "open",
          canSell: true,
        },
        ...items,
      ]);
      setSelections([]);
      setToast(`下单成功 · ${typeText} · 信用余额 ${balText}`);
      setScreen("orders");
      return;
    }

    setToast(
      placed === 0
        ? `下单失败：${firstError ?? "未知错误"}`
        : `部分下单成功（${placed}/${betPayloads.length}），最后一笔失败：${firstError ?? "?"}`,
    );
  };

  const confirmSell = () => {
    if (!sellTarget) return;
    setPositions((items) => items.map((item) => (item.id === sellTarget.id ? { ...item, canSell: false, lockedReason: "已卖出部分持仓，等待成交确认" } : item)));
    setSellTarget(null);
    setToast("卖出订单已提交，预计到账已更新。");
  };

  const publishCreatedPrediction = (draft: CreatedPrediction) => {
    setCreatedPrediction(draft);
    setCircleRooms((items) => [
      {
        ...draft,
        id: `circle-${items.length + 1}`,
        pool: "0 USDT",
        participants: 1,
        yes: 50,
        status: `${draft.deadline} 截止`,
      },
      ...items,
    ]);
    setCircleRiskAccepted(false);
    setToast("朋友局已生成邀请链接。");
    setScreen("invite");
  };

  const joinCircleRoom = (room: CircleRoom, outcome: "Yes" | "No") => {
    if (!circleRiskAccepted) {
      setToast("请先确认朋友局规则和争议处理方式。");
      return;
    }
    const stake = Math.min(numeric(room.stakeCap || "5") || 5, 20);
    setCircleRooms((items) => items.map((item) => (item.id === room.id ? { ...item, joined: true, participants: item.participants + 1, pool: money(numeric(item.pool.replace(/[^\d.]/g, "")) + stake) } : item)));
    setOrders((items) => [
      {
        id: `order-circle-${items.length + 1}`,
        title: `${room.question} · ${outcome}`,
        meta: `投入 ${money(stake)} · 朋友局 · ${room.adjudicator}`,
        stake,
        status: "已参与 · 待结算",
        tag: "circle",
        canSell: false,
      },
      ...items,
    ]);
    setCircleRiskAccepted(false);
    setToast("已参与朋友局，订单已生成。");
    setScreen("orders");
  };

  const selectedScreenTitle = sidebarScreens.find((item) => item.id === screen)?.title || "Crown Gold";

  // Show bet slip on football / pro screens
  const showBetSlipPanel = ["football", "pro", "betslip", "confirm"].includes(screen) || (selections.length > 0 && ["discover", "footballList"].includes(screen));
  // The right-side info column (video / tracker / stats / timeline / h2h /
  // standings) is anchored to whichever match is currently selected. It
  // renders alongside the BetSlip on the football list / detail / pro
  // screens; on betslip/confirm we hide it so the slip can use the full
  // width.
  // Show the LMT / stats / events / h2h / standings sidebar whenever a
  // match is selected on a list-style screen. Previously this was hidden
  // once the user had 2+ picks so the cart could take the full right
  // column, but that pushed the live match tracker offscreen even when
  // the picks were all from the same (currently-tracked) match. The cart
  // is now stacked *below* the LMT card and scrolls independently — see
  // the right-aside layout further down.
  const showSidebarCards = !!selectedMatch
    && ["footballList", "football", "pro"].includes(screen);
  const showDesktopAside = showSidebarCards || screen !== "footballList" || selections.length > 0;
  const compactDesktopAside = screen === "footballList" && !showSidebarCards && selections.length === 0;
  // BottomNav hidden on mobile — top navbar (sticky) covers 首页/下注/钱包 entries.
  const showBottomNav = false;
  const showFloatingSlipBar = ["discover", "footballList", "football", "pro"].includes(screen) && selections.length > 0;

  if (!mounted) return null;

  return (
    <GoBackContext.Provider value={goBack}>
    <div className="flex h-[100dvh] flex-col bg-[var(--cg-bg)] text-[var(--cg-text)]" data-sports-shell="true">
      {/* ─── Crown Gold fixed header ─── */}
      <header className="sticky top-0 z-20 flex h-[46px] w-full items-center justify-between bg-[var(--cg-brown)] px-0">
        <div className="flex h-full items-center gap-0 overflow-hidden">
          {/* Home button */}
          <button type="button" onClick={() => go("discover")} className="flex h-full w-11 shrink-0 items-center justify-center text-white/60 transition hover:text-[var(--cg-gold)]">
            <svg viewBox="0 0 24 24" className="size-5 fill-current"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
          </button>
          {/* Primary sport-view tabs — scrollable, matching original SPA */}
          <nav className="flex h-full items-center gap-0 overflow-x-auto no-scrollbar">
            {headerNavTabs.map((tab, i) => (
              <button
                key={`${tab.title}-${i}`}
                type="button"
                onClick={() => goFootballFilter(tab.filter)}
                className={cx(
                  "flex h-full items-center whitespace-nowrap border-b-2 px-3 text-[13px] font-bold transition",
                  (screen === "footballList" && footballFilter === tab.filter) ||
                    (screen === "discover" && tab.filter === "early" && discoverSubTab !== "outrights") ||
                    (screen === "discover" && tab.filter === "outrights" && discoverSubTab === "outrights")
                    ? "border-[var(--cg-gold)] text-[var(--cg-gold)]"
                    : "border-transparent text-white/60 hover:text-[var(--cg-gold)]"
                )}
              >
                {tab.icon && <span className="mr-1 text-[11px]">{tab.icon}</span>}
                {tab.title}
              </button>
            ))}
          </nav>
        </div>
        {/* Right: 我的订单 + 我的赛事 + 购物车 + balance + account */}
        <div className="flex h-full items-center gap-0 pr-1">
          <button type="button" onClick={() => go("orders")} className="flex h-full items-center gap-1 px-2 text-[12px] text-white/50 transition hover:text-[var(--cg-gold)]">
            <span className="hidden min-[1024px]:inline">我的订单</span>
          </button>
          <button type="button" onClick={() => goFootballFilter("favorites")} className="flex h-full items-center gap-1 px-2 text-[12px] text-white/50 transition hover:text-[var(--cg-gold)]">
            <svg viewBox="0 0 16 16" className="size-4 fill-current"><path d="M14.9,6.9l-2.4,2.9c-0.2,0.2-0.3,0.5-0.2,0.8l0.3,3.8c0,0.2-0.1,0.5-0.3,0.6c-0.2,0.1-0.4,0.1-0.6,0.1l-3.3-1.5c-0.3-0.1-0.5-0.1-0.8,0L4.3,15c-0.2,0.1-0.4,0.1-0.6-0.1c-0.2-0.1-0.3-0.4-0.3-0.6l0.3-3.8c0-0.3-0.1-0.5-0.2-0.8L1.1,6.9C0.9,6.7,0.9,6.5,1,6.3C1.1,6,1.2,5.9,1.4,5.8L5,5c0.3-0.1,0.5-0.2,0.6-0.5l1.9-3.3c0.2-0.4,0.8-0.4,1,0l1.9,3.3C10.5,4.8,10.7,4.9,11,5l3.6,0.8c0.2,0,0.4,0.2,0.4,0.4C15.1,6.5,15.1,6.7,14.9,6.9z"/></svg>
            <span className="hidden min-[1024px]:inline">我的赛事</span>
            <span className="rounded bg-white/10 px-1 py-0.5 text-[10px] font-bold text-white/60">{favoriteMatchIds.size}</span>
          </button>
          <button type="button" onClick={() => go("betslip")} className="flex h-full items-center gap-1 px-2 text-[12px] text-white/50 transition hover:text-[var(--cg-gold)]">
            <span className="hidden min-[1024px]:inline">购物车</span>
            <span className="rounded bg-white/10 px-1 py-0.5 text-[10px] font-bold text-white/60">{selections.length}</span>
          </button>
          <div
            className="flex h-full items-center gap-1 px-2"
            title={
              walletConnected && walletBalanceUsdt != null && walletCurrency !== 'USDT'
                ? `≈ ${formatCreditAmount(walletBalanceUsdt)} ${curName('USDT')}`
                : undefined
            }
          >
            <span className="text-[12px] text-white/50">{walletConnected ? walletCurrency : ""}</span>
            <span className="text-[13px] font-bold text-[var(--cg-gold)]">
              {walletConnected && walletBalanceNative != null ? formatCreditAmount(walletBalanceNative) : "—"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => walletConnected ? setSettingsDrawerOpen(true) : setWalletDrawerOpen(true)}
            className="flex h-full w-9 items-center justify-center text-white/50 transition hover:text-[var(--cg-gold)]"
          >
            <svg viewBox="0 0 24 24" className="size-5 fill-current"><path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z"/></svg>
          </button>
        </div>
      </header>

      {/* ─── Main body: content + bet slip panel ─── */}
      {/* The outer shell is exactly viewport height (h-[100dvh]) so this
          middle row sits at flex-share = viewport - header. `min-h-0`
          lets the row stay at flex-share even when child content is
          taller (otherwise flex's implicit min-height:auto would force
          the row to grow to its content size, breaking inner scroll). */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Content area — scrolls vertically inside the row. */}
        <main className={cx(
          "relative flex-1 overflow-y-auto overscroll-contain",
          showBottomNav ? "pb-[80px] min-[1024px]:pb-4" : "pb-4",
          showFloatingSlipBar ? "pb-[140px] min-[1024px]:pb-4" : "",
        )}>
          {screen === "discover" && (
            <DiscoverScreen
              go={go}
              matches={matches}
              checkedLeagueIds={checkedLeagueIds}
              setCheckedLeagueIds={setCheckedLeagueIds}
              activeSubTab={discoverSubTab}
              setActiveSubTab={setDiscoverSubTab}
              setFootballFilter={setFootballFilter}
              activeDate={discoverDateFilter}
              setActiveDate={setDiscoverDateFilter}
              outrightEvents={outrightEvents}
              onPickOutrightOutcome={toggleSelection}
              selectedOutcomeIds={activeSelectionIds}
              leagueRegions={leagueRegions}
              dailyCounts={dailyCounts}
            />
          )}
          {screen === "footballList" && <FootballListScreen matches={matches} selectedMatchId={selectedMatchId} openMatch={openFootballMatch} go={go} filter={footballFilter} setFilter={setFootballFilter} favoriteMatchIds={favoriteMatchIds} toggleFavoriteMatch={toggleFavoriteMatch} loading={matchesLoading} error={matchesError} walletAddress={walletAddress} walletBalance={walletBalance} checkedLeagueIds={checkedLeagueIds} clearCheckedLeagues={() => setCheckedLeagueIds(new Set())} onPickOutcome={toggleSelection} selectedOutcomeIds={activeSelectionIds} discoverDateFilter={discoverDateFilter} clearDiscoverDateFilter={() => setDiscoverDateFilter("all")} oddsFlashEnabled={prefOddsNotify} setOddsFlashEnabled={(v) => updatePref('cg_pref_odds_notify', v, setPrefOddsNotify)} leagueRegions={leagueRegions} wsConnected={wsConnected} wsLastTickAt={wsLastTickAt} />}
          {screen === "football" && (
            selectedMatch ? (
              <FootballScreen match={selectedMatch} groups={beginnerMarketsForSelectedMatch} selectedIds={activeSelectionIds} onPick={toggleSelection} go={go} loading={marketsLoading} error={marketsError} walletAddress={walletAddress} walletBalance={walletBalance} marketsSource={oddsBookmakersSource} />
            ) : (
              <NoMatchPicked go={go} loading={matchesLoading} error={matchesError} />
            )
          )}
          {screen === "pro" && (
            selectedMatch ? (
              <ProScreen match={selectedMatch} activeTab={proTab} setActiveTab={setProTab} groups={activeMarkets} selectedIds={activeSelectionIds} onPick={toggleSelection} go={go} loading={marketsLoading} error={marketsError} walletAddress={walletAddress} walletBalance={walletBalance} marketsSource={oddsBookmakersSource} />
            ) : (
              <NoMatchPicked go={go} loading={matchesLoading} error={matchesError} />
            )
          )}
          {screen === "betslip" && (
            <BetSlipScreen
              selections={selections}
              mode={slipMode}
              totals={slipTotals}
              parlayStake={parlayStake}
              quoteSeconds={quoteSeconds}
              setMode={setSlipMode}
              setParlayStake={setParlayStake}
              setSelectionStake={setSelectionStake}
              removeSelection={removeSelection}
              clear={() => setSelections([])}
              quickAmount={changeQuickAmount}
              openConfirm={openConfirm}
              go={go}
              walletConnected={walletConnected}
              walletBalanceUsdt={walletBalanceUsdt}
              walletBalanceNative={walletBalanceNative}
              walletCurrency={walletCurrency}
              stakeCurrency={stakeCurrency}
              setStakeCurrency={setStakeCurrency}
              walletFxRate={walletFxRate}
            />
          )}
          {screen === "confirm" && (
            <ConfirmScreen
              selections={selections}
              mode={slipMode}
              totals={slipTotals}
              quoteSeconds={quoteSeconds}
              walletConnected={walletConnected}
              walletAddress={walletAddress}
              walletBalance={walletBalance}
              riskAccepted={riskAccepted}
              setRiskAccepted={setRiskAccepted}
              submitOrder={submitOrder}
              openWallet={() => setWalletDrawerOpen(true)}
              go={go}
              stakeCurrency={stakeCurrency}
              walletFxRate={walletFxRate}
            />
          )}
          {screen === "positions" && <PositionsScreen positions={positions} setSellTarget={setSellTarget} walletAddress={walletAddress} walletBalance={walletBalance} />}
          {screen === "locked" && <LockedScreen go={go} match={selectedMatch} markets={beginnerMarketsForSelectedMatch} walletAddress={walletAddress} walletBalance={walletBalance} />}
          {screen === "create" && <CreateScreen publish={publishCreatedPrediction} />}
          {screen === "invite" && <InviteScreen go={go} created={createdPrediction} />}
          {screen === "circles" && <CirclesScreen go={go} rooms={circleRooms} circleRiskAccepted={circleRiskAccepted} setCircleRiskAccepted={setCircleRiskAccepted} onJoin={joinCircleRoom} />}
          {screen === "orders" && <OrdersScreen orders={orders} go={go} walletAddress={walletAddress} walletBalance={walletBalance} />}
          {screen === "settle" && <SettleScreen walletAddress={walletAddress} walletBalance={walletBalance} />}
          {screen === "profile" && <ProfileScreen walletConnected={walletConnected} setWalletConnected={setWalletConnected} go={go} walletAddress={walletAddress} walletBalance={walletBalance} setWalletAddress={setWalletAddress} setWalletBalance={setWalletBalance} openSettings={() => setSettingsDrawerOpen(true)} />}
          {screen === "manage" && <ManageScreen walletAddress={walletAddress} walletBalance={walletBalance} go={go} />}
          {screen === "agent" && <AgentScreen walletAddress={walletAddress} walletBalance={walletBalance} />}

          {/* Mobile: floating bet slip bar */}
          {showFloatingSlipBar && (
            <div className="min-[1024px]:hidden">
              <BetSlipBar
                selections={selections}
                totals={slipTotals}
                open={() => setBetSlipOpen(true)}
                walletConnected={walletConnected}
                walletBalanceUsdt={walletBalanceUsdt}
                walletBalanceNative={walletBalanceNative}
                stakeCurrency={stakeCurrency}
                walletFxRate={walletFxRate}
              />
            </div>
          )}
        </main>

        {/* Desktop: right sidebar — match info cards (video / stats / events /
            h2h / standings) on top, bet slip below; falls back to promo
            banners when nothing is selected and the slip is empty.
            Each section gets its own `overscroll-contain` so the cart's
            wheel events don't drag the match list (or the video card)
            along when they hit a scroll boundary. The aside itself
            scrolls vertically when its combined content overflows. */}
        <aside className={cx(
          "hidden shrink-0 flex-col overflow-y-auto overscroll-contain border-l border-[var(--cg-separator)] bg-[var(--cg-bg)]",
          showDesktopAside ? "min-[1024px]:flex" : "min-[1024px]:hidden",
          compactDesktopAside ? "w-[280px] max-w-[280px]" : "w-[33.33%] max-w-[400px]"
        )}>
          {showSidebarCards && selectedMatch && (
            <div className="shrink-0">
              <MatchInfoSidebar match={selectedMatch} />
            </div>
          )}
          {showBetSlipPanel ? (
            <div className="flex flex-col">
              <div className="sticky top-0 z-[1] flex h-10 shrink-0 items-center justify-between border-b border-[var(--cg-separator)] bg-[var(--cg-brown-dark)] px-3">
                <span className="text-[13px] font-bold text-white/80">购物车</span>
                <span className="text-[11px] text-[var(--cg-gold)]">{selections.length} 项</span>
              </div>
              <div className="p-3">
                <BetSlipScreen
                  selections={selections}
                  mode={slipMode}
                  totals={slipTotals}
                  parlayStake={parlayStake}
                  quoteSeconds={quoteSeconds}
                  setMode={setSlipMode}
                  setParlayStake={setParlayStake}
                  setSelectionStake={setSelectionStake}
                  removeSelection={removeSelection}
                  clear={() => setSelections([])}
                  quickAmount={changeQuickAmount}
                  openConfirm={openConfirm}
                  go={go}
                  walletConnected={walletConnected}
                  walletBalanceUsdt={walletBalanceUsdt}
                  walletBalanceNative={walletBalanceNative}
                  walletCurrency={walletCurrency}
                  stakeCurrency={stakeCurrency}
                  setStakeCurrency={setStakeCurrency}
                  walletFxRate={walletFxRate}
                />
              </div>
            </div>
          ) : !showSidebarCards ? (
            <PromoBanners />
          ) : null}
        </aside>
      </div>

      {/* Mobile bottom nav intentionally hidden — top navbar covers all entries. */}

      {/* ─── Mobile bet slip slide-up overlay ─── */}
      {betSlipOpen && (
        <div className="fixed inset-0 z-30 min-[1024px]:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setBetSlipOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white shadow-[0_-8px_30px_rgba(0,0,0,.2)]">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--cg-separator)] bg-[var(--cg-brown)] px-4 py-3 rounded-t-2xl">
              <div className="flex min-w-0 flex-col">
                <span className="text-[14px] font-bold text-white">购物车 · {selections.length} 项</span>
                {walletConnected && walletBalanceNative != null ? (
                  <span className="text-[11px] text-[var(--cg-gold)]">
                    可用 {walletBalanceNative.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {walletCurrency}
                    {walletBalanceUsdt != null && (
                      <span className="ml-1 text-white/50">
                        ≈ {walletBalanceUsdt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {curName('USDT')}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-[11px] text-white/60">未登陆 · 下单前请先登陆</span>
                )}
              </div>
              <button type="button" onClick={() => setBetSlipOpen(false)} className="text-white/60 hover:text-white">✕</button>
            </div>
            <div className="p-4">
              <BetSlipScreen
                selections={selections}
                mode={slipMode}
                totals={slipTotals}
                parlayStake={parlayStake}
                quoteSeconds={quoteSeconds}
                setMode={setSlipMode}
                setParlayStake={setParlayStake}
                setSelectionStake={setSelectionStake}
                removeSelection={removeSelection}
                clear={() => setSelections([])}
                quickAmount={changeQuickAmount}
                openConfirm={openConfirm}
                // Any in-overlay navigation must dismiss the slide-up itself,
                // otherwise CTAs like "去选择" will appear unresponsive — the
                // underlying screen does change but the overlay still covers
                // the viewport.
                go={(s) => { setBetSlipOpen(false); go(s); }}
                walletConnected={walletConnected}
                walletBalanceUsdt={walletBalanceUsdt}
                walletBalanceNative={walletBalanceNative}
                walletCurrency={walletCurrency}
                stakeCurrency={stakeCurrency}
                setStakeCurrency={setStakeCurrency}
                walletFxRate={walletFxRate}
              />
            </div>
          </div>
        </div>
      )}

      {/* ─── Overlays ─── */}
      {toast && <Toast message={toast} clear={() => setToast("")} />}
      {walletDrawerOpen && (
        <LoginDrawer
          close={() => setWalletDrawerOpen(false)}
          login={async ({ username, password }) => {
            try {
              const resp = await pmppmApi.login({ username, password });
              if (resp.must_change && resp.change_reason) {
                // First-login: must set loginname or change password before proceeding
                applyAccountState(resp.user);
                setWalletDrawerOpen(false);
                setMustChangeReason(resp.change_reason);
              } else {
                applyAccountState(resp.user);
                setWalletDrawerOpen(false);
                const cur = (resp.user.currency || 'USDT').toUpperCase();
                const native = typeof resp.user.credit_balance_raw === 'number'
                  ? resp.user.credit_balance_raw
                  : resp.user.credit_balance;
                const usdtPart = cur === 'USDT'
                  ? ''
                  : ` ≈ ${formatCreditAmount(resp.user.credit_balance)} USDT`;
                setToast(
                  `已登陆 ${resp.user.username} · 授权信用 ${formatCreditAmount(native)} ${cur}${usdtPart}`,
                );
              }
            } catch (err) {
              const msg = err instanceof ApiError && err.status === 401
                ? "用户名或密码错误"
                : err instanceof ApiError
                  ? `登陆失败：${err.status} ${err.body || err.message}`
                  : err instanceof Error
                    ? `登陆失败：${err.message}`
                    : "登陆失败";
              setToast(msg);
            }
          }}
        />
      )}
      {mustChangeReason && (
        <MustChangeDrawer
          reason={mustChangeReason}
          onComplete={(newUsername?: string) => {
            setMustChangeReason('');
            if (newUsername) {
              setWalletAddress((prev) => prev.replace(/·\s*\S+$/, `· ${newUsername}`));
            }
            setToast('账户设置完成，欢迎使用！');
          }}
          setToast={setToast}
        />
      )}
      {sellTarget && <SellDrawer target={sellTarget} percent={sellPercent} setPercent={setSellPercent} close={() => setSellTarget(null)} confirm={confirmSell} />}
      {/* ─── Settings right-drawer (mirrors old PHP side panel) ─── */}
      {settingsDrawerOpen && (() => {
        // 语言 and 盘口类型 are locked (see useState defaults above) so
        // the labels below are static rather than derived from prefLang /
        // prefMarket — keeps the drawer readable even if a future build
        // reintroduces other values.
        const langLabel = '简体中文';
        const marketLabel = '欧洲盘';
        const timeLabel = prefTime === 'sysTime' ? '系统时间' : '当地时间';
        const cycle = <T extends string>(arr: readonly T[], cur: T): T => arr[(arr.indexOf(cur) + 1) % arr.length];
        return (
          <div className="fixed inset-0 z-[50]">
            <div className="absolute inset-0 bg-black/40" onClick={() => setSettingsDrawerOpen(false)} />
            <div className="absolute inset-y-0 right-0 w-[340px] max-w-[85vw] overflow-y-auto bg-white shadow-[-8px_0_30px_rgba(0,0,0,.15)]">
              <div className="flex items-center justify-between border-b border-[var(--cg-border)] bg-[var(--cg-brown)] px-4 py-3">
                <div>
                  <p className="text-[13px] font-bold text-white">{walletAddress || "未登陆"}</p>
                  <p className="text-[12px] text-[var(--cg-gold)]">{walletBalance || "—"}</p>
                </div>
                <button type="button" onClick={() => setSettingsDrawerOpen(false)} className="text-[20px] text-white/60 hover:text-white">✕</button>
              </div>
              <div className="space-y-1 px-2 py-3">
                <SettingsDrawerItem icon="📋" label="帐户历史" onClick={() => { setSettingsDrawerOpen(false); go("orders"); }} />
              </div>
              <div className="border-t border-[var(--cg-border)] px-4 py-2">
                <h4 className="text-[13px] font-black text-[var(--cg-text-56)]">设定</h4>
              </div>
              <div className="space-y-1 px-2 pb-3">
                <SettingsDrawerItem
                  icon="🌐"
                  label="语言"
                  detail={langLabel}
                />
                <SettingsDrawerItem
                  icon="📐"
                  label="盘口类型"
                  detail={marketLabel}
                />
                <SettingsDrawerToggle
                  icon="📈"
                  label="赔率显示模式"
                  detail="启动赔率更新提醒"
                  checked={prefOddsNotify}
                  onChange={(v) => updatePref('cg_pref_odds_notify', v, setPrefOddsNotify)}
                />
                <SettingsDrawerItem
                  icon="🕒"
                  label="开赛时间显示"
                  detail={timeLabel}
                  onClick={() => updatePref('cg_pref_time', cycle(['sysTime', 'devTime'] as const, prefTime), setPrefTime)}
                />
                <SettingsDrawerItem
                  icon="⚙️"
                  label="详细设定 (旧版)"
                  onClick={() => { window.location.href = '/member/account_set'; }}
                />
              </div>
              {walletConnected && (
                <div className="border-t border-[var(--cg-border)] px-4 py-3">
                  <button
                    type="button"
                    onClick={async () => {
                      setSettingsDrawerOpen(false);
                      try { await pmppmApi.logout(); } catch { /* ignore */ }
                      setWalletConnected(false);
                      setWalletAddress("");
                      setWalletBalance("");
                      setToast("已退出登陆");
                    }}
                    className="w-full rounded-lg border border-[#fecaca] bg-[#fef2f2] py-2.5 text-[13px] font-black text-[#dc2626] hover:bg-[#fee2e2]"
                  >
                    退出登陆
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
      <span className="sr-only">{selectedScreenTitle}</span>
    </div>
    </GoBackContext.Provider>
  );
}

function AppHeader({
  title,
  back,
}: {
  title: string;
  walletAddress?: string;
  walletBalance?: string;
  back?: () => void;
}) {
  const ctxGoBack = useContext(GoBackContext);
  const backFn: (() => void) | null = back ?? ctxGoBack;
  return (
    <div className="flex h-12 items-center gap-2 border-b border-[var(--cg-separator)] bg-[var(--cg-bg-light)] px-3">
      {backFn && (
        <button type="button" onClick={backFn} className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-[var(--cg-border)] bg-white px-3 text-[13px] font-black text-[var(--cg-brown)] shadow-sm active:scale-[0.98]">
          <span className="text-[22px] leading-none">‹</span>
          <span>返回</span>
        </button>
      )}
      <span className="truncate text-[15px] font-black text-[var(--cg-text-72)]">{title}</span>
    </div>
  );
}

// Empty / loading placeholder when no match has been selected yet — used by
// the football and pro screens so they never render with `match=null`.
function NoMatchPicked({ go, loading, error }: { go: (screen: Screen) => void; loading: boolean; error: string | null }) {
  return (
    <>
      <AppHeader title="足球场次" walletAddress="" />
      <div className="space-y-3 p-4">
        <Card className="text-center">
          <h3 className="text-[16px] font-black">
            {loading ? "正在加载 Crown 赛事…" : error ? "后端连接失败" : "请先选一场比赛"}
          </h3>
          <p className="mx-auto mt-2 max-w-[260px] text-[12px] leading-5 text-[var(--cg-text-56)]">
            {loading
              ? "数据来自 crown-explorer /api/matches。"
              : error
                ? error
                : "赛事、盘口、赔率均从 Crown DB 实时读取。"}
          </p>
          {!loading && (
            <div className="mt-4"><Button onClick={() => go("footballList")}>返回赛事列表</Button></div>
          )}
        </Card>
      </div>
    </>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={cx("max-w-full overflow-hidden rounded-lg border border-[var(--cg-border)] bg-[var(--cg-card)] p-4 shadow-sm", className)}>{children}</section>;
}

function Chip({ children, tone = "soft" }: { children: ReactNode; tone?: "soft" | "blue" | "green" | "red" | "orange" | "purple" }) {
  const tones = {
    soft: "bg-[var(--cg-bg-light)] text-[var(--cg-text-56)]",
    blue: "bg-[var(--cg-brown)]/10 text-[var(--cg-brown)]",
    green: "bg-[var(--cg-green)]/10 text-[var(--cg-green)]",
    red: "bg-[var(--cg-red)]/10 text-[var(--cg-red)]",
    orange: "bg-[var(--cg-gold)]/15 text-[var(--cg-gold-deep)]",
    purple: "bg-[#f3e8ff] text-[#7c3aed]",
  };
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold", tones[tone])}>{children}</span>;
}

function Button({ children, onClick, disabled = false, variant = "primary", full = false }: { children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: "primary" | "soft" | "green" | "red"; full?: boolean }) {
  const variants = {
    primary: "bg-[var(--cg-green)] text-white hover:bg-[var(--cg-green)]/90",
    soft: "border border-[var(--cg-border)] bg-[var(--cg-card)] text-[var(--cg-text-64)] hover:border-[var(--cg-brown)]",
    green: "bg-[var(--cg-green)]/10 text-[var(--cg-green)]",
    red: "bg-[var(--cg-red)]/10 text-[var(--cg-red)]",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx("inline-flex min-w-0 items-center justify-center whitespace-nowrap rounded-lg px-4 py-2.5 text-[13px] font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45", variants[variant], full && "w-full")}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// League regions for the homepage league selector — matches original SPA
// ---------------------------------------------------------------------------
type LeagueItem = { id: string; name: string; aliases?: string[] };
type LeagueRegion = { id: string; name: string; flag: string; leagues: LeagueItem[] };

// `aliases` list the league_slug / league_name fragments returned by the
// backend so that the DiscoverScreen filter can match a check-boxed league
// against the live event list. Without aliases the league is decorative
// only (no matching events served yet).
//
// As of 2026-05-28 this hard-coded list is a *fallback* only: at runtime
// the H5 fetches /api/external/leagues/catalog and replaces it with the
// dynamic registry tree (see SportsPage.leagueRegions state below).  The
// fallback ships the legacy 9 leagues so the page renders meaningfully
// before the network call completes (and survives an outage).
const FALLBACK_LEAGUE_REGIONS: LeagueRegion[] = [
  { id: "europe", name: "欧洲", flag: "🌍", leagues: [
    { id: "ucl", name: "欧洲冠军联赛", aliases: ["champions-league", "uefa champions", "欧冠"] },
    { id: "uel", name: "欧洲联赛", aliases: ["europa-league", "uefa europa", "欧联"] },
  ]},
  { id: "worldcup", name: "世界杯", flag: "🏆", leagues: [
    { id: "wc2026", name: "世界杯2026(美加墨)", aliases: ["world-cup", "fifa world cup", "世界杯"] },
  ]},
  { id: "england", name: "英格兰", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", leagues: [
    { id: "epl", name: "英格兰超级联赛", aliases: ["england-premier-league", "premier league", "英超"] },
  ]},
  { id: "germany", name: "德国", flag: "🇩🇪", leagues: [
    { id: "bundesliga", name: "德国甲级联赛", aliases: ["germany-bundesliga", "bundesliga", "德甲"] },
  ]},
  { id: "spain", name: "西班牙", flag: "🇪🇸", leagues: [
    { id: "laliga", name: "西班牙甲级联赛", aliases: ["spain-laliga", "spain-la-liga", "la liga", "西甲"] },
  ]},
  { id: "italy", name: "意大利", flag: "🇮🇹", leagues: [
    { id: "serie-a", name: "意大利甲级联赛", aliases: ["italy-serie-a", "serie a", "意甲"] },
  ]},
  { id: "france", name: "法国", flag: "🇫🇷", leagues: [
    { id: "ligue-1", name: "法国甲级联赛", aliases: ["france-ligue-1", "ligue 1", "法甲"] },
  ]},
  { id: "china", name: "中国", flag: "🇨🇳", leagues: [
    { id: "csl", name: "中国超级联赛", aliases: ["china-chinese-super-league", "chinese super league", "中超"] },
  ]},
];

/** Project the backend `/leagues/catalog` payload into the `LeagueRegion[]`
 *  shape the DiscoverScreen and filter helpers consume.  Each backend
 *  country becomes one front-end LeagueRegion (so the user sees country
 *  cards: 英格兰, 巴西, 中国, ...).  The "international" backend region
 *  collapses into a single 国际 region card containing UCL/UEL/世界杯 etc.
 *
 *  ``maxPriority`` lets callers cap the catalog so the very long tail of
 *  reserves/U21/lower-division leagues doesn't drown the picker; pass
 *  Infinity to render the full ~417 leagues. */
function catalogToRegions(
  catalog: import("@/lib/api").LeagueCatalogResp | null,
  maxPriority: number = 50,
): LeagueRegion[] {
  if (!catalog) return FALLBACK_LEAGUE_REGIONS;
  const out: LeagueRegion[] = [];
  // translateLeague(slug, fallback) checks the frontend LEAGUE_CN map first
  // (curated short forms like "意甲"), then falls back to the backend's
  // name_cn (full form like "意大利甲级联赛"), then English name_en.  This
  // way the discover screen never shows a raw English league header.
  for (const region of catalog.regions) {
    if (region.id === "international") {
      // Collapse all intl' competitions into one card.
      const leagues: LeagueItem[] = [];
      for (const country of region.countries) {
        for (const lg of country.leagues) {
          if (lg.priority > maxPriority) continue;
          leagues.push({
            id:      `slug:${lg.slug}`,
            name:    translateLeague(lg.slug, lg.name_cn || lg.name_en || lg.slug),
            aliases: [lg.slug, lg.name_en || "", lg.name_cn || ""].filter(Boolean),
          });
        }
      }
      if (leagues.length > 0) {
        out.push({ id: region.id, name: region.name_cn || region.name_en, flag: region.flag, leagues });
      }
      continue;
    }
    for (const country of region.countries) {
      const leagues: LeagueItem[] = [];
      for (const lg of country.leagues) {
        if (lg.priority > maxPriority) continue;
        leagues.push({
          id:      `slug:${lg.slug}`,
          name:    translateLeague(lg.slug, lg.name_cn || lg.name_en || lg.slug),
          aliases: [lg.slug, lg.name_en || "", lg.name_cn || ""].filter(Boolean),
        });
      }
      if (leagues.length === 0) continue;
      out.push({
        id:     country.id,
        name:   country.name_cn || country.name_en,
        flag:   country.flag || region.flag,
        leagues,
      });
    }
  }
  // Pin core European + WC + CSL countries near the top so the
  // historical 9 leagues stay above the long tail; everything else
  // falls through alphabetically by Chinese name.
  const PIN_ORDER = ["international", "england", "italy", "spain", "germany", "france", "china"];
  out.sort((a, b) => {
    const ai = PIN_ORDER.indexOf(a.id), bi = PIN_ORDER.indexOf(b.id);
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    }
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });
  return out;
}

/** Build the set of slug/name aliases for the given checked league ids
 *  against an arbitrary regions tree (so callers can pass either the
 *  fallback or the dynamic catalog-derived list).  Pre-2026-05-28 this
 *  function read from a module-level `leagueRegions` constant.
 */
function buildLeagueAliasSet(
  checkedLeagueIds: Set<string>,
  regions: LeagueRegion[] = FALLBACK_LEAGUE_REGIONS,
): Set<string> {
  const out = new Set<string>();
  if (checkedLeagueIds.size === 0) return out;
  for (const region of regions) {
    for (const lg of region.leagues) {
      if (!checkedLeagueIds.has(lg.id)) continue;
      out.add(lg.name.toLowerCase());
      out.add(lg.id.toLowerCase());
      if (lg.aliases) for (const a of lg.aliases) out.add(a.toLowerCase());
    }
  }
  return out;
}

function matchInSelectedLeagues(m: FootballMatch, aliasSet: Set<string>): boolean {
  if (aliasSet.size === 0) return true;
  const slug = (m.leagueSlug ?? "").toLowerCase();
  const name = (m.leagueName ?? "").toLowerCase();
  const stage = (m.stage ?? "").toLowerCase();
  for (const a of aliasSet) {
    if (!a) continue;
    if (slug && (slug === a || slug.includes(a) || a.includes(slug))) return true;
    if (name && (name === a || name.includes(a) || a.includes(name))) return true;
    if (stage && (stage === a || stage.includes(a) || a.includes(stage))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Generate 7-day date buttons from today (in the *user's local timezone* —
// never UTC, otherwise the pills and matches disagree across the day boundary
// for users east of UTC).
// ---------------------------------------------------------------------------
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function buildDateButtons(): Array<{ key: string; weekday: string; date: number; month: string }> {
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const months = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
  const result: Array<{ key: string; weekday: string; date: number; month: string }> = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    result.push({
      key: localDateKey(d),
      weekday: weekdays[d.getDay()],
      date: d.getDate(),
      month: months[d.getMonth()],
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// DiscoverScreen — Crown Gold SPA homepage layout
// Sub-tabs (赛事/冠军/梦幻赛) + date picker + regional league groups
// ---------------------------------------------------------------------------
function DiscoverScreen({
  go,
  matches,
  checkedLeagueIds,
  setCheckedLeagueIds,
  activeSubTab,
  setActiveSubTab,
  setFootballFilter,
  activeDate,
  setActiveDate,
  outrightEvents,
  onPickOutrightOutcome,
  selectedOutcomeIds,
  leagueRegions,
  dailyCounts,
}: {
  go: (screen: Screen) => void;
  matches: FootballMatch[];
  checkedLeagueIds: Set<string>;
  setCheckedLeagueIds: (s: Set<string>) => void;
  activeSubTab: "events" | "outrights" | "fantasy";
  setActiveSubTab: (tab: "events" | "outrights" | "fantasy") => void;
  setFootballFilter: (f: FootballListFilter) => void;
  activeDate: string;
  setActiveDate: (d: string) => void;
  outrightEvents: OutrightEvent[];
  onPickOutrightOutcome: (opt: OutcomeOption) => void;
  selectedOutcomeIds: Set<string>;
  /** Region tree to render — comes from SportsPage state, normally
   *  populated from /api/external/leagues/catalog with the legacy 9
   *  hard-coded leagues as fallback before the network lands. */
  leagueRegions: LeagueRegion[];
  dailyCounts: import("@/lib/api").LeagueDailyCountsResp | null;
}) {
  const checkedLeagues = checkedLeagueIds;
  const dateButtons = useMemo(() => buildDateButtons(), []);
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

  // Pre-compute, for every league id we know about, both:
  //   leagueDates[leagueId]      = Set<dateKey> with ≥1 pending match
  //   leagueDateCounts[leagueId] = Map<dateKey, count>  (per-day tally)
  // Single O(matches × leagues) scan; keeps per-render cost predictable.
  const { leagueDates, leagueDateCounts } = useMemo<{
    leagueDates: Map<string, Set<string>>;
    leagueDateCounts: Map<string, Map<string, number>>;
  }>(() => {
    const dates = new Map<string, Set<string>>();
    const counts = new Map<string, Map<string, number>>();
    for (const region of leagueRegions) {
      for (const lg of region.leagues) {
        dates.set(lg.id, new Set<string>());
        counts.set(lg.id, new Map<string, number>());
      }
    }

    if (dailyCounts && dailyCounts.counts) {
      for (const region of leagueRegions) {
        for (const lg of region.leagues) {
          const datesSet = new Set<string>();
          const countsMap = new Map<string, number>();
          const slug = lg.id.startsWith("slug:") ? lg.id.substring(5).toLowerCase() : lg.id.toLowerCase();
          const leagueData = dailyCounts.counts[slug] || {};
          for (const [dKey, count] of Object.entries(leagueData)) {
            if (count > 0) {
              datesSet.add(dKey);
              countsMap.set(dKey, count);
            }
          }
          dates.set(lg.id, datesSet);
          counts.set(lg.id, countsMap);
        }
      }
      return { leagueDates: dates, leagueDateCounts: counts };
    }

    for (const m of matches) {
      if (m.rawStatus !== "pending") continue;
      const slug = (m.leagueSlug ?? "").toLowerCase();
      const name = (m.leagueName ?? "").toLowerCase();
      const stage = (m.stage ?? "").toLowerCase();
      const dKey = localDateKey(new Date((m.commenceTs ?? 0) * 1000));
      for (const region of leagueRegions) {
        for (const lg of region.leagues) {
          const aliases = [lg.name.toLowerCase(), lg.id.toLowerCase(), ...((lg.aliases ?? []).map((a) => a.toLowerCase()))];
          const hit = aliases.some((a) => {
            if (!a) return false;
            if (slug && (slug === a || slug.includes(a) || a.includes(slug))) return true;
            if (name && (name === a || name.includes(a) || a.includes(name))) return true;
            if (stage && (stage === a || stage.includes(a) || a.includes(stage))) return true;
            return false;
          });
          if (!hit) continue;
          dates.get(lg.id)!.add(dKey);
          const c = counts.get(lg.id)!;
          c.set(dKey, (c.get(dKey) ?? 0) + 1);
        }
      }
    }
    return { leagueDates: dates, leagueDateCounts: counts };
  }, [matches, leagueRegions, dailyCounts]);

  // Total match count for a league under the current activeDate filter.
  // Used both to gate league visibility and to render the count badge.
  const countForLeague = (leagueId: string): number => {
    const c = leagueDateCounts.get(leagueId);
    if (!c) return 0;
    if (activeDate === "all") {
      let n = 0; for (const v of c.values()) n += v; return n;
    }
    if (activeDate === "future") {
      const todayKey = localDateKey(new Date());
      let n = 0;
      for (const [dk, v] of c.entries()) if (dk > todayKey) n += v;
      return n;
    }
    return c.get(activeDate) ?? 0;
  };

  const matchesOnActiveDate = useMemo<FootballMatch[]>(() => {
    return matches.filter((m) => {
      if (m.rawStatus !== "pending") return false;
      if (activeDate === "all") return true;
      return localDateKey(new Date((m.commenceTs ?? 0) * 1000)) === activeDate;
    });
  }, [matches, activeDate]);

  const totalEvents = matchesOnActiveDate.length;
  // Header badge label. When a specific date pill is active, show that
  // date; for "future" we say "未来 7 天+"; for "all" we say "全部日期"
  // so the badge doesn't masquerade as if today's filter was applied.
  const headerLabel = useMemo(() => {
    if (activeDate === "all") return "全部日期";
    if (activeDate === "future") return "未来 7 天+";
    const [y, m, d] = activeDate.split("-").map((s) => parseInt(s, 10));
    if (!y || !m || !d) return "全部日期";
    const dt = new Date(y, m - 1, d);
    return `${dt.getMonth() + 1}月${dt.getDate()}日 ${weekdays[dt.getDay()]}`;
  }, [activeDate, weekdays]);

  const toggleLeague = (id: string) => {
    const next = new Set(checkedLeagueIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setCheckedLeagueIds(next);
  };

  const subTabs = [
    { id: "events" as const, label: "赛事" },
    { id: "outrights" as const, label: "冠军" },
  ];

  return (
    <div className="min-h-full">
      {/* Section header: 早盘 / 足球 */}
      <div className="border-b border-[var(--cg-separator)] bg-[var(--cg-bg)] px-4 pb-0 pt-3">
        <p className="text-[11px] text-[var(--cg-text-56)]">早盘</p>
        <h1 className="text-[20px] font-black leading-8">足球</h1>
        {/* Sub-tabs */}
        <div className="mt-2 flex gap-4">
          {subTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              className={cx(
                "border-b-2 pb-2 text-[13px] font-bold transition",
                activeSubTab === tab.id
                  ? "border-[var(--cg-gold)] text-[var(--cg-gold-deep)]"
                  : "border-transparent text-[var(--cg-text-56)] hover:text-[var(--cg-gold-deep)]"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeSubTab === "events" && (
        <>
          {/* Date picker strip */}
          <div className="flex items-center gap-0 overflow-x-auto border-b border-[var(--cg-separator)] bg-white px-2 no-scrollbar">
            <button
              type="button"
              onClick={() => setActiveDate("all")}
              className={cx(
                "shrink-0 rounded-md px-3 py-2.5 text-[12px] font-bold transition",
                activeDate === "all"
                  ? "bg-[var(--cg-gold)] text-white"
                  : "text-[var(--cg-text-64)] hover:text-[var(--cg-gold-deep)]"
              )}
            >
              所有日期
            </button>
            {dateButtons.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => setActiveDate(d.key)}
                className={cx(
                  "flex shrink-0 flex-col items-center rounded-md px-3 py-1.5 text-center transition",
                  activeDate === d.key
                    ? "ring-2 ring-[var(--cg-gold)] text-[var(--cg-gold-deep)]"
                    : "text-[var(--cg-text-56)] hover:text-[var(--cg-gold-deep)]"
                )}
              >
                <span className="text-[11px]">{d.weekday}</span>
                <span className="text-[16px] font-black">{d.date}</span>
                <span className="text-[10px]">{d.month}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setActiveDate("future")}
              className={cx(
                "flex shrink-0 flex-col items-center rounded-md px-3 py-1.5 text-center transition",
                activeDate === "future"
                  ? "ring-2 ring-[var(--cg-gold)] text-[var(--cg-gold-deep)]"
                  : "text-[var(--cg-text-56)] hover:text-[var(--cg-gold-deep)]"
              )}
            >
              <span className="text-[11px]">未来</span>
              <span className="text-[16px] font-black">7+</span>
              <span className="text-[10px]">天</span>
            </button>
          </div>

          {/* Active-date header badge. Brown bg shows the chosen window
             (single date / 未来 / 全部); the inner gold chip carries the
             absolute match count under that window. */}
          <div className="bg-white px-4 py-2">
            <span className="inline-flex items-center gap-2 rounded bg-[var(--cg-brown)] px-3 py-1.5 text-[11px] font-bold text-white">
              {headerLabel}
              <span className="rounded bg-[var(--cg-gold)] px-1.5 py-0.5 text-[10px] font-black text-white">
                所有赛事 &nbsp;{totalEvents}
              </span>
            </span>
          </div>

          {/* League list grouped by region — 2-column checkboxes for events.
             A league only renders if it has at least one pending match on
             the active date (or, when `activeDate==='all'`, on any date).
             Empty regions collapse entirely so the user isn't shown
             leagues with nothing to bet on. */}
          <div className="bg-white">
            {leagueRegions.map((region) => {
              const visibleLeagues = region.leagues.filter((lg) => {
                const dates = leagueDates.get(lg.id);
                if (!dates) return false;
                if (activeDate === "all") return dates.size > 0;
                if (activeDate === "future") {
                  const todayKey = localDateKey(new Date());
                  return Array.from(dates).some((dk) => dk > todayKey);
                }
                return dates.has(activeDate);
              });
              if (visibleLeagues.length === 0) return null;
              return (
                <div key={region.id} className="border-b border-[var(--cg-separator)]">
                  <div className="flex items-center gap-2 px-4 py-2.5">
                    <span className="text-[16px]">{region.flag}</span>
                    <h3 className="text-[14px] font-black text-[var(--cg-text)]">{region.name}</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-0 px-4 pb-3">
                    {visibleLeagues.map((league) => {
                      const n = countForLeague(league.id);
                      return (
                        <label
                          key={league.id}
                          onClick={() => toggleLeague(league.id)}
                          className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-2 text-[13px] text-[var(--cg-text)] transition hover:bg-[var(--cg-bg-light)]"
                        >
                          <span
                            className={cx(
                              "flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 transition",
                              checkedLeagues.has(league.id)
                                ? "border-[var(--cg-gold)] bg-[var(--cg-gold)]"
                                : "border-[#c4c4c4] bg-white"
                            )}
                          >
                            {checkedLeagues.has(league.id) && (
                              <svg viewBox="0 0 12 12" className="size-2.5 fill-white"><path d="M10 3L4.5 8.5 2 6" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            )}
                          </span>
                          <span className="leading-5">{league.name}</span>
                          {n > 0 && (
                            <span className="ml-1 rounded bg-[var(--cg-bg-light)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--cg-text-56)]">
                              {n}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {/* If no league has matches on the chosen date show a friendly
               empty state instead of a blank panel. */}
            {leagueRegions.every((r) => r.leagues.every((lg) => {
              const dates = leagueDates.get(lg.id);
              if (!dates || dates.size === 0) return true;
              if (activeDate === "all") return false;
              if (activeDate === "future") {
                const todayKey = localDateKey(new Date());
                return !Array.from(dates).some((dk) => dk > todayKey);
              }
              return !dates.has(activeDate);
            })) && (
              <div className="px-4 py-12 text-center text-[12px] text-[var(--cg-text-56)]">
                <p className="font-bold text-[14px] text-[var(--cg-text)]">该日期暂无赛事</p>
                <p className="mt-2">请选择其他日期或点击「所有日期」查看全部赛事。</p>
              </div>
            )}
          </div>

          {/* Enter matches button (for checked leagues or all) */}
          <div className="bg-white px-4 py-4">
            <button
              type="button"
              onClick={() => {
                setFootballFilter("all");
                if (checkedLeagues.size === 0) setActiveDate("all");
                go("footballList");
              }}
              className="w-full rounded-lg bg-[var(--cg-green)] py-3 text-center text-[14px] font-bold text-white transition hover:bg-[var(--cg-green)]/90 active:scale-[0.99]"
            >
              {checkedLeagues.size > 0 ? `查看已选 ${checkedLeagues.size} 个联赛赛事` : "查看所有赛事"}
            </button>
          </div>
        </>
      )}

      {activeSubTab === "outrights" && (
        <OutrightsSubTab
          events={outrightEvents}
          onPickOutcome={onPickOutrightOutcome}
          selectedOutcomeIds={selectedOutcomeIds}
        />
      )}

      {activeSubTab === "fantasy" && (
        <div className="bg-white px-4 py-12 text-center text-[12px] text-[var(--cg-text-56)]">
          梦幻赛功能开发中，敬请期待。
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OutrightsSubTab — 冠军 page body. Renders one card per OutrightEvent
// (e.g. FIFA World Cup Winner) with the top contenders as clickable
// odds pills that drop into the same BetSlip the regular markets use.
// When the upstream feed has no outright events configured / available
// (e.g. THEODDSAPI_KEY not set), the panel collapses to a friendly
// "待开放" empty state — same UX as before the feed was wired.
//
// NOTE 2026-05-24: A second source (Crown's `sfs_match` table) was
// briefly wired here to expose the operator-facing 56-market catalog
// (Top Goalscorer, Group X Winner / To Qualify, etc.).  We removed it
// because that table is a frozen dump from March 2026 with no live
// upstream — exposing it risked stale-odds arbitrage.  See
// `mysqldb.crown_outrights()` (kept dormant) for the data shape.
// ---------------------------------------------------------------------------
function OutrightsSubTab({
  events,
  onPickOutcome,
  selectedOutcomeIds,
}: {
  events: OutrightEvent[];
  onPickOutcome: (opt: OutcomeOption) => void;
  selectedOutcomeIds: Set<string>;
}) {
  if (events.length === 0) {
    return (
      <div className="bg-white px-4 py-16 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-[var(--cg-bg-light)] text-[28px]">
          🏆
        </div>
        <p className="text-[16px] font-black text-[var(--cg-text)]">待开放</p>
        <p className="mt-2 text-[12px] text-[var(--cg-text-56)]">
          冠军盘口尚未开放投注，敬请期待。
        </p>
      </div>
    );
  }
  return (
    <div className="bg-white">
      {events.map((ev) => (
        <OutrightEventCard
          key={ev.id}
          event={ev}
          onPickOutcome={onPickOutcome}
          selectedOutcomeIds={selectedOutcomeIds}
        />
      ))}
    </div>
  );
}

function OutrightEventCard({
  event,
  onPickOutcome,
  selectedOutcomeIds,
}: {
  event: OutrightEvent;
  onPickOutcome: (opt: OutcomeOption) => void;
  selectedOutcomeIds: Set<string>;
}) {
  const titleZh = translateOutrightTitle(event.sport_title);
  const startIso = event.commence_time;
  const startLabel = startIso ? formatOutrightDate(startIso) : "";
  const totalOutcomes = event.outcomes.length;

  // FIFA World Cup outright: backend tagged each outcome with a group
  // letter ("A".."L") derived from foot_match fixtures.  Render the 48
  // teams as 12 sections of 4 so the user can pick by group instead of
  // scrolling a flat 48-pill grid.  Other sport keys without group
  // structure fall back to the flat top-12-then-expand layout below.
  const hasGroups = event.outcomes.some((o) => typeof o.group === "string" && o.group);
  const [expanded, setExpanded] = useState(false);

  // Renders a single outright pill — re-used by both layouts.
  // Translation lookup tries `canonical_name` first because that's what
  // the i18n map is keyed on (FIFA short names like "Bosnia and
  // Herzegovina" / "Turkiye"), then falls back to vendor `name`
  // ("Bosnia & Herzegovina" / "Turkey").  Without the canonical
  // fallback the pill would render the raw English name when the vendor
  // spelling diverges from the FIFA one (image #4 bug, 2026-05-24).
  const renderPill = (o: typeof event.outcomes[number]) => {
    const teamZh =
      translateTeam(o.canonical_name ?? "") ||
      translateTeam(o.name) ||
      o.name;
    const optionId = `outright:${event.id}:${o.name}`;
    const option: OutcomeOption = {
      id: optionId,
      marketId: `outright_${event.sport_key}`,
      marketTitle: titleZh,
      eventId: event.id,
      title: `${titleZh} · 冠军`,
      label: teamZh,
      odds: o.price,
      field: o.name,
      version: 0,
    };
    const selected = selectedOutcomeIds.has(optionId);
    return (
      <button
        key={optionId}
        type="button"
        onClick={() => onPickOutcome(option)}
        className={cx(
          "flex items-center justify-between rounded-lg border px-3 py-2 text-left transition",
          selected
            ? "border-[var(--cg-gold)] bg-[var(--cg-gold)]/10"
            : "border-[var(--cg-separator)] bg-white hover:border-[var(--cg-gold)]/60"
        )}
      >
        <span className="truncate text-[13px] font-bold text-[var(--cg-text)]">{teamZh}</span>
        <span className="ml-2 shrink-0 text-[14px] font-black text-[var(--cg-red)]">
          {o.price.toFixed(2)}
        </span>
      </button>
    );
  };

  return (
    <div className="border-b border-[var(--cg-separator)]">
      <div className="flex items-center justify-between gap-2 bg-[var(--cg-bg-light)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[16px]">🏆</span>
          <h3 className="text-[14px] font-black text-[var(--cg-text)]">{titleZh}</h3>
          {hasGroups ? (
            <span className="ml-1 text-[11px] text-[var(--cg-text-56)]">{totalOutcomes} 支球队 · 12 组</span>
          ) : null}
        </div>
        <div className="text-[11px] text-[var(--cg-text-56)]">
          {startLabel ? `开赛 ${startLabel}` : ""}
        </div>
      </div>
      {hasGroups ? (
        <div className="space-y-3 p-3">
          {(() => {
            // Bucket outcomes by group letter, preserving the
            // backend's price-ascending order within each bucket.
            const buckets = new Map<string, typeof event.outcomes>();
            for (const o of event.outcomes) {
              const g = (typeof o.group === "string" && o.group) ? o.group : "?";
              const arr = buckets.get(g) ?? [];
              arr.push(o);
              buckets.set(g, arr);
            }
            const labels = Array.from(buckets.keys()).sort();
            return labels.map((label) => {
              const teams = buckets.get(label) ?? [];
              return (
                <div key={label} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--cg-gold)]/15 text-[12px] font-black text-[var(--cg-gold-deep)]">{label}</span>
                    <span className="text-[12px] font-bold text-[var(--cg-text)]">小组 {label}</span>
                    <span className="text-[11px] text-[var(--cg-text-56)]">{teams.length} 队</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {teams.map(renderPill)}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
            {(expanded ? event.outcomes : event.outcomes.slice(0, 12)).map(renderPill)}
          </div>
          {totalOutcomes > 12 && (
            <div className="px-4 pb-3">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="w-full rounded-md border border-[var(--cg-separator)] bg-white py-2 text-center text-[12px] font-bold text-[var(--cg-gold-deep)] transition hover:bg-[var(--cg-bg-light)]"
              >
                {expanded ? "收起" : `查看全部 ${totalOutcomes} 支球队`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Curated translations for outright sport_title strings. Falls back to
// the original English when no mapping exists so we never silently drop
// content when a new sport is added on the backend.
function translateOutrightTitle(en: string): string {
  const map: Record<string, string> = {
    "FIFA World Cup Winner":           "FIFA 世界杯冠军 2026",
    "NFL Super Bowl Winner":           "NFL 超级碗冠军",
    "NBA Championship Winner":         "NBA 总冠军",
    "NHL Championship Winner":         "NHL 斯坦利杯冠军",
    "MLB World Series Winner":         "MLB 世界大赛冠军",
    "NCAAF Championship Winner":       "NCAAF 冠军",
    "The Open Winner":                 "公开锦标赛 (高尔夫) 冠军",
    "US Open Winner":                  "美国公开赛 (高尔夫) 冠军",
    "US Presidential Elections Winner": "美国总统大选获胜者",
  };
  return map[en] ?? en;
}

function formatOutrightDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}

// ---------------------------------------------------------------------------
// PromoBanners — right sidebar on desktop (matches original SPA layout)
// ---------------------------------------------------------------------------
function PromoBanners() {
  return (
    <div className="space-y-3 p-3">
      {/* Banner 1: 电竞赛事 */}
      <div className="overflow-hidden rounded-lg bg-gradient-to-br from-[#1a1a2e] to-[#16213e] p-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-[18px] font-black text-white">电竞赛事</h3>
            <p className="mt-0.5 text-[12px] font-bold text-[var(--cg-gold)]">新推出</p>
            <ul className="mt-3 space-y-1 text-[12px] leading-5 text-white/70">
              <li>▸ 更多赛事和盘口</li>
              <li>▸ 新的滚球计分板</li>
            </ul>
          </div>
          <div className="size-16 rounded-lg bg-white/10" />
        </div>
      </div>
      {/* Banner 2: 热门赛事 */}
      <div className="overflow-hidden rounded-lg bg-gradient-to-br from-[#0f2027] to-[#203a43] p-4">
        <h3 className="text-[18px] font-black text-white">热门赛事</h3>
        <p className="mt-2 text-[12px] leading-5 text-white/70">
          点击 🔥&apos;热门&apos; 即可查看各体育的热门赛事。
        </p>
      </div>
      {/* Banner 3: 开赛时间显示 */}
      <div className="overflow-hidden rounded-lg bg-gradient-to-br from-[#1a1a2e] to-[#0f3460] p-4">
        <div className="mb-1 inline-block rounded bg-[var(--cg-green)] px-2 py-0.5 text-[10px] font-bold text-white">新</div>
        <h3 className="text-[18px] font-black text-white">开赛时间显示</h3>
        <p className="mt-2 text-[12px] leading-5 text-white/70">
          在设定中转换赛事开赛时间的显示方式。
        </p>
        <div className="mt-3 space-y-2 rounded-lg bg-white/10 p-3">
          <label className="flex items-center justify-between text-[12px] text-white/80">
            <span>系统时间 (GMT+8)</span>
            <span className="size-4 rounded-full border-2 border-[var(--cg-green)] bg-[var(--cg-green)]" />
          </label>
          <label className="flex items-center justify-between text-[12px] text-white/80">
            <span>当地时间（倒数时间）</span>
            <span className="size-4 rounded-full border-2 border-white/30" />
          </label>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, action }: { title: string; action?: string }) {
  return (
    <div className="flex items-end justify-between px-0.5 pt-1">
      <h2 className="text-[18px] font-black">{title}</h2>
      {action && <button type="button" className="text-[12px] font-black text-[var(--cg-gold-deep)]">{action}</button>}
    </div>
  );
}

// pmpm.uk-style helpers for the match card --------------------------------

function statusToneFor(match: FootballMatch): { tone: Tone; label: string } {
  if (match.rawStatus === "settled")             return { tone: "soft",   label: "完场" };
  if (match.rawStatus === "cancelled")           return { tone: "red",    label: "已取消" };
  if (match.rawStatus === "inplay" || match.rawStatus === "live")
                                                 return { tone: "red",    label: "进行中" };
  if (match.status === "soon")                   return { tone: "orange", label: "即将开始" };
  return                                                  { tone: "blue",   label: "未开赛" };
}

// Three-letter style team mark used as a tiny "crest" placeholder. We
// pick the first 1–2 Chinese characters (or the leading letters in
// English fallbacks) so each badge stays visually distinct.
function teamMark(name: string): string {
  if (!name) return "?";
  const chinese = name.replace(/[A-Za-z\s.\-]/g, "");
  if (chinese.length >= 2) return chinese.slice(0, 2);
  if (chinese.length === 1) return chinese;
  const ascii = name.replace(/[^A-Za-z]/g, "");
  return ascii.slice(0, 3).toUpperCase() || "?";
}

// Two-tone background for the placeholder crest — keyed off the mark so
// the same team always gets the same colour across the prototype.
function teamBadgeColor(mark: string): { bg: string; fg: string } {
  const palette: Array<{ bg: string; fg: string }> = [
    { bg: "#f5f2e5", fg: "#503f32" },
    { bg: "#fff0ef", fg: "#b91c1c" },
    { bg: "#e8f7ef", fg: "#0ead69" },
    { bg: "#fff7e6", fg: "#b76b00" },
    { bg: "#f3e8ff", fg: "#7c3aed" },
    { bg: "#e0f2fe", fg: "#0369a1" },
  ];
  let h = 0;
  for (const c of mark) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

function TeamCrest({ name }: { name: string }) {
  const mark = teamMark(name);
  const c = teamBadgeColor(mark);
  return (
    <div
      className="grid size-12 shrink-0 place-items-center rounded-full text-[15px] font-black tracking-tight"
      style={{ backgroundColor: c.bg, color: c.fg }}
      aria-hidden
    >
      {mark}
    </div>
  );
}

// Live ticker for in-play matches.
//
// Authoritative source: api-sports.io's `fixture.status.elapsed` + `.short`,
// written into foot_match (apisports_elapsed / apisports_status / seen_at)
// by the `ingest_odds_api.php --live-only` cron every 60s.  When fresh
// (seen within ``APISPORTS_TICKER_MAX_AGE_SEC``), the ticker reads game
// minute and period code straight from upstream so HT / 45+' / 90+'
// transitions match the broadcast.
//
// Wall-clock fallback: when api-sports has no fixture for the gid (small
// leagues without coverage) or the value is stale (cron lag / outage), we
// fall back to a ``Date.now() - commenceTs`` heuristic.  Real game flow
// has three sources of wall-clock drift that don't move the game minute:
//   1) 1H stoppage  ≈ 1-5 min   (broadcast wraps at 45 + stoppage)
//   2) Halftime    ≈ 15-20 min  (UCL / domestic cups extend it for ads)
//   3) 2H stoppage ≈ 4-10 min   (cumulative VAR / subs / cooling breaks)
// We use a piecewise schedule calibrated against typical UCL / EPL fixtures
// and CLAMP rather than overflow into nonsense numbers.

const APISPORTS_TICKER_MAX_AGE_SEC = 5 * 60;  // 5 min: cron is 60s, 5 min = 5x grace

function formatLiveTicker(
  commenceTs: number | null | undefined,
  elapsedMinute?: number | null,
  statusShort?: string | null,
  apisportsSeenAt?: number | null,
): string | null {
  // ── Authoritative path (api-sports) ─────────────────────────────────
  if (
    statusShort
    && apisportsSeenAt
    && Date.now() / 1000 - apisportsSeenAt <= APISPORTS_TICKER_MAX_AGE_SEC
  ) {
    const code = statusShort.toUpperCase();
    if (code === "HT")  return "中场";
    if (code === "FT" || code === "AET" || code === "PEN") return "已结束";
    if (code === "P")   return "点球";
    if (code === "BT")  return "中断";          // halftime break alt
    if (code === "INT") return "暂停";
    if (code === "PST") return "延期";
    // Live periods: 1H/2H/ET — use elapsed when available.  Always label the
    // half (上半场/下半场) plus the running minute so every in-play card is
    // self-describing rather than a bare "滚球".
    if (elapsedMinute != null && Number.isFinite(elapsedMinute)) {
      const m = Math.floor(elapsedMinute);
      if (code === "1H") return m >= 45 ? `上半场 45+${m - 45}'` : `上半场 ${m}'`;
      if (code === "2H") return m >= 90 ? `下半场 90+${m - 90}'` : `下半场 ${m}'`;
      if (code === "ET") return m >= 120 ? `加时 120+${m - 120}'` : `加时 ${m}'`;
      // Unknown period code but we have a minute — infer the half from it.
      return m <= 45 ? `上半场 ${m}'` : `下半场 ${m}'`;
    }
    // Period known but no elapsed — at least name the half.
    if (code === "1H") return "上半场";
    if (code === "2H") return "下半场";
    if (code === "ET") return "加时";
  }

  // ── Wall-clock fallback ─────────────────────────────────────────────
  // No fresh broadcast clock (most lower-tier in-play matches have no live
  // feed).  Estimate the half + minute from kickoff so the card still shows
  // 上半场/下半场 + 分钟数 instead of a bare "滚球".
  if (!commenceTs) return null;
  const elapsed = Math.floor(Date.now() / 1000 - commenceTs);
  if (elapsed < 0) return null;
  const m = Math.floor(elapsed / 60);
  // First half: 0–45 normal, 45–50 → stoppage label.
  if (m <= 45) return `上半场 ${m}'`;
  if (m <= 50) return "上半场 45+'";
  // Halftime window: wall-clock 50–67 ≈ 12-17 min HT break.
  if (m < 67) return "中场";
  // Second half: subtract realistic lost time (≈ 22 min = 4 min 1H stoppage
  // + 18 min HT/entertainment).  Display caps at 90+'.
  const hm = m - 22;
  if (hm < 46) return "下半场 46'";
  if (hm >= 90) return "下半场 90+'";
  return `下半场 ${hm}'`;
}

// --- Helpers for odds display -----------------------------------------------
function fmtOdds(v: number): string {
  if (!v || v <= 0) return "—";
  if (v >= 100) return v.toFixed(0);
  if (v >= 20) return v.toFixed(1);
  return v.toFixed(2);
}
function fmtLine(v: number): string {
  if (!v) return "";
  return v > 0 ? `+${v}` : String(v);
}

// Like fmtLine but always renders a value, including "0" for a level
// (平手) handicap.  Spread / half-spread cells use this so a 0-line
// market still surfaces its line marker rather than vanishing.
function fmtHdpLine(v: number): string {
  if (v > 0) return `+${v}`;
  if (v < 0) return String(v);
  return "0";
}

// --- WS connection / freshness badge -----------------------------------------
// Surfaces the live odds-WS bridge's state so users can visually confirm
// pushes are landing (rather than wondering whether prices are stuck or
// the socket is dead).  Three visual states:
//
//   ● WS · 2s     — connected and a real (non-heartbeat) odds frame
//                    arrived within the last 5s.  Green dot.
//   ● WS · 12s    — connected but no recent fresh frame.  Amber once
//                    the gap exceeds 5s, red once it exceeds 30s.  Most
//                    of the time this means Bet365 is broadcasting
//                    duplicate snapshots which the client de-dupes —
//                    expected on quiet matches, not a problem.
//   ○ WS 未连接   — socket dropped or not yet established.  Grey.
//
// Internally ticks every 1s so the relative timestamp stays current
// even when no new WS frames arrive.
function WsStatusBadge({
  connected,
  lastTickAt,
}: {
  connected: boolean;
  lastTickAt: number | null;
}) {
  // Local 1Hz tick so "Xs前" stays fresh between WS frames.  Cheap —
  // single setInterval on the badge, not on every cell.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  let dotColor = "#9ca3af"; // grey — not connected
  let label = "WS 未连接";
  let title = "实时赔率推送未连接 — 列表会回退到 15 秒轮询";
  let dotChar = "○";
  if (connected) {
    dotChar = "●";
    if (lastTickAt == null) {
      // Connected but no real odds frame yet (handshake done, waiting
      // for first push).  Treat as "live but quiet".
      dotColor = "#a78025"; // amber
      label = "WS 已连接";
      title = "WS 已连接，等待第一帧真实赔率推送";
    } else {
      const ageSec = Math.max(0, Math.floor((now - lastTickAt) / 1000));
      if (ageSec <= 5) {
        dotColor = "#15803d"; // green
        title = `最近一次赔率变动 ${ageSec}s 前`;
      } else if (ageSec <= 30) {
        dotColor = "#a78025"; // amber — Bet365 quiet cycle / dedup
        title = `最近一次真实变动 ${ageSec}s 前（Bet365 重复推送已被去重）`;
      } else {
        dotColor = "#b91c1c"; // red — long silence; possibly stuck
        title = `最近一次真实变动 ${ageSec}s 前（订阅可能僵死）`;
      }
      // Compact label: "WS · 2s" / "WS · 12s" / "WS · 1m"
      const ageLabel = ageSec < 60 ? `${ageSec}s` : `${Math.floor(ageSec / 60)}m`;
      label = `WS · ${ageLabel}`;
    }
  }
  return (
    <div
      className="flex h-full shrink-0 items-center gap-1 border-l border-[#e6e6e6] px-2 text-[11px] font-bold tabular-nums"
      title={title}
    >
      <span style={{ color: dotColor }} aria-hidden="true">{dotChar}</span>
      <span className="text-[var(--cg-text-56)]">{label}</span>
    </div>
  );
}


// --- In-play odds flash ------------------------------------------------------
// Highlights an odds cell green / red for ~1s whenever its numeric value
// changes (price moved up / down). The hook keeps the previous value in a
// ref so re-renders don't reset history. `enabled` must be true to flash;
// callers pass `match.rawStatus === "inplay"` && global toggle.
function useOddsFlash(value: number | undefined, flashKey: string, enabled: boolean): "up" | "down" | null {
  const prevRef = useRef<number | undefined>(undefined);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (!enabled || value == null || !Number.isFinite(value) || value <= 0) {
      prevRef.current = value;
      return;
    }
    const prev = prevRef.current;
    if (prev != null && Math.abs(value - prev) > 0.005) {
      setFlash(value > prev ? "up" : "down");
      const t = window.setTimeout(() => setFlash(null), 1000);
      prevRef.current = value;
      return () => window.clearTimeout(t);
    }
    prevRef.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, flashKey, enabled]);
  return flash;
}

// PickableCell renders one odds value as a clickable button that toggles the
// outcome into the right-side bet slip directly from the match list (no
// navigation). It stops event propagation so the underlying row's "open
// match" click still works on the team-name / time area.
function PickableCell({
  value, flashKey, flashEnabled, className = "",
  option, onPick, active,
  topLabel, inlinePrefix,
}: {
  value: number | undefined;
  flashKey: string;
  flashEnabled: boolean;
  className?: string;
  option?: OutcomeOption;
  onPick?: (opt: OutcomeOption) => void;
  active?: boolean;
  /** Black text rendered above the red odds (e.g. "主 -0.5", "大 2.5") */
  topLabel?: string;
  /** Black text rendered to the left of the red odds, inline (e.g. "主", "客", "和", "是", "否") */
  inlinePrefix?: string;
}) {
  const f = useOddsFlash(value, flashKey, flashEnabled);
  const disabled = !option || !value || value <= 0;
  const oddsText = fmtOdds(value ?? 0);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(ev) => {
        ev.stopPropagation();
        if (disabled || !option || !onPick) return;
        onPick(option);
      }}
      className={cx(
        className,
        "transition disabled:cursor-default",
        active ? "bg-[var(--cg-gold)]/25 ring-1 ring-inset ring-[var(--cg-gold)] text-[var(--cg-gold-deep)]" : "",
        f === "up" ? "cg-flash-up" : f === "down" ? "cg-flash-down" : "",
      )}
    >
      {topLabel ? (
        <span className="flex flex-col items-center justify-center leading-[1.15]">
          <span className="text-[12px] font-bold text-[#1f2937]">{topLabel}</span>
          <span>{oddsText}</span>
        </span>
      ) : inlinePrefix ? (
        <span className="inline-flex items-baseline gap-1">
          <span className="text-[12px] font-bold text-[#1f2937]">{inlinePrefix}</span>
          <span>{oddsText}</span>
        </span>
      ) : (
        oddsText
      )}
    </button>
  );
}

// --- Compact odds column (让球/大小) -----------------------------------------
//
// Each cell shows the outcome direction + line in black text (e.g. "主 -0.5",
// "客 +0.5", "大 2.5", "小 2.5") above the red odds value. This mirrors the
// classic Crown / 皇冠 layout where every red odds is preceded by an
// outcome marker so users instantly know whether they are picking home /
// away / over / under.
function OddsCol({
  label, sub,
  topV, botV,
  topLabel, botLabel,
  flashEnabled, flashKey,
  topOpt, botOpt,
  onPick, selectedIds,
}: {
  label: string;
  sub: string;
  topV: number;
  botV: number;
  /** Per-cell labels (e.g. "主 -0.5" / "客 +0.5", "大 2.5" / "小 2.5"). */
  topLabel?: string;
  botLabel?: string;
  flashEnabled: boolean;
  flashKey: string;
  topOpt?: OutcomeOption;
  botOpt?: OutcomeOption;
  onPick?: (opt: OutcomeOption) => void;
  selectedIds?: Set<string>;
}) {
  // Header now shows just the market label (e.g. "让球", "大小"); the line +
  // direction has been pushed down into the per-cell topLabel/botLabel so
  // every red odds carries its own direction marker.
  const headerText = topLabel || botLabel ? label : `${label}${sub ? ` ${sub}` : ""}`;
  return (
    <div className="flex w-[54px] shrink-0 flex-col border-l border-[#eeeeea] min-[1024px]:w-auto min-[1024px]:min-w-[82px] min-[1024px]:flex-1">
      <div className="border-b border-[#eeeeea] bg-[#fdfcf7] px-1 text-center text-[12px] leading-[20px] text-[#a78025] truncate">
        {headerText}
      </div>
      <div className="flex flex-1 flex-col">
        <PickableCell value={topV} flashKey={`${flashKey}-top`} flashEnabled={flashEnabled}
          option={topOpt} onPick={onPick} active={topOpt ? selectedIds?.has(topOpt.id) : false}
          topLabel={topLabel}
          className="flex h-[40px] w-full items-center justify-center border-b border-[#eeeeea] bg-[#FAFAF9] text-[14px] font-bold text-[var(--cg-red)] hover:bg-[var(--cg-gold)]/10" />
        <PickableCell value={botV} flashKey={`${flashKey}-bot`} flashEnabled={flashEnabled}
          option={botOpt} onPick={onPick} active={botOpt ? selectedIds?.has(botOpt.id) : false}
          topLabel={botLabel}
          className="flex h-[40px] w-full items-center justify-center bg-[#FAFAF9] text-[14px] font-bold text-[var(--cg-red)] hover:bg-[var(--cg-gold)]/10" />
      </div>
    </div>
  );
}
// --- 3-way ML column (独赢 / 半场独赢 / 双重) ---------------------------------
// `hLabel`/`nLabel`/`cLabel` override the inline prefix so the same
// component can render Double Chance with semantic labels (主和 / 主客 /
// 客和) instead of the misleading 主/和/客 used for 1X2 ML.
function MLCol({
  hV, nV, cV, label = "独赢",
  hLabel = "主", nLabel = "和", cLabel = "客",
  flashEnabled, flashKey,
  hOpt, nOpt, cOpt,
  onPick, selectedIds,
}: {
  hV: number;
  nV: number;
  cV: number;
  label?: string;
  hLabel?: string;
  nLabel?: string;
  cLabel?: string;
  flashEnabled: boolean;
  flashKey: string;
  hOpt?: OutcomeOption;
  nOpt?: OutcomeOption;
  cOpt?: OutcomeOption;
  onPick?: (opt: OutcomeOption) => void;
  selectedIds?: Set<string>;
}) {
  return (
    <div className="flex w-[46px] shrink-0 flex-col border-l border-[#eeeeea] min-[1024px]:w-auto min-[1024px]:min-w-[76px] min-[1024px]:flex-1">
      <div className="border-b border-[#eeeeea] bg-[#fdfcf7] text-center text-[12px] leading-[20px] text-[#a78025]">{label}</div>
      <div className="flex flex-1 flex-col">
        <PickableCell value={hV} flashKey={`${flashKey}-h`} flashEnabled={flashEnabled}
          option={hOpt} onPick={onPick} active={hOpt ? selectedIds?.has(hOpt.id) : false}
          inlinePrefix={hLabel}
          className="flex h-[27px] w-full items-center justify-center border-b border-[#eeeeea] bg-[#FAFAF9] text-[13px] font-bold text-[var(--cg-red)] hover:bg-[var(--cg-gold)]/10" />
        <PickableCell value={nV} flashKey={`${flashKey}-n`} flashEnabled={flashEnabled}
          option={nOpt} onPick={onPick} active={nOpt ? selectedIds?.has(nOpt.id) : false}
          inlinePrefix={nLabel}
          className="flex h-[27px] w-full items-center justify-center border-b border-[#eeeeea] bg-[#FAFAF9] text-[13px] font-bold text-[var(--cg-red)]/65 hover:bg-[var(--cg-gold)]/10" />
        <PickableCell value={cV} flashKey={`${flashKey}-c`} flashEnabled={flashEnabled}
          option={cOpt} onPick={onPick} active={cOpt ? selectedIds?.has(cOpt.id) : false}
          inlinePrefix={cLabel}
          className="flex h-[27px] w-full items-center justify-center bg-[#FAFAF9] text-[13px] font-bold text-[var(--cg-red)] hover:bg-[var(--cg-gold)]/10" />
      </div>
    </div>
  );
}
// --- 2-row BTTS / DNB column (yes/no 或 主胜/客胜) ---------------------------------
function BTTSCol({
  yesV, noV, label = "两队进球",
  yesLabel = "是", noLabel = "否",
  flashEnabled, flashKey,
  yesOpt, noOpt,
  onPick, selectedIds,
}: {
  yesV: number;
  noV: number;
  label?: string;
  /** Inline direction prefix for each cell. Defaults to 是/否; e.g. for DNB use 主/客. */
  yesLabel?: string;
  noLabel?: string;
  flashEnabled: boolean;
  flashKey: string;
  yesOpt?: OutcomeOption;
  noOpt?: OutcomeOption;
  onPick?: (opt: OutcomeOption) => void;
  selectedIds?: Set<string>;
}) {
  return (
    <div className="flex w-[46px] shrink-0 flex-col border-l border-[#eeeeea] min-[1024px]:w-auto min-[1024px]:min-w-[76px] min-[1024px]:flex-1">
      <div className="border-b border-[#eeeeea] bg-[#fdfcf7] text-center text-[12px] leading-[20px] text-[#a78025] truncate">{label}</div>
      <div className="flex flex-1 flex-col">
        <PickableCell value={yesV} flashKey={`${flashKey}-y`} flashEnabled={flashEnabled}
          option={yesOpt} onPick={onPick} active={yesOpt ? selectedIds?.has(yesOpt.id) : false}
          inlinePrefix={yesLabel}
          className="flex h-[40px] w-full items-center justify-center border-b border-[#eeeeea] bg-[#FAFAF9] text-[14px] font-bold text-[var(--cg-red)] hover:bg-[var(--cg-gold)]/10" />
        <PickableCell value={noV} flashKey={`${flashKey}-n`} flashEnabled={flashEnabled}
          option={noOpt} onPick={onPick} active={noOpt ? selectedIds?.has(noOpt.id) : false}
          inlinePrefix={noLabel}
          className="flex h-[40px] w-full items-center justify-center bg-[#FAFAF9] text-[14px] font-bold text-[var(--cg-red)] hover:bg-[var(--cg-gold)]/10" />
      </div>
    </div>
  );
}

// Builds a synthetic OutcomeOption for a row-level "click-to-bet" cell.
// `marketKey` and `side` together form a stable id so toggling cleanly
// removes/replaces selections. `marketTitle` matches what MarketListRow's
// column header shows so the bet slip's summary stays consistent.
function buildRowOption(
  match: FootballMatch,
  marketKey: string,
  side: string,
  marketTitle: string,
  outcomeLabel: string,
  odds: number,
  line: number | undefined,
): OutcomeOption {
  return {
    id: `${match.id}-main_${marketKey}-${side}`,
    marketId: `${match.id}-main_${marketKey}-0`,
    marketTitle,
    eventId: match.id,
    matchId: match.id,
    title: `${match.home} vs ${match.away}`,
    label: outcomeLabel,
    odds,
    line,
    field: side,
    version: 1,
  };
}
// --- Trailing "+N 更多盘口" chip (collapsed markets w/ many outcomes) ----------
// Clicking the chip opens the full match-detail screen so the user can browse
// every market that didn't fit in the inline strip (typically 30-50+ for top
// leagues). `onClick` mirrors what tapping the team-name area on the row
// already does — both flows funnel into the same FootballScreen.
function MoreCol({ n, onClick }: { n: number; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onClick?.();
      }}
      className="flex w-[64px] shrink-0 flex-col items-center justify-center border-l border-[#eeeeea] bg-[#fdfcf7] px-2 py-2 transition hover:bg-[var(--cg-gold)]/10 min-[1024px]:w-[96px]"
    >
      <div className="text-[12px] font-bold text-[#a78025] leading-tight">+{n}</div>
      <div className="text-[10px] text-[#a78025]/80 leading-tight mt-0.5">更多盘口 ›</div>
    </button>
  );
}
// --- League header row (logo + 中文全称 + count) -----------------------------
// Renders the api-sports.io official league logo PNG and the full Chinese
// league name (e.g. "意大利甲级联赛"), with the short name (意甲) kept as
// a trailing hint. When the slug isn't in our LEAGUE_META map or the CDN
// is unreachable (China-mainland mirrors etc.), the country flag emoji is
// used as the visual marker so the row still scans correctly.
function LeagueHeader({
  slug,
  fallback,
  count,
}: {
  slug: string | null;
  fallback: string;
  count: number;
}) {
  const meta = leagueMeta(slug);
  const logoUrl = leagueLogoUrl(slug);
  const [logoFailed, setLogoFailed] = useState(false);
  const fullName = leagueFullName(slug, fallback);
  // Only show the short-name hint when it's actually different from the
  // full name (otherwise we'd render "意甲 · 意甲" for ad-hoc tournaments
  // whose slug isn't in LEAGUE_META and `fullName` ends up == fallback).
  const shortHint =
    meta?.shortName && meta.shortName !== fullName ? meta.shortName : null;
  const showLogo = !!logoUrl && !logoFailed;
  return (
    <div className="flex h-[40px] items-center gap-2 border-b border-[#EAEAEA] bg-white px-2">
      {showLogo ? (
        <img
          src={logoUrl}
          alt=""
          width={20}
          height={20}
          loading="lazy"
          decoding="async"
          className="size-5 shrink-0 object-contain"
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <span className="shrink-0 text-[18px] leading-none" aria-hidden="true">
          {meta?.flag ?? "⚽"}
        </span>
      )}
      <span className="flex-1 truncate text-[14px] font-bold text-[#000]">{fullName}</span>
      {shortHint && (
        <span className="shrink-0 text-[11px] text-[var(--cg-text-56)]">{shortHint}</span>
      )}
      <span className="ml-2 text-[12px] text-[var(--cg-text-56)]">{count}</span>
    </div>
  );
}
// Tiny inline chips next to a team name in the live row showing yellow /
// red card counts and the running corner-kick tally for that side.  Hidden
// for non-live matches and for sides where every value is null/0.  Card
// counts come from api-sports' `events` array (cron every 60s) and corners
// from `/fixtures/statistics` (cron every 2 min); both fall back to null
// when api-sports has no fixture for the gid (small-league coverage gap),
// in which case the corresponding chip is suppressed entirely.
function CardCornerChips({
  isLive, yc, rc, corners,
}: {
  isLive: boolean;
  yc?: number | null;
  rc?: number | null;
  corners?: number | null;
}) {
  if (!isLive) return null;
  // Suppress chips with zero/null counts so a clean game doesn't carry a
  // row of empty pills; the absence of a chip carries the "0" meaning.
  const showYc      = typeof yc === "number" && yc > 0;
  const showRc      = typeof rc === "number" && rc > 0;
  const showCorners = typeof corners === "number" && corners > 0;
  if (!showYc && !showRc && !showCorners) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5 text-[9.5px] leading-none">
      {showYc && (
        <span
          title="黄牌"
          className="inline-flex h-3 min-w-3 items-center justify-center rounded-sm bg-[#f5b400] px-0.5 text-[9px] font-black text-white tabular-nums"
        >
          {yc}
        </span>
      )}
      {showRc && (
        <span
          title="红牌"
          className="inline-flex h-3 min-w-3 items-center justify-center rounded-sm bg-[#e74c3c] px-0.5 text-[9px] font-black text-white tabular-nums"
        >
          {rc}
        </span>
      )}
      {showCorners && (
        <span
          title="角球"
          className="inline-flex h-3 items-center gap-px rounded-sm bg-[#1e7a8c] px-1 text-[9px] font-bold text-white tabular-nums"
        >
          ⚑{corners}
        </span>
      )}
    </span>
  );
}

// --- Compact match row (PHP SPA style) ----------------------------------------
function MatchListRow({
  match,
  selected,
  favorite,
  onClick,
  onToggleFavorite,
  marketView = "main",
  flashEnabled = false,
  onPickOutcome,
  selectedOutcomeIds,
}: {
  match: FootballMatch;
  selected: boolean;
  favorite: boolean;
  onClick: () => void;
  onToggleFavorite: () => void;
  marketView?: MarketViewFilter;
  flashEnabled?: boolean;
  onPickOutcome?: (opt: OutcomeOption) => void;
  selectedOutcomeIds?: Set<string>;
}) {
  const mo = match.mainOdds;
  const isCS = marketView === "correct_score";
  // Visibility map for the inline odds columns. Each entry encodes which
  // top-tab(s) include this column: e.g. spread shows on 主要玩法 + 让球;
  // half-time markets only show on 主要玩法 + 半场. Categories that have
  // no slim-row representation (波胆/角球/黄牌/球员/进球者) hide all inline
  // columns and surface their content via the inline-expand panel below
  // the row instead.
  const mvShow = {
    spread:   marketView === "main" || marketView === "handicap",
    ou:       marketView === "main" || marketView === "totals",
    ml:       marketView === "main" || marketView === "ml",
    btts:     marketView === "main" || marketView === "goals",
    htMl:     marketView === "main" || marketView === "halftime" || marketView === "ml",
    htSpread: marketView === "main" || marketView === "halftime" || marketView === "handicap",
    htOu:     marketView === "main" || marketView === "halftime" || marketView === "totals",
    htBtts:   marketView === "main" || marketView === "halftime" || marketView === "goals",
    dc:       marketView === "main" || marketView === "ml",
    dnb:      marketView === "main" || marketView === "ml",
    corners:  marketView === "main" || marketView === "corners",
  };
  const hasScore = (match.rawStatus === "inplay" || match.rawStatus === "live") && match.scoreHome != null;
  const isLocked = match.status === "locked";
  const isLive = !isLocked && (match.rawStatus === "inplay" || match.rawStatus === "live");
  const visibleMarketLimit = 8;
  let visibleMarketCount = 0;
  const showMarket = () => {
    visibleMarketCount += 1;
    return visibleMarketCount <= visibleMarketLimit;
  };
  const totalMainMarkets = mo ? [
    mo.reH > 0 && mvShow.spread,
    mo.ouOver > 0 && mvShow.ou,
    mo.mH > 0 && mvShow.ml,
    (mo.bttsY ?? 0) > 0 && mvShow.btts,
    (mo.htH ?? 0) > 0 && mvShow.htMl,
    (mo.rehH ?? 0) > 0 && mvShow.htSpread,
    (mo.ouhOver ?? 0) > 0 && mvShow.htOu,
    (mo.bttsHtY ?? 0) > 0 && mvShow.htBtts,
    (mo.dc1x ?? 0) > 0 && (mo.dcX2 ?? 0) > 0 && (mo.dc12 ?? 0) > 0 && mvShow.dc,
    (mo.dnbH ?? 0) > 0 && mvShow.dnb,
    (mo.cornersOver ?? 0) > 0 && mvShow.corners,
  ].filter(Boolean).length : 0;
  // Inline columns above show at most `visibleMarketLimit` market types; the
  // remainder of the event's market book sits behind the "+N 更多盘口" chip.
  // Prefer the API-reported total market_count (typically 40-60 for top
  // leagues) over the local main-odds overflow alone, otherwise the badge
  // would understate the catalog by an order of magnitude.
  const inlineShown = Math.min(totalMainMarkets, visibleMarketLimit);
  const extraFromApi = match.extraMarkets?.length ?? 0;
  const remainingFromTotal = Math.max(0, (match.markets || 0) - inlineShown);
  const collapsedMarketCount = Math.max(remainingFromTotal, Math.max(0, totalMainMarkets - visibleMarketLimit) + extraFromApi);
  // Only surface the "+N 更多盘口" chip when the event genuinely has a deep
  // market book — i.e. total markets (inline + collapsed) > 9.  Small books
  // (3-5 markets) used to render a "+1"/"+2" chip even when the inline strip
  // had tons of empty space, which was visually noisy and clickbait-y.
  const MORE_COL_TOTAL_THRESHOLD = 9;
  const totalMarketsForBadge = mo
    ? inlineShown + collapsedMarketCount
    : Math.max(match.markets || 0, extraFromApi);
  const showMoreCol = totalMarketsForBadge > MORE_COL_TOTAL_THRESHOLD;
  // Scores shown inline beside the team name (like the original SPA):
  // "0  塔尔萨奥克拉荷马" / "2  Austin II". Falls back to "0" before kickoff so
  // the column always reserves the same horizontal slot.
  const showInlineScore = isLive || match.scoreHome != null || match.scoreAway != null;
  const homeScore = match.scoreHome ?? 0;
  const awayScore = match.scoreAway ?? 0;
  return (
    <div
      className={cx(
        "flex w-full border-b border-[#e6e6e6]",
        selected ? "bg-[#fffbf0]" : "bg-white"
      )}
    >
      <button
        type="button"
        onClick={(ev) => {
          ev.stopPropagation();
          onToggleFavorite();
        }}
        className={cx(
          "flex w-[22px] shrink-0 items-start justify-center pt-2 text-[14px] min-[1024px]:w-[26px] min-[1024px]:text-[15px]",
          favorite ? "text-[var(--cg-gold)]" : "text-[#c9c1b8]"
        )}
      >
        ★
      </button>
      {/* Left: time + scores+teams + market-count entry button.
          Width is intentionally tight so short Chinese team names
          ("浙江队" / "辽宁铁人") don't leave a noticeable gap before
          the first odds column.  Header strip below mirrors this. */}
      <div className="flex w-[100px] min-w-[100px] flex-none flex-col justify-between px-1 py-1.5 min-[1024px]:w-[144px] min-[1024px]:min-w-[144px]">
        <div className={cx("text-[11px] leading-[14px]", isLive ? "font-bold text-[#e76565]" : "text-[#888]")}>
          {isLocked
            ? match.lockLabel
            : isLive
              ? (formatLiveTicker(match.commenceTs, match.elapsedMinute, match.statusShort, match.apisportsSeenAt) ?? "滚球")
              : match.kickoff}
        </div>
        <div className="mt-0.5 flex flex-col gap-0">
          <div className="flex items-center gap-1.5">
            {showInlineScore && (
              <span className={cx("w-3 shrink-0 text-center text-[12px] font-black tabular-nums", isLive ? "text-[#e76565]" : "text-[#666]")}>
                {homeScore}
              </span>
            )}
            <span className="truncate text-[12.5px] font-bold leading-[18px]">{match.home}</span>
            <CardCornerChips
              isLive={isLive}
              yc={match.ycHome}
              rc={match.rcHome}
              corners={match.cornersHome}
            />
          </div>
          <div className="flex items-center gap-1.5">
            {showInlineScore && (
              <span className={cx("w-3 shrink-0 text-center text-[12px] font-black tabular-nums", isLive ? "text-[#e76565]" : "text-[#666]")}>
                {awayScore}
              </span>
            )}
            <span className="truncate text-[12.5px] font-bold leading-[18px]">{match.away}</span>
            <CardCornerChips
              isLive={isLive}
              yc={match.ycAway}
              rc={match.rcAway}
              corners={match.cornersAway}
            />
          </div>
        </div>
        {/* Bottom strip: "{N} ›" market-count + status icons. The chevron
            count navigates to the full FootballScreen — the inline expand
            is now reached via the always-visible tab strip rendered by
            FootballListScreen below this row. */}
        <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--cg-text-56)]">
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); onClick(); }}
            className="flex items-center gap-0.5 font-bold text-[var(--cg-text-72)] hover:text-[var(--cg-gold-deep)]"
            title="查看完整盘口"
          >
            {match.markets}
            <span className="text-[10px]">›</span>
          </button>
          {isLive && (
            <span
              title="进行中"
              className="grid size-4 place-items-center rounded-full bg-[var(--cg-green)] text-white"
            >
              <svg viewBox="0 0 24 24" className="size-2.5 fill-current"><path d="M8 5v14l11-7z" /></svg>
            </span>
          )}
          <span
            title="盘口数量"
            className="grid size-4 place-items-center rounded-full bg-[var(--cg-gold)] text-white text-[9px] font-black"
          >
            $
          </span>
        </div>
      </div>
      {/* Right: odds */}
      <div className="flex flex-1 items-stretch overflow-x-auto no-scrollbar min-[1024px]:overflow-hidden">
        {isLocked && (
          <div className="flex flex-1 items-center justify-center bg-[#f5f5f0] px-3 text-[12px] font-bold text-[#9ca3af]">
            已锁单
          </div>
        )}
        {!isLocked && isCS && (
          <div className="flex flex-1 items-center justify-center text-[12px] text-[var(--cg-gold-deep)] px-3">
            波胆 · 点击查看 ›
          </div>
        )}
        {/* 让球 (Spread): require BOTH legs > 0.  Some upstream books quote
            only the home side (Bet365 sometimes returns away="N/A"), which
            cast to re_c=0 and produced a “主 2.02 / 客 —” half-row.  Drop
            the column entirely in that case rather than show a broken pill. */}
        {!isLocked && !isCS && mo && mo.reH > 0 && mo.reC > 0 && mvShow.spread && showMarket() && (
          <OddsCol label="让球" sub={fmtHdpLine(mo.reLine)} topV={mo.reH} botV={mo.reC} flashEnabled={flashEnabled} flashKey={`${match.id}-spread`}
            topLabel={`主 ${fmtHdpLine(mo.reLine)}`} botLabel={`客 ${fmtHdpLine(-mo.reLine)}`}
            topOpt={buildRowOption(match, "spread", "home", `让球 ${fmtHdpLine(mo.reLine)}`, `${match.home} ${fmtHdpLine(mo.reLine)}`, mo.reH, mo.reLine)}
            botOpt={buildRowOption(match, "spread", "away", `让球 ${fmtHdpLine(mo.reLine)}`, `${match.away} ${fmtHdpLine(-mo.reLine)}`, mo.reC, -mo.reLine)}
            onPick={onPickOutcome} selectedIds={selectedOutcomeIds} />
        )}
        {!isLocked && !isCS && mo && mo.ouOver > 0 && mvShow.ou && showMarket() && (
          <OddsCol label="大小" sub={String(mo.ouLine)} topV={mo.ouOver} botV={mo.ouUnder} flashEnabled={flashEnabled} flashKey={`${match.id}-ou`}
            topLabel={`大 ${mo.ouLine}`} botLabel={`小 ${mo.ouLine}`}
            topOpt={buildRowOption(match, "ou", "over", `大小 ${mo.ouLine}`, `大 ${mo.ouLine}`, mo.ouOver, mo.ouLine)}
            botOpt={buildRowOption(match, "ou", "under", `大小 ${mo.ouLine}`, `小 ${mo.ouLine}`, mo.ouUnder, mo.ouLine)}
            onPick={onPickOutcome} selectedIds={selectedOutcomeIds} />
        )}
        {!isLocked && !isCS && mo && mo.mH > 0 && mvShow.ml && showMarket() && (
          <MLCol hV={mo.mH} nV={mo.mN} cV={mo.mC} flashEnabled={flashEnabled} flashKey={`${match.id}-ml`}
            hOpt={buildRowOption(match, "ml", "home", "独赢", `${match.home} 胜`, mo.mH, undefined)}
            nOpt={buildRowOption(match, "ml", "draw", "独赢", "和局", mo.mN, undefined)}
            cOpt={buildRowOption(match, "ml", "away", "独赢", `${match.away} 胜`, mo.mC, undefined)}
            onPick={onPickOutcome} selectedIds={selectedOutcomeIds} />
        )}
        {!isLocked && !isCS && mo && (mo.bttsY ?? 0) > 0 && mvShow.btts && showMarket() && (
          <BTTSCol yesV={mo.bttsY!} noV={mo.bttsN!} flashEnabled={flashEnabled} flashKey={`${match.id}-btts`}
            yesOpt={buildRowOption(match, "btts", "yes", "两队进球", "两队进球 - 是", mo.bttsY!, undefined)}
            noOpt={buildRowOption(match, "btts", "no", "两队进球", "两队进球 - 否", mo.bttsN!, undefined)}
            onPick={onPickOutcome} selectedIds={selectedOutcomeIds} />
        )}
        {!isLocked && !isCS && mo && (mo.htH ?? 0) > 0 && mvShow.htMl && showMarket() && (
          <MLCol hV={mo.htH!} nV={mo.htN!} cV={mo.htC!} label="半场" flashEnabled={flashEnabled} flashKey={`${match.id}-html`}
            hOpt={buildRowOption(match, "html", "home", "半场独赢", `半场 ${match.home} 胜`, mo.htH!, undefined)}
            nOpt={buildRowOption(match, "html", "draw", "半场独赢", "半场和局", mo.htN!, undefined)}
            cOpt={buildRowOption(match, "html", "away", "半场独赢", `半场 ${match.away} 胜`, mo.htC!, undefined)}
            onPick={onPickOutcome} selectedIds={selectedOutcomeIds} />
        )}
        {!isLocked && !isCS && mo && (mo.rehH ?? 0) > 0 && (mo.rehC ?? 0) > 0 && mvShow.htSpread && showMarket() && (
          <OddsCol label="半让" sub={fmtHdpLine(mo.rehLine ?? 0)} topV={mo.rehH!} botV={mo.rehC!} flashEnabled={flashEnabled} flashKey={`${match.id}-htsp`}
            topLabel={`主 ${fmtHdpLine(mo.rehLine ?? 0)}`} botLabel={`客 ${fmtHdpLine(-(mo.rehLine ?? 0))}`}
            topOpt={buildRowOption(match, "htsp", "home", `半场让球 ${fmtHdpLine(mo.rehLine ?? 0)}`, `半场 ${match.home} ${fmtHdpLine(mo.rehLine ?? 0)}`, mo.rehH!, mo.rehLine ?? 0)}
            botOpt={buildRowOption(match, "htsp", "away", `半场让球 ${fmtHdpLine(mo.rehLine ?? 0)}`, `半场 ${match.away} ${fmtHdpLine(-(mo.rehLine ?? 0))}`, mo.rehC!, -(mo.rehLine ?? 0))}
            onPick={onPickOutcome} selectedIds={selectedOutcomeIds} />
        )}
        {!isLocked && !isCS && mo && (mo.ouhOver ?? 0) > 0 && mvShow.htOu && showMarket() && (
          <OddsCol label="半大小" sub={String(mo.ouhLine ?? 0)} topV={mo.ouhOver!} botV={mo.ouhUnder!} flashEnabled={flashEnabled} flashKey={`${match.id}-htou`}
            topLabel={`大 ${mo.ouhLine ?? 0}`} botLabel={`小 ${mo.ouhLine ?? 0}`}
            topOpt={buildRowOption(match, "htou", "over", `半场大小 ${mo.ouhLine ?? 0}`, `半场大 ${mo.ouhLine ?? 0}`, mo.ouhOver!, mo.ouhLine ?? 0)}
            botOpt={buildRowOption(match, "htou", "under", `半场大小 ${mo.ouhLine ?? 0}`, `半场小 ${mo.ouhLine ?? 0}`, mo.ouhUnder!, mo.ouhLine ?? 0)}
            onPick={onPickOutcome} selectedIds={selectedOutcomeIds} />
        )}
        {!isLocked && !isCS && mo && (mo.bttsHtY ?? 0) > 0 && mvShow.htBtts && showMarket() && (
          <BTTSCol yesV={mo.bttsHtY!} noV={mo.bttsHtN!} label="半场两队" flashEnabled={flashEnabled} flashKey={`${match.id}-bttsht`}
            yesOpt={buildRowOption(match, "bttsht", "yes", "半场两队进球", "半场两队进球 - 是", mo.bttsHtY!, undefined)}
            noOpt={buildRowOption(match, "bttsht", "no", "半场两队进球", "半场两队进球 - 否", mo.bttsHtN!, undefined)}
            onPick={onPickOutcome} selectedIds={selectedOutcomeIds} />
        )}
        {/* 双重 (Double Chance): hV/nV/cV legs are 1X / X2 / 12 — we relabel
            the inline prefixes to 主和 / 客和 / 主客 so users don't mistake
            "主 1.50" for a Home Win price.  Require ALL THREE legs so we
            don't render half-broken rows like "主和 1.40 / 客和 — / 主客
            1.33" (Bet365 sometimes drops a leg for low-tier leagues such
            as Chinese Super League).  Same all-legs guard is also used
            for 让球 / 大小 / 角球 / 半让. */}
        {!isLocked && !isCS && mo
          && (mo.dc1x ?? 0) > 0 && (mo.dcX2 ?? 0) > 0 && (mo.dc12 ?? 0) > 0
          && mvShow.dc && showMarket() && (
          <MLCol hV={mo.dc1x!} nV={mo.dcX2!} cV={mo.dc12!} label="双重"
            hLabel="主和" nLabel="客和" cLabel="主客"
            flashEnabled={flashEnabled} flashKey={`${match.id}-dc`}
            hOpt={buildRowOption(match, "dc", "1x", "双重机会", `${match.home} 或 平局`, mo.dc1x!, undefined)}
            nOpt={buildRowOption(match, "dc", "x2", "双重机会", `${match.away} 或 平局`, mo.dcX2!, undefined)}
            cOpt={buildRowOption(match, "dc", "12", "双重机会", `${match.home} 或 ${match.away}`, mo.dc12!, undefined)}
            onPick={onPickOutcome} selectedIds={selectedOutcomeIds} />
        )}
        {!isLocked && !isCS && mo && (mo.dnbH ?? 0) > 0 && mvShow.dnb && showMarket() && (
          <BTTSCol yesV={mo.dnbH!} noV={mo.dnbC!} label="不平局" yesLabel="主" noLabel="客" flashEnabled={flashEnabled} flashKey={`${match.id}-dnb`}
            yesOpt={buildRowOption(match, "dnb", "home", "不平局", `${match.home} 胜（不计平局）`, mo.dnbH!, undefined)}
            noOpt={buildRowOption(match, "dnb", "away", "不平局", `${match.away} 胜（不计平局）`, mo.dnbC!, undefined)}
            onPick={onPickOutcome} selectedIds={selectedOutcomeIds} />
        )}
        {!isLocked && !isCS && mo && (mo.cornersOver ?? 0) > 0 && mvShow.corners && showMarket() && (
          <OddsCol label="角球" sub={String(mo.cornersLine ?? 9.5)} topV={mo.cornersOver!} botV={mo.cornersUnder!} flashEnabled={flashEnabled} flashKey={`${match.id}-corners`}
            topLabel={`大 ${mo.cornersLine ?? 9.5}`} botLabel={`小 ${mo.cornersLine ?? 9.5}`}
            topOpt={buildRowOption(match, "corners", "over", `角球大小 ${mo.cornersLine ?? 9.5}`, `角球大 ${mo.cornersLine ?? 9.5}`, mo.cornersOver!, mo.cornersLine ?? 9.5)}
            botOpt={buildRowOption(match, "corners", "under", `角球大小 ${mo.cornersLine ?? 9.5}`, `角球小 ${mo.cornersLine ?? 9.5}`, mo.cornersUnder!, mo.cornersLine ?? 9.5)}
            onPick={onPickOutcome} selectedIds={selectedOutcomeIds} />
        )}
        {!isLocked && !isCS && mo && collapsedMarketCount > 0 && showMoreCol && (
          <MoreCol n={collapsedMarketCount} onClick={onClick} />
        )}
        {!isLocked && !isCS && !mo && (match.markets > 0 || (match.extraMarkets?.length ?? 0) > 0) && showMoreCol && (
          <MoreCol n={Math.max(match.markets || 0, match.extraMarkets?.length ?? 0)} onClick={onClick} />
        )}
        {!isLocked && !isCS && !mo && (match.extraMarkets?.length ?? 0) === 0 && match.markets === 0 && (
          // Distinguish "match is live but the WS relay hasn't pushed odds
          // yet" (typical Bet365 latency at kickoff, or a transient ws-relay
          // hiccup) from the plain "pre-match has no markets yet".  Both
          // come down to the backend returning main_odds=null + markets=0,
          // but for in-play we want a lock-style indicator so users don't
          // think the row is dead — odds will reappear automatically on
          // the next 30s poll once the cache populates.
          isLive ? (
            <div className="flex flex-1 items-center justify-center gap-1.5 bg-[#fafaf7] px-3 text-[12px] font-bold text-[var(--cg-text-56)]">
              <svg viewBox="0 0 24 24" className="size-3.5 fill-current"><path d="M12 1a5 5 0 00-5 5v4H6a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2v-9a2 2 0 00-2-2h-1V6a5 5 0 00-5-5zm-3 9V6a3 3 0 116 0v4H9z"/></svg>
              <span>滚球盘口暂未推送</span>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-[12px] text-[var(--cg-text-24)] px-3">
              暂无盘口
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// MatchInlineMarketsPanel — collapsible market panel that mounts directly
// below a MatchListRow. Lazy-fetches the match's full market book and lets
// the user place bets across 4 popular categories (波胆 / 让球&大小 /
// 独赢&大小 / 角球) without navigating away from the list — mirrors the
// in-line expansion behaviour seen on the legacy SPA's correct-score view.
// ---------------------------------------------------------------------------
// Inline-expand category set. Mirrors the legacy SPA's secondary-market
// drawer: the user picks a chip (波胆 / 让球 / 大小 / 独赢 / 半场 /
// 角球 / 黄牌 / 进球者 / 球员 / 特殊) and the panel below the row shows
// every odds-api market that matches the regex below. Categorisation
// follows the 62 distinct market_name strings odds-api currently emits
// for football (see Odds-API.json + the test event listings).
type InlineMarketTab =
  | "correct_score"
  | "handicap"
  | "totals"
  | "ml"
  | "halftime"
  | "corners"
  | "cards"
  | "goalscorer"
  | "player"
  | "specials";

const INLINE_MARKET_TABS: Array<{ id: InlineMarketTab; label: string }> = [
  { id: "correct_score", label: "波胆" },
  { id: "handicap", label: "让球" },
  { id: "totals", label: "大小" },
  { id: "ml", label: "独赢" },
  { id: "halftime", label: "半场" },
  { id: "goalscorer", label: "进球者" },
  { id: "corners", label: "角球" },
  { id: "cards", label: "黄牌" },
  { id: "player", label: "球员" },
  { id: "specials", label: "特殊" },
];

// Helpers for the per-tab regex matcher. Half-time markets get their own
// tab, so the regular spread/total/ml tabs filter them out — otherwise
// the user sees mixed full-time + half-time markets on the same panel.
function isHalfTimeMarket(n: string): boolean {
  return n.includes("ht") || n.includes("1st half") || n.includes("first half")
    || n.includes("2nd half") || n.includes("second half")
    || n.includes("half time") || n.includes("halftime")
    || n.includes("first 10") || n.includes("first 15");
}
function isCornerMarket(n: string): boolean { return n.includes("corner"); }
function isCardMarket(n: string): boolean { return n.includes("card") || n.includes("booking"); }
function isPlayerMarket(n: string): boolean {
  return /\b(player|goalkeeper|match shots|team shots|team total goals|team cards|team corners)\b/.test(n);
}
function isGoalscorerMarket(n: string): boolean {
  return /\b(goalscorer|goal method|multi scorers|to score|score or assist|first goalscorer)\b/.test(n);
}

// Per-tab market_name filter. Returns true when the named market belongs
// in the active inline-expand panel for this tab.
function marketMatchesTab(name: string, tab: InlineMarketTab): boolean {
  const n = name.toLowerCase();
  const isHalf = isHalfTimeMarket(n);
  const isCorner = isCornerMarket(n);
  const isCard = isCardMarket(n);
  const isPlayer = isPlayerMarket(n);
  const isScorer = isGoalscorerMarket(n);
  // Each tab's filter; later branches assume earlier ones haven't matched
  // (so e.g. a "Corners HT" market lands in 角球 not 半场).
  if (tab === "corners") return isCorner;
  if (tab === "cards") return isCard;
  if (tab === "player") return isPlayer && !isCorner && !isCard;
  if (tab === "goalscorer") return isScorer && !isCorner && !isCard && !isPlayer;
  if (tab === "specials") return /\bspecials?\b/.test(n);
  if (tab === "correct_score") return n.includes("correct score") && !isHalf;
  if (tab === "halftime") return isHalf && !isCorner && !isCard && !isPlayer;
  if (tab === "handicap") {
    if (isHalf || isCorner || isCard || isPlayer) return false;
    return /\b(handicap|spread|european handicap|asian handicap)\b/.test(n);
  }
  if (tab === "totals") {
    if (isHalf || isCorner || isCard || isPlayer) return false;
    return /\b(totals?|over\/under|over|under|goal line|number of goals|exact total goals)\b/.test(n);
  }
  if (tab === "ml") {
    if (isHalf || isCorner || isCard || isPlayer) return false;
    return /\b(ml|money line|match winner|3-?way|double chance|draw no bet|both teams to score)\b/.test(n) || n === "ml";
  }
  return false;
}

// Compute which inline-market tabs are available for a given match based on
// its mainOdds + extraMarkets data. Tabs with zero available markets are
// hidden from the strip to avoid showing chips that lead to an empty body.
//
// Strict mode: only tabs whose data we can prove exists are shown. The
// previous optimistic fallback (which added all 10 tabs whenever the
// upstream `markets` count exceeded what we'd accounted for) caused empty
// chips for categories our backend never parses (进球者/黄牌/球员/特殊),
// so users repeatedly clicked into empty bodies. The rcn parser currently
// produces only 12 distinct market_name values — anything outside that
// set genuinely doesn't exist for our pipeline, regardless of how many
// markets the upstream snapshot reports.
function availableInlineTabs(match: FootballMatch): Set<InlineMarketTab> {
  const tabs = new Set<InlineMarketTab>();
  const mo = match.mainOdds;
  // From mainOdds: pre-decoded main-line markets count as "available"
  // only when BOTH legs of the market price are present. A spread with
  // re_h=2.0/re_c=0 (Bet365 returns "N/A" for the away side on a level
  // handicap) wouldn't render anything bookable in the panel, so we hide
  // the tab too.
  if (mo) {
    if (mo.reH > 0 && mo.reC > 0) tabs.add("handicap");
    if (mo.ouOver > 0 && mo.ouUnder > 0) tabs.add("totals");
    if (mo.mH > 0 || (mo.dnbH ?? 0) > 0 || (mo.dc1x ?? 0) > 0 || (mo.bttsY ?? 0) > 0) tabs.add("ml");
    if ((mo.htH ?? 0) > 0 || ((mo.rehH ?? 0) > 0 && (mo.rehC ?? 0) > 0)
        || (mo.ouhOver ?? 0) > 0 || (mo.bttsHtY ?? 0) > 0) tabs.add("halftime");
    if ((mo.cornersOver ?? 0) > 0 && (mo.cornersUnder ?? 0) > 0) tabs.add("corners");
  }
  const named = match.extraMarkets ?? [];
  // From extraMarkets: when the upstream gives us named markets, bucket
  // each into the same tab the body panel uses, so the strip and the body
  // stay perfectly in sync. Tabs the parser doesn't emit for (黄牌 / 球员
  // / 进球者 / 特殊) silently stay hidden.
  for (const em of named) {
    for (const t of INLINE_MARKET_TABS) {
      if (!tabs.has(t.id) && marketMatchesTab(em.name, t.id)) tabs.add(t.id);
    }
  }
  return tabs;
}

// Always-visible tab strip rendered below every MatchListRow. Each chip
// represents one secondary-market category. Tabs with no markets available
// for this match are filtered out. The close (✕) only shows when one of the
// chips is the active tab for this row, to avoid visual clutter across rows
// that have no panel open.
function MatchInlineTabsStrip({
  match,
  activeTab,
  onSelectTab,
  onClose,
}: {
  match: FootballMatch;
  activeTab: InlineMarketTab | null;
  onSelectTab: (tab: InlineMarketTab) => void;
  onClose: () => void;
}) {
  const available = availableInlineTabs(match);
  const visibleTabs = INLINE_MARKET_TABS.filter((t) => available.has(t.id));
  // If a match has no secondary markets at all, hide the strip entirely
  // (matches "暂无盘口" cases and keeps row height compact).
  if (visibleTabs.length === 0) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[#e6e6e6] bg-[#fafaf7] px-2 py-1.5">
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
        {visibleTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={cx(
                "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold transition",
                isActive
                  ? "bg-[var(--cg-gold)] text-white"
                  : "bg-white text-[var(--cg-text-72)] hover:text-[var(--cg-gold-deep)] border border-[#e6e6e6]"
              )}
            >
              {tab.label}
              <svg viewBox="0 0 24 24" className={cx("ml-1 inline-block size-3 fill-current", isActive ? "rotate-180" : "")}>
                <path d="M7 10l5 5 5-5z" />
              </svg>
            </button>
          );
        })}
      </div>
      {activeTab && (
        <button
          type="button"
          onClick={onClose}
          className="grid size-6 shrink-0 place-items-center text-[var(--cg-text-56)] hover:text-[var(--cg-text)]"
          title="收起"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// Lazy-loaded inline markets body. Mounted only when a tab is active for
// this row (parent gates rendering); fetches the bookmaker book + event
// metadata on mount and renders the appropriate category view.
function MatchInlineMarketsBody({
  match,
  tab,
  onPickOutcome,
  selectedOutcomeIds,
}: {
  match: FootballMatch;
  tab: InlineMarketTab;
  onPickOutcome?: (opt: OutcomeOption) => void;
  selectedOutcomeIds?: Set<string>;
}) {
  const [bookmakers, setBookmakers] = useState<OddsBookmaker[]>([]);
  const [event, setEvent] = useState<OddsEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      oddsApi.listMarkets(match.id),
      oddsApi.getEvent(match.id).catch(() => null),
    ])
      .then(([m, e]) => {
        if (cancelled) return;
        setBookmakers(m.bookmakers ?? []);
        setEvent(e);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [match.id]);

  return (
    <div className="border-b border-[#d8d8d8] bg-[#fafaf7]">
      {loading && (
        <div className="px-4 py-6 text-center text-[12px] text-[var(--cg-text-56)]">正在加载盘口…</div>
      )}
      {error && !loading && (
        <div className="px-4 py-6 text-center text-[12px] text-[var(--cg-red)]">加载失败：{error}</div>
      )}
      {!loading && !error && event && (
        <InlineMarketsBody
          tab={tab}
          bookmakers={bookmakers}
          event={event}
          onPickOutcome={onPickOutcome}
          selectedOutcomeIds={selectedOutcomeIds}
        />
      )}
    </div>
  );
}

function InlineMarketsBody({
  tab,
  bookmakers,
  event,
  onPickOutcome,
  selectedOutcomeIds,
}: {
  tab: InlineMarketTab;
  bookmakers: OddsBookmaker[];
  event: OddsEvent;
  onPickOutcome?: (opt: OutcomeOption) => void;
  selectedOutcomeIds?: Set<string>;
}) {
  const book = firstBookmaker(bookmakers);
  if (!book) return <div className="px-4 py-6 text-center text-[12px] text-[var(--cg-text-56)]">暂无盘口</div>;
  const markets = book.markets.filter((m) => marketMatchesTab(m.market_name, tab));
  if (markets.length === 0) {
    return <div className="px-4 py-6 text-center text-[12px] text-[var(--cg-text-56)]">该类别暂无可投盘口</div>;
  }

  if (tab === "correct_score") {
    // Render the 3-column score grid: home wins / draw / away wins,
    // each sorted by (total goals asc, then home/away goals asc).
    const market = markets[0];
    const options = expandMarket(market, event);
    if (options.length === 0) return <div className="px-4 py-6 text-center text-[12px]">无可投比分</div>;
    const buckets: { home: OutcomeOption[]; draw: OutcomeOption[]; away: OutcomeOption[] } = { home: [], draw: [], away: [] };
    for (const o of options) {
      const m = o.label.match(/(\d+)\s*[-:]\s*(\d+)/);
      if (!m) continue;
      const h = parseInt(m[1], 10), a = parseInt(m[2], 10);
      if (h > a) buckets.home.push(o);
      else if (h < a) buckets.away.push(o);
      else buckets.draw.push(o);
    }
    const sortByTotalThenHome = (a: OutcomeOption, b: OutcomeOption) => {
      const ma = a.label.match(/(\d+)\s*[-:]\s*(\d+)/);
      const mb = b.label.match(/(\d+)\s*[-:]\s*(\d+)/);
      if (!ma || !mb) return 0;
      const at = parseInt(ma[1], 10) + parseInt(ma[2], 10);
      const bt = parseInt(mb[1], 10) + parseInt(mb[2], 10);
      return at - bt || parseInt(ma[1], 10) - parseInt(mb[1], 10);
    };
    buckets.home.sort(sortByTotalThenHome);
    buckets.draw.sort(sortByTotalThenHome);
    buckets.away.sort(sortByTotalThenHome);
    return (
      <div className="grid grid-cols-3 gap-1 p-2">
        <ScoreColumn title={translateTeam(event.home ?? "") || event.home || "主队"} options={buckets.home} onPick={onPickOutcome} selectedIds={selectedOutcomeIds} />
        <ScoreColumn title="平" options={buckets.draw} onPick={onPickOutcome} selectedIds={selectedOutcomeIds} />
        <ScoreColumn title={translateTeam(event.away ?? "") || event.away || "客队"} options={buckets.away} onPick={onPickOutcome} selectedIds={selectedOutcomeIds} />
      </div>
    );
  }

  // Generic list view for handicap / ml / corners. Each market_name becomes
  // a section header, and its outcomes render as a wrapping grid of pill
  // buttons. Capped per-market to keep the panel compact.
  return (
    <div className="flex flex-col gap-2 p-2">
      {markets.slice(0, 6).map((m) => {
        const opts = expandMarket(m, event).slice(0, 12);
        if (opts.length === 0) return null;
        return (
          <div key={m.market_id} className="rounded border border-[#e6e6e6] bg-white">
            <div className="border-b border-[#eee] bg-[#fafaf7] px-2 py-1 text-[11px] font-bold text-[var(--cg-text-72)]">
              {translateMarket(m.market_name)}
            </div>
            <div className="flex flex-wrap gap-1 p-1.5">
              {opts.map((o) => (
                <OddsPill key={o.id} option={o} selected={selectedOutcomeIds?.has(o.id)} onClick={() => onPickOutcome?.(o)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScoreColumn({ title, options, onPick, selectedIds }: { title: string; options: OutcomeOption[]; onPick?: (o: OutcomeOption) => void; selectedIds?: Set<string> }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="truncate text-center text-[11px] font-bold text-[var(--cg-text-72)]">{title}</div>
      {options.slice(0, 12).map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onPick?.(o)}
          className={cx(
            "flex flex-col items-center rounded border px-2 py-1 transition",
            selectedIds?.has(o.id)
              ? "border-[var(--cg-gold)] bg-[var(--cg-gold)]/15"
              : "border-[#e6e6e6] bg-white hover:border-[var(--cg-gold)]/60"
          )}
        >
          <span className="text-[11px] font-bold text-[var(--cg-text)]">{o.label}</span>
          <span className="text-[12px] font-black text-[var(--cg-red)]">{o.odds.toFixed(2)}</span>
        </button>
      ))}
    </div>
  );
}

function OddsPill({ option, selected, onClick }: { option: OutcomeOption; selected?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex min-w-[68px] flex-col items-center rounded border px-2 py-1 transition",
        selected ? "border-[var(--cg-gold)] bg-[var(--cg-gold)]/15" : "border-[#e6e6e6] bg-white hover:border-[var(--cg-gold)]/60"
      )}
    >
      <span className="max-w-full truncate text-[11px] text-[var(--cg-text-72)]">{option.label}</span>
      <span className="text-[12px] font-black text-[var(--cg-red)]">{option.odds.toFixed(2)}</span>
    </button>
  );
}

function FootballListScreen({
  matches,
  selectedMatchId,
  openMatch,
  go,
  filter,
  setFilter,
  favoriteMatchIds,
  toggleFavoriteMatch,
  loading,
  error,
  walletAddress,
  walletBalance,
  checkedLeagueIds,
  clearCheckedLeagues,
  onPickOutcome,
  selectedOutcomeIds,
  discoverDateFilter,
  clearDiscoverDateFilter,
  oddsFlashEnabled,
  setOddsFlashEnabled,
  leagueRegions,
  wsConnected,
  wsLastTickAt,
}: {
  matches: FootballMatch[];
  selectedMatchId: string;
  openMatch: (match: FootballMatch) => void;
  go: (screen: Screen) => void;
  filter: FootballListFilter;
  setFilter: (filter: FootballListFilter) => void;
  favoriteMatchIds: Set<string>;
  toggleFavoriteMatch: (matchKey: string) => void;
  onPickOutcome?: (opt: OutcomeOption) => void;
  selectedOutcomeIds?: Set<string>;
  loading: boolean;
  error: string | null;
  walletAddress: string;
  walletBalance: string;
  checkedLeagueIds: Set<string>;
  clearCheckedLeagues: () => void;
  discoverDateFilter: string;
  clearDiscoverDateFilter: () => void;
  // Lifted to the page so the right-drawer 赔率显示模式 toggle and this
  // screen's settings dialog (image 1) share the same prefOddsNotify
  // value, persisted as `cg_pref_odds_notify` in localStorage.
  oddsFlashEnabled: boolean;
  setOddsFlashEnabled: (v: boolean) => void;
  /** Region tree from the dynamic /leagues/catalog (with hard-coded
   *  fallback) so this screen's checked-league filter resolves the
   *  same alias set as the DiscoverScreen tree it was picked in. */
  leagueRegions: LeagueRegion[];
  /** Live WS bridge state — surfaced as a small badge so users can
   *  visually confirm odds pushes are landing.  `wsLastTickAt` is the
   *  Date.now() ms timestamp of the latest non-heartbeat odds frame
   *  (or null while we're still waiting for the first one). */
  wsConnected: boolean;
  wsLastTickAt: number | null;
}) {
  // Time windows. We use forward-looking ranges (now-based) rather than the
  // browser's local-midnight so the buckets stay populated regardless of the
  // user's timezone vs the upstream commence_iso timezone (Crown serves in
  // US/Eastern; CN viewers would otherwise see their "今日" empty whenever
  // matches kick off after their local midnight).
  const [marketView, setMarketView] = useState<MarketViewFilter>("main");
  const [sortMode, setSortMode] = useState<SortMode>("league");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // oddsFlashEnabled is now lifted to the SportsPage (mirrors the
  // right-drawer 赔率显示模式 toggle).  Local state removed.
  // Which (match, category) has its inline-markets panel expanded. Only
  // one row can have an open body at a time — switching rows or switching
  // tabs replaces the current expansion. The tab strip below each row is
  // always visible regardless of this state; only the body panel is gated.
  const [expandedMatch, setExpandedMatch] = useState<{ id: string; tab: InlineMarketTab } | null>(null);

  const now = Date.now() / 1000;
  const todayWindowEndTs = now + 36 * 60 * 60;   // 今日: 未来 36h (覆盖完整本地今日 + 明早)
  const soonWindowEndTs = now + 24 * 60 * 60;    // 即将开赛: 未来 24h
  const earlyWindowStartTs = todayWindowEndTs;   // 早盘: 36h 之后

  // World Cup match detector — covers FIFA tournament + qualifiers + women's,
  // plus the Chinese display label users typically see in the SPA.
  const wcSlugs = ["world-cup", "fifa-world-cup", "wc2026", "fifa world cup"];
  const wcNameNeedles = ["世界杯", "world cup", "fifa"];
  const isWorldCupMatch = (m: FootballMatch): boolean => {
    const slug = (m.leagueSlug ?? "").toLowerCase();
    const name = (m.leagueName ?? "").toLowerCase();
    return wcSlugs.some((s) => slug.includes(s)) || wcNameNeedles.some((s) => name.includes(s));
  };

  const matchesFilter = (m: FootballMatch, target: FootballListFilter) => {
    const ts = m.commenceTs ?? 0;
    const isLive = m.rawStatus === "inplay" || m.rawStatus === "live";
    const isToday = ts >= now - 7200 && ts <= todayWindowEndTs;
    const isSoon = m.rawStatus === "pending" && ts >= now && ts <= soonWindowEndTs;
    const isEarly = m.rawStatus === "pending" && ts > earlyWindowStartTs;
    const hasMarkets = m.markets > 0 || !!m.mainOdds || (m.extraMarkets?.length ?? 0) > 0;
    if (target === "live") return isLive;
    if (target === "today") return isToday;
    if (target === "soon") return isSoon;
    if (target === "early") return isEarly;
    // 热门: 不再按时间限制，统一按盘量降序在 visibleMatches 里截取前 N 场
    if (target === "hot") return hasMarkets;
    // 世界杯: 只展示国际杯赛/资格赛（FIFA 世界杯 + 同义联赛）
    if (target === "wc") return isWorldCupMatch(m);
    // 综合过关: Crown 上游用 showtype=p3 单独取赛集，本地无法精确还原；
    // 这里近似为 "未锁盘 + 至少 5 个盘口" 过滤掉小众赛事
    if (target === "parlay") return m.status !== "locked" && (m.markets ?? 0) >= 5;
    if (target === "favorites") return favoriteMatchIds.has(matchIdentity(m));
    if (target === "outrights") return false;
    return true;
  };

  const aliasSet = useMemo(
    () => buildLeagueAliasSet(checkedLeagueIds, leagueRegions),
    [checkedLeagueIds, leagueRegions],
  );

  // Date constraint piped down from the DiscoverScreen 早盘 date pill.
  // "all" or "future" mean "no exact-day constraint"; anything else is a
  // local-tz YYYY-MM-DD that the match's commenceTs must fall on.
  const matchOnDiscoverDate = (m: FootballMatch): boolean => {
    if (discoverDateFilter === "all") return true;
    const ts = m.commenceTs ?? 0;
    const dKey = localDateKey(new Date(ts * 1000));
    if (discoverDateFilter === "future") {
      const todayKey = localDateKey(new Date());
      return dKey > todayKey;
    }
    return dKey === discoverDateFilter;
  };

  const HOT_LIMIT = 30;
  const visibleMatches = useMemo(() => {
    const list = matches
      .filter((m) => matchesFilter(m, filter))
      .filter((m) => matchInSelectedLeagues(m, aliasSet))
      .filter((m) => matchOnDiscoverDate(m));
    if (filter === "hot") {
      return [...list]
        .sort((a, b) => (b.markets ?? 0) - (a.markets ?? 0))
        .slice(0, HOT_LIMIT);
    }
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, filter, favoriteMatchIds, aliasSet, discoverDateFilter]);

  const groups = useMemo(() => {
    type Group = { slug: string | null; league: string; items: FootballMatch[] };
    if (sortMode === "time") {
      const sorted = [...visibleMatches].sort((a, b) => (a.commenceTs ?? 0) - (b.commenceTs ?? 0));
      return sorted.length > 0 ? [{ slug: null, league: "按时间排序", items: sorted } as Group] : [];
    }
    // Group by `league_slug` when available so two events from "Italy - Serie A"
    // and "italy-serie-a" don't end up in separate buckets just because the
    // upstream display string drifts. Fall back to the translated stage when
    // a slug isn't reported (rare; ad-hoc tournaments).
    const map = new Map<string, Group>();
    visibleMatches.forEach((m) => {
      const key = m.leagueSlug || m.stage;
      const existing = map.get(key);
      if (existing) existing.items.push(m);
      else map.set(key, { slug: m.leagueSlug || null, league: m.stage, items: [m] });
    });
    return Array.from(map.values());
  }, [visibleMatches, sortMode]);

  // Tab-specific empty-state copy so the user knows *why* the list is
  // empty (zero live games vs zero in their league selection vs upstream
  // data gap), not just a generic "暂无赛事".
  const emptyText =
    filter === "favorites"
      ? "暂无收藏赛事，可点击赛事行左侧星号加入我的赛事。"
      : filter === "outrights"
        ? "冠军盘口需要单独的 FS / Outright 数据源，当前 H5 API 尚未返回。"
        : filter === "live"
          ? "当前没有进行中的滚球比赛。点击「即将开赛」查看未来 24 小时即将开始的赛事。"
          : filter === "soon"
            ? "未来 24 小时内暂无即将开赛的比赛。"
            : filter === "today"
              ? "今日暂无可投赛事。"
              : filter === "wc"
                ? "暂无世界杯赛事数据。"
                : checkedLeagueIds.size > 0
                  ? "当前联赛筛选下暂无赛事，可点击右上角「清除筛选」查看全部。"
                  : "暂无赛事";

  return (
    <>
      {/* Market view filter tabs — 主要玩法/让球&大小/波胆/独赢&大小 */}
      <div className="flex items-center border-b border-[#d8d8d8] bg-white">
        <div className="flex flex-1 items-center gap-0 overflow-x-auto no-scrollbar">
          {marketViewTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMarketView(tab.id)}
              className={cx(
                "shrink-0 whitespace-nowrap px-3 py-2 text-[12px] font-bold transition",
                marketView === tab.id
                  ? "text-[#d4380d] border-b-2 border-[#d4380d]"
                  : "text-[var(--cg-text-56)] hover:text-[#d4380d]"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <WsStatusBadge connected={wsConnected} lastTickAt={wsLastTickAt} />
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex h-full w-10 shrink-0 items-center justify-center border-l border-[#e6e6e6] text-[var(--cg-text-56)] hover:text-[var(--cg-gold-deep)]"
        >
          <svg viewBox="0 0 24 24" className="size-[18px] fill-current"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg>
        </button>
      </div>

      {/* Column header — widths must mirror MatchListRow's left strip
          (favorite-star 26px + team column 166px desktop / 140 mobile). */}
      <div className="flex h-[26px] items-stretch bg-[#EDEEEC] border-b border-[#d8d8d8]">
        {/* favorite-star (22 / 26) + team col (100 / 144) = 122 / 170 */}
        <div className="flex w-[122px] min-w-[122px] items-center px-2 min-[1024px]:w-[170px] min-[1024px]:min-w-[170px]">
          <span className="text-[11px] font-bold text-[var(--cg-text-56)]">时间 / 球队</span>
        </div>
        <div className="flex flex-1 items-center px-2 text-[10px] text-[var(--cg-text-56)] overflow-hidden min-[1024px]:hidden">
          <span className="truncate">← 左右滑动查看盘口 →</span>
        </div>
      </div>

      {/* Selected-leagues filter banner */}
      {checkedLeagueIds.size > 0 && (
        <div className="flex items-center justify-between bg-[var(--cg-gold)]/15 px-3 py-2 text-[12px] text-[var(--cg-text)]">
          <span>已筛选 {checkedLeagueIds.size} 个联赛 · 共 {visibleMatches.length} 场</span>
          <button type="button" onClick={clearCheckedLeagues} className="text-[var(--cg-gold-deep)] font-bold">清除筛选</button>
        </div>
      )}

      {/* Status messages */}
      {loading && (
        <div className="py-6 text-center text-[12px] text-[var(--cg-text-56)]">正在加载赛事…</div>
      )}
      {error && (
        <div className="bg-[#fff0ef] px-4 py-3 text-center text-[12px] font-bold text-[#b91c1c]">
          后端连接失败：{error}
        </div>
      )}
      {!loading && visibleMatches.length === 0 && (
        <div className="py-8 text-center text-[12px] text-[var(--cg-text-56)]">
          {emptyText} · <button type="button" className="text-[var(--cg-gold-deep)]" onClick={() => {
            clearCheckedLeagues();
            clearDiscoverDateFilter();
            setFilter("all");
          }}>查看全部</button>
        </div>
      )}

      {/* League groups */}
      {groups.map((g) => {
        // FIFA World Cup: backend stamped each match with a group letter
        // ("A".."L").  When every fixture in this league bucket has a
        // non-empty group we re-sort by (group, kickoff) and inject
        // 小组 X sub-headers so the user can scan group-stage matches
        // four-at-a-time instead of weaving across 12 groups by date.
        // Other leagues fall through to the original chronological list.
        const allHaveGroups = g.items.length > 0 && g.items.every((m) => !!m.group);
        const items = allHaveGroups
          ? [...g.items].sort((a, b) => {
              const ga = a.group || "";
              const gb = b.group || "";
              if (ga !== gb) return ga < gb ? -1 : 1;
              return (a.commenceTs ?? 0) - (b.commenceTs ?? 0);
            })
          : g.items;
        return (
          <div key={g.slug ?? g.league} className="mb-[2px]">
            {/* League header row */}
            <LeagueHeader slug={g.slug} fallback={g.league} count={g.items.length} />
            {/* Match row + always-visible tab strip (波胆 / 让球&大小 /
                独赢&大小 / 角球) + optional expanded body. The strip mirrors
                the reference SPA's secondary-market entry; clicking a chip
                opens its body inline so the user can place a bet without
                navigating to the full FootballScreen. */}
            {items.map((m, idx) => {
              const rowActiveTab = expandedMatch?.id === m.id ? expandedMatch.tab : null;
              const prev = idx > 0 ? items[idx - 1] : null;
              const showGroupHeader = allHaveGroups && (!prev || prev.group !== m.group);
              return (
                <Fragment key={m.id}>
                  {showGroupHeader && (
                    <div className="flex h-[28px] items-center gap-2 bg-[#fdfcf7] px-3 border-b border-[#eeeeea]">
                      <span className="inline-flex size-5 items-center justify-center rounded-full bg-[var(--cg-gold)]/20 text-[10px] font-black text-[var(--cg-gold-deep)]">{m.group}</span>
                      <span className="text-[12px] font-bold text-[var(--cg-text)]">小组 {m.group}</span>
                    </div>
                  )}
                  <MatchListRow
                    match={m}
                    selected={selectedMatchId === m.id}
                    favorite={favoriteMatchIds.has(matchIdentity(m))}
                    onClick={() => openMatch(m)}
                    onToggleFavorite={() => toggleFavoriteMatch(matchIdentity(m))}
                    marketView={marketView}
                    flashEnabled={oddsFlashEnabled}
                    onPickOutcome={onPickOutcome}
                    selectedOutcomeIds={selectedOutcomeIds}
                  />
                  <MatchInlineTabsStrip
                    match={m}
                    activeTab={rowActiveTab}
                    onSelectTab={(tab) => setExpandedMatch((cur) =>
                      cur && cur.id === m.id && cur.tab === tab ? null : { id: m.id, tab }
                    )}
                    onClose={() => setExpandedMatch(null)}
                  />
                  {rowActiveTab && (
                    <MatchInlineMarketsBody
                      match={m}
                      tab={rowActiveTab}
                      onPickOutcome={onPickOutcome}
                      selectedOutcomeIds={selectedOutcomeIds}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
        );
      })}

      {/* Settings modal */}
      {settingsOpen && (
        <div className="fixed inset-0 z-[22] flex items-center justify-center" onClick={() => setSettingsOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative z-[1] w-[90%] max-w-md rounded-xl bg-white p-5 shadow-[0_8px_40px_rgba(0,0,0,.25)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-[18px] font-black">设定</h2>
              <button type="button" onClick={() => setSettingsOpen(false)} className="grid size-8 place-items-center rounded-full bg-[#f1f5f9] text-[16px] font-bold text-[var(--cg-text-56)]">✕</button>
            </div>

            {/* 排序 */}
            <div className="mt-5">
              <h3 className="text-[14px] font-black text-[var(--cg-text)]">排序</h3>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSortMode("league")}
                  className={cx(
                    "flex items-center justify-center gap-1.5 rounded-lg border py-3 text-[13px] font-bold transition",
                    sortMode === "league"
                      ? "border-[var(--cg-gold)] bg-[var(--cg-gold)]/10 text-[var(--cg-gold-deep)]"
                      : "border-[var(--cg-border)] text-[var(--cg-text-56)]"
                  )}
                >
                  🏆 联盟排序
                </button>
                <button
                  type="button"
                  onClick={() => setSortMode("time")}
                  className={cx(
                    "flex items-center justify-center gap-1.5 rounded-lg border py-3 text-[13px] font-bold transition",
                    sortMode === "time"
                      ? "border-[var(--cg-gold)] bg-[var(--cg-gold)]/10 text-[var(--cg-gold-deep)]"
                      : "border-[var(--cg-border)] text-[var(--cg-text-56)]"
                  )}
                >
                  🕐 时间排序
                </button>
              </div>
            </div>

            {/* 过滤 */}
            <div className="mt-5">
              <h3 className="text-[14px] font-black text-[var(--cg-text)]">过滤</h3>
              <button
                type="button"
                onClick={() => { setSettingsOpen(false); go("discover"); }}
                className="mt-2 flex w-full items-center gap-2 rounded-lg border border-[var(--cg-border)] px-4 py-3 text-[13px] font-bold text-[var(--cg-text-64)] transition hover:border-[var(--cg-gold)]"
              >
                🔽 筛选联盟
              </button>
            </div>

            {/* 赔率显示模式 */}
            <div className="mt-5">
              <h3 className="text-[14px] font-black text-[var(--cg-text)]">赔率显示模式</h3>
              <p className="mt-1 text-[12px] text-[var(--cg-text-56)]">启动赔率更新提醒</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setOddsFlashEnabled(true)}
                  className={cx(
                    "flex items-center justify-center gap-1.5 rounded-lg border py-3 text-[13px] font-bold transition",
                    oddsFlashEnabled
                      ? "border-[var(--cg-gold)] bg-[var(--cg-gold)]/10 text-[var(--cg-gold-deep)]"
                      : "border-[var(--cg-border)] text-[var(--cg-text-56)]"
                  )}
                >
                  {oddsFlashEnabled ? "☑ " : ""}启动
                </button>
                <button
                  type="button"
                  onClick={() => setOddsFlashEnabled(false)}
                  className={cx(
                    "flex items-center justify-center gap-1.5 rounded-lg border py-3 text-[13px] font-bold transition",
                    !oddsFlashEnabled
                      ? "border-[var(--cg-gold)] bg-[var(--cg-gold)]/10 text-[var(--cg-gold-deep)]"
                      : "border-[var(--cg-border)] text-[var(--cg-text-56)]"
                  )}
                >
                  {!oddsFlashEnabled ? "☑ " : ""}关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FootballScreen({
  match,
  groups,
  selectedIds,
  onPick,
  go,
  loading,
  error,
  walletAddress,
  walletBalance,
  marketsSource,
}: {
  match: FootballMatch;
  groups: BeginnerMarketGroup[];
  selectedIds: Set<string>;
  onPick: (option: OutcomeOption, locked?: boolean) => void;
  go: (screen: Screen) => void;
  loading: boolean;
  error: string | null;
  walletAddress: string;
  walletBalance: string;
  marketsSource: string | null;
}) {
  // Lock rules:
  //   - settled/cancelled                       → always locked
  //   - in-play + markets sourced from WS (滚球) → bet-able
  //   - in-play + markets sourced from r_cn     → LOCKED (stale prematch)
  //   - prematch                                → bet-able
  const isInplay = match.rawStatus === "inplay" || match.rawStatus === "live";
  const stalePrematch = isInplay && marketsSource !== null && marketsSource !== "ws_live";
  const isLocked = match.status === "locked" || stalePrematch;
  return (
    <>
      <AppHeader title="足球场次 · 新手模式" back={() => go("footballList")} walletAddress={walletAddress} walletBalance={walletBalance} />
      <div className="space-y-3 p-4">
        <MatchHero match={match} marketsSource={marketsSource} />
        <LiveEventsTimeline match={match} />
        <ModeSwitch active="football" go={go} />
        {isLocked && (
          <Card className="border-[#fecaca] bg-[#fff0ef]">
            <p className="text-center text-[12px] font-bold text-[#b91c1c]">本场已锁单，盘口仅供查看，不能继续下注。</p>
          </Card>
        )}
        {loading && <Card><p className="text-center text-[12px] font-bold text-[var(--cg-text-56)]">加载 Crown 盘口…</p></Card>}
        {error && <Card className="bg-[#fff0ef]"><p className="text-center text-[12px] font-bold text-[#b91c1c]">{error}</p></Card>}
        {!loading && !error && groups.length === 0 && (
          isInplay ? (
            <EmptyState title="滚球盘口暂未推送" text="赛事已进入滚球，赔率供应商还未推送本场盘口。请稍后重试。" action="返回列表" onClick={() => go("footballList")} />
          ) : (
            <EmptyState title="暂无盘口" text="该场比赛在 Crown DB 中没有可用的 wtype/ioratio 数据。" action="返回列表" onClick={() => go("footballList")} />
          )
        )}
        {groups.map((group) => (
          <MarketQuestion key={group.title} title={group.title} explain={group.explain} options={group.options} selectedIds={selectedIds} onPick={onPick} locked={isLocked} />
        ))}
      </div>
    </>
  );
}

// Compact live-event timeline rendered between MatchHero and the betting
// markets in <FootballScreen>.  Pulls events from the api-sports `events`
// array (forwarded by FastAPI as `match.liveEvents`) and renders one row
// per significant moment: goals, cards, substitutions, VAR.  Hidden when
// the match has no events (early prematch, or api-sports lacks coverage).
//
// The display goal is at-a-glance comprehension during a 滚球 bet — the
// user shouldn't have to leave the page to know who scored at 67' or
// which team just got a red card.  Side coloring (home/away) is
// intentionally bold so the user can scan without reading team names.
function LiveEventsTimeline({ match }: { match: FootballMatch }) {
  const events = match.liveEvents;
  // Render nothing when there are no events to show — collapses cleanly
  // for prematch matches and small-league fixtures without coverage.
  if (!events || events.length === 0) return null;

  // Newest events first — easier to scan when scrolling stops at the top.
  const ordered = [...events].reverse();

  return (
    <Card className="space-y-1.5 px-3 py-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] font-bold text-[var(--cg-text-72)]">比赛事件</h3>
        <span className="text-[10px] font-bold text-[var(--cg-text-56)]">
          {match.home}（主） · {match.away}（客）
        </span>
      </div>
      <ul className="space-y-1">
        {ordered.map((ev, idx) => (
          <LiveEventRow key={`${ev.m}-${ev.s}-${ev.t}-${idx}`} ev={ev} match={match} />
        ))}
      </ul>
    </Card>
  );
}

function LiveEventRow({ ev, match }: { ev: ApiSportsLiveEvent; match: FootballMatch }) {
  // Stoppage-time formatting: "45+3'" not "48'".  api-sports gives us
  // both the regulation minute and the extra minutes separately so we
  // don't have to guess the period boundary.
  const minute = ev.x ? `${ev.m}+${ev.x}'` : `${ev.m}'`;

  // Map the api-sports type / detail combination onto an icon + Chinese
  // label.  The mapping is intentionally exhaustive for the four types
  // the ingest passes through; unknown types fall back to a generic dot
  // and the raw detail string so we never silently drop a feed entry.
  const { icon, label, tone } = describeEvent(ev);

  // Side coloring: home gets blue accent (matches MatchHero's home column),
  // away gets red.  Unknown side ('?', e.g. a generic VAR review) renders
  // neutral grey.
  const sideClass =
    ev.s === "h" ? "border-l-[#1e7a8c] bg-[#f0fafc]" :
    ev.s === "c" ? "border-l-[#e76565] bg-[#fff5f5]" :
    "border-l-[#cbd5e1] bg-[#f8fafc]";

  // Player + assist line.  Goal events typically carry both; cards/subs
  // only have the affected player.  Render assist in muted text after
  // the player name so the eye lands on the scorer first.
  const playerLine = ev.p
    ? (ev.a ? <>
        <span className="font-bold">{ev.p}</span>
        <span className="ml-1 text-[10px] text-[var(--cg-text-56)]">(助攻 {ev.a})</span>
      </>
      : <span className="font-bold">{ev.p}</span>)
    : null;

  return (
    <li
      className={cx(
        "flex items-center gap-2 rounded border-l-4 px-2 py-1.5 text-[12px] leading-tight",
        sideClass,
      )}
    >
      <span className="w-10 shrink-0 text-[11px] font-black tabular-nums text-[var(--cg-text-72)]">
        {minute}
      </span>
      <span className="text-[14px] leading-none" aria-hidden>{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cx("text-[11px] font-bold", tone)}>{label}</span>
        {playerLine && <span className="truncate text-[11px] text-[var(--cg-text-72)]">{playerLine}</span>}
      </div>
      {/* Side-tag tail: the team name in tiny mono so a user who hasn't
          internalised the color code can still read off who did what. */}
      <span className="shrink-0 text-[10px] font-bold text-[var(--cg-text-56)]">
        {ev.s === "h" ? match.home : ev.s === "c" ? match.away : "—"}
      </span>
    </li>
  );
}

function describeEvent(ev: ApiSportsLiveEvent): { icon: string; label: string; tone: string } {
  const t = ev.t;
  const d = (ev.d || "").toLowerCase();
  if (t === "Goal") {
    if (d.includes("own")) return { icon: "⚽", label: "乌龙球", tone: "text-[#9333ea]" };
    if (d.includes("penalty") && d.includes("missed")) {
      return { icon: "✗", label: "罚失点球", tone: "text-[#b91c1c]" };
    }
    if (d.includes("penalty")) return { icon: "⚽", label: "点球破门", tone: "text-[#16a34a]" };
    return { icon: "⚽", label: "进球", tone: "text-[#16a34a]" };
  }
  if (t === "Card") {
    if (d.includes("red") || d.includes("second yellow")) {
      return { icon: "🟥", label: "红牌", tone: "text-[#dc2626]" };
    }
    return { icon: "🟨", label: "黄牌", tone: "text-[#d97706]" };
  }
  if (t === "subst") {
    return { icon: "🔄", label: "换人", tone: "text-[#0369a1]" };
  }
  if (t === "Var") {
    return { icon: "📺", label: `VAR · ${ev.d}`, tone: "text-[#475569]" };
  }
  // Unknown event type: surface raw detail so we don't silently drop info.
  return { icon: "•", label: ev.d || ev.t || "事件", tone: "text-[var(--cg-text-56)]" };
}

function MatchHero({ match, marketsSource = null }: { match: FootballMatch; marketsSource?: string | null }) {
  // Four states:
  //   - ended         → match.status === "locked" (settled/cancelled/stale)
  //   - liveOdds      → in-play with WS-served 滚球 markets, bet-able
  //   - stalePrematch → in-play but only prematch r_cn cached, LOCKED
  //                     until the WS relay pushes a fresh 滚球 frame
  //   - prematch      → default, prematch markets bet-able
  const isInplay = match.rawStatus === "inplay" || match.rawStatus === "live";
  const liveOdds = isInplay && marketsSource === "ws_live";
  const stalePrematch = isInplay && marketsSource !== null && marketsSource !== "ws_live";
  const isEnded = match.status === "locked" && !isInplay;
  const chipTone: "red" | "orange" | "green" = liveOdds ? "red" : (isEnded || stalePrematch) ? "orange" : "orange";
  const chipLabel = isEnded
    ? `已锁单 · ${match.lockLabel}`
    : liveOdds
      ? `滚球进行中`
      : stalePrematch
        ? `已锁单 · 进行中`
        : `距锁单 ${match.lockLabel}`;
  const subtext = liveOdds
    ? `${match.kickoff} 开赛 · 当前为滚球盘口，赔率随实时比分波动。下单前请确认报价。`
    : stalePrematch
      ? `${match.kickoff} 开赛 · 赛事已进入滚球，赛前报价已失效。请等滚球盘推送。`
      : `${match.kickoff} 开赛 · 默认按 90 分钟常规时间结算，不含加时和点球。`;
  return (
    <Card>
      <div className="flex items-center justify-between"><Chip tone="green">{match.stage}</Chip><Chip tone={chipTone}>{chipLabel}</Chip></div>
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <h2 className="truncate text-[26px] font-black">{match.home}</h2>
        <span className="text-[13px] font-black text-[var(--cg-text-56)]">vs</span>
        <h2 className="truncate text-right text-[26px] font-black">{match.away}</h2>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-[var(--cg-text-56)]">{subtext}</p>
    </Card>
  );
}

function ModeSwitch({ active, go }: { active: "football" | "pro"; go: (screen: Screen) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-[20px] border border-[var(--cg-border)] bg-white p-1.5">
      <button type="button" onClick={() => go("football")} className={cx("rounded-[16px] py-2.5 text-[13px] font-black", active === "football" ? "bg-[var(--cg-green)] text-white" : "text-[var(--cg-text-64)]")}>新手模式</button>
      <button type="button" onClick={() => go("pro")} className={cx("rounded-[16px] py-2.5 text-[13px] font-black", active === "pro" ? "bg-[var(--cg-green)] text-white" : "text-[var(--cg-text-64)]")}>老玩家模式</button>
    </div>
  );
}

// 默认折叠阈值：超过 6 个 outcome 的盘口默认只展示前 6 项，其余折叠。
const COLLAPSE_THRESHOLD = 6;

function MarketQuestion({ title, explain, options, selectedIds, onPick, locked = false }: { title: string; explain: string; options: OutcomeOption[]; selectedIds: Set<string>; onPick: (option: OutcomeOption, locked?: boolean) => void; locked?: boolean }) {
  return (
    <MarketCard
      title={title}
      explain={explain}
      options={options}
      selectedIds={selectedIds}
      onPick={onPick}
      locked={locked}
    />
  );
}

// 通用盘口卡片：自带"展开 / 收起"折叠交互，新手 / 老玩家模式共用。
function MarketCard({
  title,
  explain,
  options,
  selectedIds,
  onPick,
  mapping,
  compact = false,
  locked = false,
}: {
  title: string;
  explain: string;
  options: OutcomeOption[];
  selectedIds: Set<string>;
  onPick: (option: OutcomeOption, locked?: boolean) => void;
  mapping?: string[];
  compact?: boolean;
  locked?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = options.length > COLLAPSE_THRESHOLD;
  const visible = collapsible && !expanded ? options.slice(0, COLLAPSE_THRESHOLD) : options;
  const hidden = options.length - visible.length;
  // 三列网格仅在恰好三个 outcome 时启用（典型 ML / 半场胜负）；
  // 其余情况一律两列，避免大盘口被挤成又窄又难点。
  const gridCols = options.length === 3 ? "grid-cols-3" : "grid-cols-2";
  return (
    <Card className={cx(compact ? "p-3" : "", locked ? "opacity-70" : "")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className={cx("font-black", compact ? "text-[15px]" : "text-[16px]")}>{title}</h3>
          <p className={cx("mt-1 leading-5 text-[var(--cg-text-56)]", compact ? "text-[11px] leading-4" : "text-[12px]")}>{explain}</p>
        </div>
        <button type="button" className="shrink-0 text-[11px] font-black text-[#9ca3af]">规则</button>
      </div>
      <div className={cx("mt-3 grid gap-2", gridCols)}>
        {visible.map((option) => (
          <OutcomeButton key={option.id} option={option} active={selectedIds.has(option.id)} onPick={onPick} disabled={locked} />
        ))}
      </div>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 w-full rounded-[14px] border border-dashed border-[#cbd5e1] bg-[#f8fafc] py-2 text-[12px] font-black text-[#475569] hover:border-[var(--cg-brown)] hover:text-[var(--cg-gold)]"
        >
          {expanded ? `收起（共 ${options.length} 项）` : `展开剩余 ${hidden} 项`}
        </button>
      )}
      {mapping && mapping.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {mapping.map((item) => (
            <code key={item} className="rounded-lg bg-[#f1f5f9] px-2 py-1 text-[10px] font-bold text-[#334155]">{item}</code>
          ))}
        </div>
      )}
    </Card>
  );
}

function OutcomeButton({ option, active, onPick, disabled = false }: { option: OutcomeOption; active: boolean; onPick: (option: OutcomeOption, locked?: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(option, disabled)}
      className={cx(
        "min-h-[58px] rounded-[15px] border bg-white p-2.5 text-left transition active:scale-[0.98] disabled:opacity-45",
        active ? "border-2 border-[var(--cg-gold)] bg-[var(--cg-gold)]/15 p-[9px]" : "border-[var(--cg-border)] hover:border-[var(--cg-gold)]"
      )}
    >
      <strong className="block truncate text-[13px] font-black">{option.label}</strong>
      <span className="mt-1 block font-mono text-[16px] font-black text-[var(--cg-gold-deep)]">{option.odds.toFixed(2)}</span>
      {option.previousOdds && <small className="text-[10px] text-[#f59e0b]">原 {option.previousOdds.toFixed(2)}</small>}
    </button>
  );
}

function ProScreen({
  match,
  activeTab,
  setActiveTab,
  groups,
  selectedIds,
  onPick,
  go,
  loading,
  error,
  walletAddress,
  walletBalance,
  marketsSource,
}: {
  match: FootballMatch;
  activeTab: ProTab;
  setActiveTab: (tab: ProTab) => void;
  groups: ProMarketGroup[];
  selectedIds: Set<string>;
  onPick: (option: OutcomeOption, locked?: boolean) => void;
  go: (screen: Screen) => void;
  loading: boolean;
  error: string | null;
  walletAddress: string;
  walletBalance: string;
  marketsSource: string | null;
}) {
  // Lock rules (mirrors FootballScreen above):
  //   - settled/cancelled                       → always locked
  //   - in-play + markets sourced from WS (滚球) → bet-able
  //   - in-play + markets sourced from r_cn     → LOCKED (stale prematch)
  //   - prematch                                → bet-able
  const isInplay = match.rawStatus === "inplay" || match.rawStatus === "live";
  const liveOdds = isInplay && marketsSource === "ws_live";
  const stalePrematch = isInplay && marketsSource !== null && marketsSource !== "ws_live";
  const isLocked = match.status === "locked" || stalePrematch;
  const lockLabel = liveOdds       ? "滚球进行中"
                  : stalePrematch  ? "已锁单 · 进行中"
                  : isLocked       ? "已锁单"
                  :                  "未锁单";
  const lockTone: "red" | "orange" | "green" = liveOdds ? "red"
                  : stalePrematch ? "orange"
                  : isLocked      ? "orange"
                  :                 "green";
  const lockNote = liveOdds
    ? `${match.kickoff} 开赛 · 当前为滚球盘口，赔率随实时比分波动。下单前请确认报价。`
    : stalePrematch
      ? `${match.kickoff} 开赛 · 赛事已进入滚球，赛前报价已失效。请等滚球盘推送。`
      : `${match.kickoff} 开赛 · 开赛前 5 分钟停止下单、卖出、挂单和撮合。`;
  return (
    <>
      <AppHeader title="足球场次 · 老玩家全市场" back={() => go("football")} walletAddress={walletAddress} walletBalance={walletBalance} />
      <div className="space-y-3 p-4">
        <Card>
          <div className="flex items-center justify-between"><h2 className="text-[18px] font-black">{matchTitle(match)}</h2><Chip tone={lockTone}>{lockLabel}</Chip></div>
          <p className="mt-2 text-[12px] leading-5 text-[var(--cg-text-56)]">{lockNote}</p>
        </Card>
        <ModeSwitch active="pro" go={go} />
        {isLocked && (
          <Card className="border-[#fecaca] bg-[#fff0ef]">
            <p className="text-center text-[12px] font-bold text-[#b91c1c]">本场已锁单，盘口仅供查看，不能继续下注。</p>
          </Card>
        )}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {proTabs.map((tab) => (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={cx("rounded-full border px-3 py-1.5 text-[11px] font-black", activeTab === tab.id ? "border-[#cfe0ff] bg-[var(--cg-gold)]/15 text-[var(--cg-gold-deep)]" : "border-transparent bg-white text-[var(--cg-text-64)]")}>{tab.label}</button>
          ))}
        </div>
        <div key={activeTab} className="space-y-3">
          {groups.map((group) => (
            <MarketCard
              key={`${group.tab}-${group.title}`}
              title={group.title}
              explain={group.explain}
              options={group.options}
              selectedIds={selectedIds}
              onPick={onPick}
              mapping={group.mapping}
              compact
              locked={isLocked}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function BetSlipBar({
  selections,
  totals,
  open,
  walletConnected,
  walletBalanceUsdt,
  walletBalanceNative,
  stakeCurrency,
  walletFxRate,
}: {
  selections: SlipSelection[];
  totals: { totalStake: number; maxReturn: number; hasConflict: boolean };
  open: () => void;
  walletConnected: boolean;
  walletBalanceUsdt: number | null;
  walletBalanceNative: number | null;
  stakeCurrency: "USDT" | "RMB";
  walletFxRate: number;
}) {
  if (selections.length === 0) return null;
  const fxr = walletFxRate > 0 ? walletFxRate : 1;
  const cN = curName(stakeCurrency);
  const balInCur = stakeCurrency === "RMB"
    ? (walletBalanceNative ?? (walletBalanceUsdt != null ? walletBalanceUsdt * fxr : null))
    : walletBalanceUsdt;
  const balanceLabel =
    walletConnected && balInCur != null
      ? `可用 ${balInCur.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cN}`
      : "未登陆";
  const insufficient =
    walletConnected &&
    balInCur != null &&
    totals.totalStake > 0 &&
    totals.totalStake > balInCur;
  const stakeFmt = totals.totalStake.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-[8] mx-3 flex h-[56px] items-center justify-between rounded-lg bg-[var(--cg-brown)] px-3 text-white shadow-[0_-4px_20px_rgba(0,0,0,.15)] min-[1024px]:hidden">
      <div className="min-w-0">
        <b className="text-[14px]">购物车 {selections.length} 项</b>
        <small className={cx("mt-0.5 block truncate text-[11px]", insufficient ? "text-[#fecaca]" : "text-white/50")}>
          {totals.hasConflict
            ? "存在串关冲突，请处理"
            : `总投 ${stakeFmt} ${cN} · ${balanceLabel}`}
        </small>
      </div>
      <button type="button" onClick={open} className="rounded-lg bg-[var(--cg-green)] px-4 py-2 text-[13px] font-bold">去下单</button>
    </div>
  );
}

// ===========================================================================
// MatchInfoSidebar — right-column widget stack for the selected match.
// ---------------------------------------------------------------------------
// Mirrors the legacy SPA's right column: a video pane at the top, then a
// 6-icon tab strip (video / pitch tracker / statistics / text commentary /
// head-to-head / standings). Each card is fetched lazily on first reveal
// from api_v2.php and refreshed every 15s while the match is in-play.
// ===========================================================================

// `lmt` is the always-visible top widget; the other 4 keys map to secondary
// cards rendered below the icon strip. The legacy "tracker" / "video" icons
// were merged into a single `lmt` slot since the Sportradar Live Match
// Tracker (lmtPlus) widget already provides both functions in one frame.
type SidebarCardKey =
  | "lmt"           // top LMT pane toggle (placeholder until SR/widget licensed)
  | "tactical"      // 战术 — formation + 22-dot pitch from api-sports lineups
  | "stats"         // 统计 — api-sports.io /fixtures/statistics
  | "timeline"      // 文字直播 — events stream
  | "highlights"    // 集锦 — ScoreBat embed (goal videos)
  | "h2h"           // 一对一 — historical head-to-head
  | "standings";    // 排名 — league standings

// Sportradar `client_id` for the widget loader CDN. Hard-coded for now —
// later we'll resolve this from server config so different deployments can
// use different Sportradar tenants. The companion static page that actually
// loads the widget is at /h5/sr-widget.html (Next public/ asset).
const SR_CLIENT_ID = "2370877a0ce04fbfdc9678dae41d4210";
// Demo Sportradar matchId used until we wire up Crown gid → SR matchId
// resolution on the backend. Lets every right-column widget render real SR
// content end-to-end during development. Keep this as the doc example.
const SR_DEMO_MATCH_ID = 67172568;
const SR_WIDGET_PATH = "/h5/sr-widget.html";

const sidebarIcons: Array<{ key: SidebarCardKey; title: string; svg: ReactNode }> = [
  {
    key: "lmt",
    title: "直播 / 球场动画",
    svg: <svg viewBox="0 0 24 24" className="size-[18px] fill-current"><path d="M8 5v14l11-7z" /></svg>,
  },
  {
    // 战术 — drawn in-house from api-sports.io lineup grid coords (no
    // Sportradar / Sofascore dependency). Pitch + 22 player dots + formation.
    key: "tactical",
    title: "战术",
    svg: <svg viewBox="0 0 24 24" className="size-[18px] fill-none stroke-current" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="1" /><line x1="12" y1="5" x2="12" y2="19" /><circle cx="12" cy="12" r="2.5" /><circle cx="6" cy="12" r="1.2" fill="currentColor" /><circle cx="18" cy="12" r="1.2" fill="currentColor" /></svg>,
  },
  {
    key: "stats",
    title: "统计",
    svg: <svg viewBox="0 0 24 24" className="size-[18px] fill-current"><path d="M5 9h4v12H5zm6-6h4v18h-4zm6 9h4v9h-4z" /></svg>,
  },
  {
    key: "timeline",
    title: "文字直播",
    svg: <svg viewBox="0 0 24 24" className="size-[18px] fill-current"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.34 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.44 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z" /></svg>,
  },
  {
    // 集锦 — ScoreBat embed (free goal video widget, attribution required).
    key: "highlights",
    title: "集锦",
    svg: <svg viewBox="0 0 24 24" className="size-[18px] fill-current"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4Z" /></svg>,
  },
  {
    key: "h2h",
    title: "一对一",
    svg: <svg viewBox="0 0 24 24" className="size-[18px]"><text x="3" y="17" fontSize="11" fontWeight="900" fill="currentColor">VS</text></svg>,
  },
  {
    key: "standings",
    title: "排名",
    svg: <svg viewBox="0 0 24 24" className="size-[18px] fill-current"><path d="M3 5h18v3H3zm0 5h18v3H3zm0 5h18v3H3z" /></svg>,
  },
];

function MatchInfoSidebar({ match }: { match: FootballMatch }) {
  // Default to "stats" so the user immediately sees the secondary card pane
  // below the LMT widget on first selection — matches the screenshot.
  const [activeCard, setActiveCard] = useState<SidebarCardKey | null>("stats");
  const [collapsed, setCollapsed] = useState(false);
  const [lmtVisible, setLmtVisible] = useState(true);
  const isLive = match.rawStatus === "inplay" || match.rawStatus === "live";

  return (
    <div className="flex flex-col">
      {/* Top: Sportradar Live Match Tracker — always rendered (unless the
          user hides it via the ▶ icon). Replaces the old VideoCard / placeholder
          gray pane with a real SR `match.lmtPlus` widget showing pitch
          animation, ball positions, and live event icons. */}
      {lmtVisible && <LiveMatchTrackerCard match={match} widgetType="match.lmtPlus" />}

      {/* Icon tab strip — 5 buttons. The first toggles the top LMT pane; the
          other 4 toggle secondary cards below. */}
      <div className="flex items-center justify-between bg-white border-b border-[var(--cg-separator)] px-1">
        <div className="flex flex-1 items-center justify-around py-2">
          {sidebarIcons.map((tab) => {
            const isLmtTab = tab.key === "lmt";
            const isActive = isLmtTab ? lmtVisible : activeCard === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  if (isLmtTab) {
                    setLmtVisible((v) => !v);
                  } else {
                    setActiveCard((cur) => (cur === tab.key ? null : tab.key));
                    setCollapsed(false);
                  }
                }}
                title={tab.title}
                className={cx(
                  "grid size-9 place-items-center rounded-full transition",
                  isActive
                    ? "bg-[var(--cg-gold)] text-white"
                    : "text-[var(--cg-text-72)] hover:bg-[var(--cg-bg-light)]",
                  isLive && isLmtTab && !isActive && "animate-pulse text-[var(--cg-gold-deep)]"
                )}
              >
                {tab.svg}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="grid size-9 place-items-center text-[var(--cg-text-56)] hover:text-[var(--cg-text)]"
          title={collapsed ? "展开" : "折叠"}
        >
          <svg viewBox="0 0 24 24" className={cx("size-4 fill-current transition", collapsed ? "rotate-180" : "")}>
            <path d="M7 14l5-5 5 5z" />
          </svg>
        </button>
      </div>

      {/* Active card body */}
      {!collapsed && activeCard && activeCard !== "lmt" && (
        <div className="relative border-b border-[var(--cg-separator)] bg-white">
          <SidebarCardHeader title={sidebarIcons.find((t) => t.key === activeCard)!.title} onClose={() => setActiveCard(null)} />
          {activeCard === "tactical" && <TacticalCard match={match} />}
          {activeCard === "stats" && <StatisticsCard match={match} />}
          {activeCard === "timeline" && <TimelineCard match={match} />}
          {activeCard === "highlights" && <HighlightsCard match={match} />}
          {activeCard === "h2h" && <H2HCard match={match} />}
          {activeCard === "standings" && <StandingsCard match={match} />}
        </div>
      )}
    </div>
  );
}

// ----- Live Match Tracker (Sportradar match.lmtPlus widget) -----------------
// Top-of-sidebar widget that replaces the legacy VideoCard placeholder. It
// renders a sandboxed iframe pointing at /h5/sr-widget.html which loads the
// Sportradar widgetloader for the configured `client_id`. The iframe is keyed
// on (matchId, widgetType) so switching widget types or selected matches
// triggers a clean reload of the SR loader.
function LiveMatchTrackerCard({ match, widgetType }: { match: FootballMatch; widgetType: string }) {
  // Crown gid → Sportradar matchId mapping. Until the backend ships the
  // mapping table, only matches we've explicitly mapped get a real LMT;
  // every other selection shows a "直播信号获取中" placeholder so users
  // aren't shown a different fixture's animation under their match's
  // header. The single dev/demo entry below proves the SR pipeline works
  // end-to-end. Add more keys here (or replace with a backend lookup)
  // as Sportradar IDs become available.
  const SR_MATCH_ID_MAP: Record<string, number> = {
    // [crownGid]: sportradarMatchId
  };
  const srMatchId = SR_MATCH_ID_MAP[match.id] ?? null;
  if (srMatchId == null) {
    // No live signal — show a friendly placeholder. Same height as the
    // real widget so toggling the ▶ icon doesn't reflow the sidebar.
    return (
      <div className="flex h-[280px] w-full flex-col items-center justify-center gap-2 bg-[#1a1a1a] text-white">
        <svg viewBox="0 0 24 24" className="size-7 fill-white/40">
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z" />
        </svg>
        <div className="text-[13px] font-bold text-white/80">该赛事暂未授权直播</div>
        <div className="px-6 text-center text-[11px] leading-4 text-white/40">
          {match.home} vs {match.away}
          <br />
          可在下方查看比分 / 统计 / 战报
        </div>
      </div>
    );
  }
  const url = `${SR_WIDGET_PATH}?matchId=${srMatchId}&type=${encodeURIComponent(widgetType)}&lang=zh`;
  return (
    <div className="bg-[#1a1a1a]">
      <iframe
        src={url}
        key={`${match.id}-${srMatchId}-${widgetType}`}
        className="block h-[280px] w-full border-0 bg-[#1a1a1a]"
        title={widgetType}
        loading="lazy"
        // Sportradar's widget needs script + same-origin to talk to its CDN
        // and inject DOM into our container; both are safe since the page
        // we load (sr-widget.html) is our own asset.
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
}

function SidebarCardHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex h-9 items-center justify-between border-b border-[var(--cg-separator)] bg-[var(--cg-bg-light)] px-3">
      <span className="text-[13px] font-bold text-[var(--cg-text)]">{title}</span>
      <button
        type="button"
        onClick={onClose}
        className="grid size-6 place-items-center text-[var(--cg-text-56)] hover:text-[var(--cg-text)]"
      >
        ✕
      </button>
    </div>
  );
}

// ----- Video card -----------------------------------------------------------
// Always visible at the top of the sidebar. Shows a 16:9 black pane with the
// score HUD overlaid in the corner. If no stream is licensed for this event
// (api returns url=null), the pane shows the "暂未提供" message.
function VideoCard({ match }: { match: FootballMatch }) {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const isLive = match.rawStatus === "inplay" || match.rawStatus === "live";

  useEffect(() => {
    let cancelled = false;
    setStreamUrl(null);
    setReason(null);
    oddsApi.getStream(match.id).then((r) => {
      if (cancelled) return;
      setStreamUrl(r.url);
      setReason(r.reason ?? null);
    }).catch(() => {
      if (cancelled) return;
      setReason("error");
    });
    return () => { cancelled = true; };
  }, [match.id]);

  return (
    <div className="relative aspect-[16/9] w-full overflow-hidden bg-[#1a1a1a]">
      {streamUrl ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={streamUrl} controls autoPlay className="size-full" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white/60 text-[12px]">
          <svg viewBox="0 0 24 24" className="mb-2 size-12 fill-current opacity-40"><path d="M8 5v14l11-7z" /></svg>
          <div>{reason === "unavailable" ? "直播暂未提供" : reason ? "直播加载失败" : "正在尝试加载直播…"}</div>
          <div className="mt-1 text-[11px] opacity-60">谢您的耐心。</div>
        </div>
      )}
      {/* Score HUD */}
      <div className="absolute left-2 top-2 z-[2] flex items-center gap-3 rounded bg-black/50 px-2 py-1 text-white">
        <div className="flex flex-col text-[11px]">
          <span className="font-bold leading-tight">{match.home}</span>
          <span className="font-bold leading-tight">{match.away}</span>
        </div>
        <div className="flex flex-col items-center text-[14px] font-black leading-tight">
          <span>{match.scoreHome ?? 0}</span>
          <span>{match.scoreAway ?? 0}</span>
        </div>
        {isLive && (
          <div className="ml-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold">LIVE</div>
        )}
      </div>
    </div>
  );
}

// ----- Tracker card ---------------------------------------------------------
function TrackerCard({ match }: { match: FootballMatch }) {
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    oddsApi.getTracker(match.id).then((r) => {
      if (cancelled) return;
      setWidgetUrl(r.widget_url);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [match.id]);

  if (widgetUrl) {
    return <iframe src={widgetUrl} className="aspect-[16/9] w-full border-0" title="比赛追踪" />;
  }
  // Fallback: static SVG pitch with team names
  return (
    <div className="px-3 py-6 text-center">
      <svg viewBox="0 0 320 200" className="mx-auto h-32 w-full max-w-[320px]">
        <rect x="2" y="2" width="316" height="196" fill="#2f7a4f" stroke="#fff" strokeWidth="2" />
        <line x1="160" y1="2" x2="160" y2="198" stroke="#fff" strokeWidth="2" />
        <circle cx="160" cy="100" r="22" fill="none" stroke="#fff" strokeWidth="2" />
        <rect x="2" y="60" width="40" height="80" fill="none" stroke="#fff" strokeWidth="2" />
        <rect x="278" y="60" width="40" height="80" fill="none" stroke="#fff" strokeWidth="2" />
        <text x="40" y="195" fill="#fff" fontSize="10" textAnchor="middle">{match.home}</text>
        <text x="280" y="195" fill="#fff" fontSize="10" textAnchor="middle">{match.away}</text>
      </svg>
      <div className="mt-3 text-[12px] text-[var(--cg-text-56)]">现场追踪图正在接入中</div>
    </div>
  );
}

// ----- Tactical card --------------------------------------------------------
// Renders both teams' formation on a single pitch SVG: GK at the back,
// then defenders / midfielders / forwards by grid row. Data source is
// api-sports.io `/fixtures/lineups` (proxied through api_v2.php). Drawing
// is fully in-house (no Sportradar / Sofascore) so we side-step both the
// commercial licensing and the anti-bot challenges those providers have
// in place for free public use.
function TacticalCard({ match }: { match: FootballMatch }) {
  const [data, setData] = useState<MatchLineupsResp | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    oddsApi.getLineups(match.id).then((r) => {
      if (cancelled) return;
      setData(r);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [match.id]);

  if (loading && !data) {
    return <div className="p-4 text-center text-[12px] text-[var(--cg-text-56)]">正在加载阵容…</div>;
  }
  if (!data || !data.mapped) {
    return (
      <div className="p-4 text-center text-[12px] text-[var(--cg-text-56)]">
        该赛事暂未匹配到阵容数据源
      </div>
    );
  }
  if (data.teams.length < 2 || data.teams.some((t) => t.startXI.length === 0)) {
    return (
      <div className="px-4 py-6 text-center">
        <div className="text-[13px] font-bold text-[var(--cg-text)]">阵容发布前不可见</div>
        <div className="mt-1 text-[11px] leading-4 text-[var(--cg-text-56)]">
          通常开赛前 30–60 分钟<br />教练正式公布首发阵容
        </div>
      </div>
    );
  }
  const [home, away] = data.teams;
  return <TacticalPitch home={home} away={away} matchHome={match.home} matchAway={match.away} />;
}

// SVG pitch + 22 player dots. ViewBox is 320×460 (portrait) so the pitch
// fills the sidebar nicely on mobile and desktop alike. Home team plays
// top→bottom (attacks the away end at y=0), away team mirrors. `grid` is
// "row:col" — row 1=GK, 4=FWD. Col is 1..N from sideline to sideline
// where N is implicit from the formation row width.
function TacticalPitch({
  home, away, matchHome, matchAway,
}: { home: LineupTeam; away: LineupTeam; matchHome: string; matchAway: string }) {
  // Pitch metrics. Each team's half is 230 units tall (out of 460), with
  // 4 rows (GK + 3 outfield bands). The half-line is at y=230.
  const W = 320;
  const H = 460;
  const HALF = H / 2;
  const ROW_OFFSETS = [0.93, 0.74, 0.55, 0.36]; // GK (deepest) → FWD (nearest half-line)

  // Parse "row:col" and place a dot. `side` is "home" (bottom half) or
  // "away" (top half — y is flipped).
  function positionFor(grid: string | null, rowMaxCol: number, side: "home" | "away") {
    if (!grid) return null;
    const [r, c] = grid.split(":").map((n) => parseInt(n, 10));
    if (Number.isNaN(r) || Number.isNaN(c)) return null;
    const rowIdx = Math.max(1, Math.min(4, r)) - 1;
    const colPos = (c - 0.5) / Math.max(1, rowMaxCol);  // 0..1 left→right
    // X: api-sports.io grid uses col=1 on the team's RIGHT (looking at
    // their attacking direction). Mirror for the away team so both sides
    // converge correctly on the same pitch.
    const x = side === "home"
      ? (1 - colPos) * (W - 24) + 12
      : colPos * (W - 24) + 12;
    const yNorm = ROW_OFFSETS[rowIdx];
    const y = side === "home"
      ? HALF + (1 - yNorm) * HALF
      : yNorm * HALF;
    return { x, y };
  }

  // Compute max col-per-row to scale horizontal spacing. Two teams might
  // have different formations (e.g. 4-3-3 vs 3-5-2), so we compute each
  // independently.
  function rowMaxColMap(team: LineupTeam): Record<number, number> {
    const m: Record<number, number> = { 1: 1, 2: 1, 3: 1, 4: 1 };
    for (const p of team.startXI) {
      if (!p.grid) continue;
      const [r, c] = p.grid.split(":").map((n) => parseInt(n, 10));
      if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
      m[r] = Math.max(m[r] ?? 1, c);
    }
    return m;
  }
  const homeMaxCols = rowMaxColMap(home);
  const awayMaxCols = rowMaxColMap(away);

  function renderPlayers(team: LineupTeam, side: "home" | "away", maxCols: Record<number, number>, color: string) {
    return team.startXI.map((p) => {
      const r = p.grid ? parseInt(p.grid.split(":")[0], 10) : 1;
      const pos = positionFor(p.grid, maxCols[r] ?? 1, side);
      if (!pos) return null;
      const key = `${side}-${p.id ?? p.number ?? p.name}`;
      const shortName = (p.name || "").split(" ").slice(-1)[0].slice(0, 10);
      return (
        <g key={key}>
          <circle cx={pos.x} cy={pos.y} r={11} fill={color} stroke="#fff" strokeWidth={1.5} />
          <text x={pos.x} y={pos.y + 3.5} fontSize={9} fontWeight="900" textAnchor="middle" fill="#fff">
            {p.number ?? ""}
          </text>
          <text x={pos.x} y={pos.y + 22} fontSize={8} textAnchor="middle" fill="#fff" style={{ paintOrder: "stroke" }} stroke="rgba(0,0,0,0.5)" strokeWidth={0.5}>
            {shortName}
          </text>
        </g>
      );
    });
  }

  return (
    <div className="px-3 py-3">
      <div className="flex items-center justify-between px-1 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-[#c1392c]" />
          <span className="font-black">{matchAway}</span>
          <span className="text-[var(--cg-text-56)]">· {away.formation ?? "-"}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--cg-text-56)]">{home.formation ?? "-"} ·</span>
          <span className="font-black">{matchHome}</span>
          <span className="inline-block size-2 rounded-full bg-[#3b6fb6]" />
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto mt-2 block aspect-[320/460] w-full max-w-[420px]">
        {/* Pitch surface */}
        <rect x={0} y={0} width={W} height={H} fill="#2f7a4f" />
        {/* Outer touchlines */}
        <rect x={6} y={6} width={W - 12} height={H - 12} fill="none" stroke="#fff" strokeWidth={2} />
        {/* Halfway line + centre circle */}
        <line x1={6} y1={HALF} x2={W - 6} y2={HALF} stroke="#fff" strokeWidth={2} />
        <circle cx={W / 2} cy={HALF} r={32} fill="none" stroke="#fff" strokeWidth={2} />
        <circle cx={W / 2} cy={HALF} r={2} fill="#fff" />
        {/* Top (away) penalty box + 6-yard box + goal */}
        <rect x={(W - 160) / 2} y={6} width={160} height={56} fill="none" stroke="#fff" strokeWidth={2} />
        <rect x={(W - 70) / 2} y={6} width={70} height={20} fill="none" stroke="#fff" strokeWidth={2} />
        <rect x={(W - 36) / 2} y={2} width={36} height={6} fill="none" stroke="#fff" strokeWidth={2} />
        <circle cx={W / 2} cy={48} r={2} fill="#fff" />
        {/* Bottom (home) penalty box + 6-yard box + goal */}
        <rect x={(W - 160) / 2} y={H - 62} width={160} height={56} fill="none" stroke="#fff" strokeWidth={2} />
        <rect x={(W - 70) / 2} y={H - 26} width={70} height={20} fill="none" stroke="#fff" strokeWidth={2} />
        <rect x={(W - 36) / 2} y={H - 8} width={36} height={6} fill="none" stroke="#fff" strokeWidth={2} />
        <circle cx={W / 2} cy={H - 48} r={2} fill="#fff" />

        {renderPlayers(home, "home", homeMaxCols, "#3b6fb6")}
        {renderPlayers(away, "away", awayMaxCols, "#c1392c")}
      </svg>
      {/* Coach + bench summary */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[var(--cg-text-56)]">
        <div>
          <div className="font-bold text-[var(--cg-text)]">{matchAway}</div>
          {away.coach?.name && <div>主帅 · {away.coach.name}</div>}
          <div>替补 {away.substitutes.length}</div>
        </div>
        <div className="text-right">
          <div className="font-bold text-[var(--cg-text)]">{matchHome}</div>
          {home.coach?.name && <div>主帅 · {home.coach.name}</div>}
          <div>替补 {home.substitutes.length}</div>
        </div>
      </div>
    </div>
  );
}

// ----- Highlights card ------------------------------------------------------
// ScoreBat goal-video embed. Their `/embed/team/<slug>` widget streams the
// latest highlight clips for the named team (free, no token required).
// Attribution back-link is required per ScoreBat ToS — we keep the link
// visible at the bottom of the card.
function HighlightsCard({ match }: { match: FootballMatch }) {
  // Slugify the home team name for ScoreBat. They normalise to lowercase
  // hyphenated names — "Inter Milano" → "inter", "Bologna FC" → "bologna".
  // We strip trailing "FC", "CF", "AC", "Milano" suffixes since ScoreBat
  // tends to drop them; fall back to the full slug if no clip matches.
  const slug = scoreBatSlug(match.home || match.away || "");
  const url = `https://www.scorebat.com/embed/team/${encodeURIComponent(slug)}/?token=embed_team_view`;
  return (
    <div className="bg-white">
      <iframe
        src={url}
        title="比赛集锦"
        className="block h-[520px] w-full border-0"
        // ScoreBat serves their own iframe; permissions kept tight.
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        allow="autoplay; fullscreen"
        loading="lazy"
      />
      <div className="px-3 py-2 text-right text-[10px] text-[var(--cg-text-56)]">
        Video highlights by{" "}
        <a href="https://www.scorebat.com/" target="_blank" rel="noopener noreferrer" className="font-bold text-[var(--cg-gold-deep)] underline">
          ScoreBat
        </a>
      </div>
    </div>
  );
}

function scoreBatSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(fc|cf|ac|sc|afc|cfc|fck|milano|milan)\b/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ----- Statistics card ------------------------------------------------------
const STAT_I18N: Record<string, string> = {
  "Ball Possession": "控球",
  "Shots on Goal": "射正球门",
  "Shots off Goal": "射偏",
  "Total Shots": "射门",
  "Blocked Shots": "被封堵",
  "Shots insidebox": "禁区内射门",
  "Shots outsidebox": "禁区外射门",
  "Fouls": "犯规",
  "Corner Kicks": "角球",
  "Offsides": "越位",
  "Yellow Cards": "黄牌",
  "Red Cards": "红牌",
  "Goalkeeper Saves": "扑救",
  "Total passes": "传球",
  "Passes accurate": "成功传球",
  "Passes %": "传球成功率",
  "expected_goals": "预期进球",
};
const STAT_ORDER = [
  "Ball Possession",
  "Yellow Cards",
  "Red Cards",
  "Shots on Goal",
  "Shots off Goal",
  "Total Shots",
  "Corner Kicks",
  "Fouls",
  "Offsides",
  "Goalkeeper Saves",
  "Total passes",
  "Passes accurate",
  "Passes %",
  "expected_goals",
];

function getStatValue(stats: MatchStatisticsResp["teams"][number]["stats"], type: string): string | number | null {
  const r = stats.find((s) => s.type === type);
  return r ? r.value : null;
}
function statPct(v: string | number | null): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const m = /(\d+(?:\.\d+)?)/.exec(String(v));
  return m ? parseFloat(m[1]) : null;
}

function StatisticsCard({ match }: { match: FootballMatch }) {
  const [data, setData] = useState<MatchStatisticsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const isLive = match.rawStatus === "inplay" || match.rawStatus === "live";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = () => {
      oddsApi.getStatistics(match.id).then((r) => {
        if (cancelled) return;
        setData(r);
        setLoading(false);
      }).catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    };
    load();
    if (!isLive) return () => { cancelled = true; };
    const t = window.setInterval(load, 15000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [match.id, isLive]);

  if (loading && !data) return <div className="p-4 text-center text-[12px] text-[var(--cg-text-56)]">正在加载统计…</div>;
  // Three distinct empty states — api-sports.io stats only populate ~10
  // minutes into the match, so an in-play fixture with no rows is normal
  // rather than a mapping failure. Surface that to the user instead of
  // the catch-all "暂未匹配到数据源" copy that previously appeared in both
  // cases and made the feature look broken.
  if (!data || !data.mapped) {
    return (
      <div className="p-4 text-center text-[12px] text-[var(--cg-text-56)]">
        该赛事暂未匹配到统计数据源
      </div>
    );
  }
  if (data.teams.length < 2) {
    return (
      <div className="px-4 py-6 text-center">
        <div className="text-[13px] font-bold text-[var(--cg-text)]">统计数据采集中</div>
        <div className="mt-1 text-[11px] leading-4 text-[var(--cg-text-56)]">
          通常开赛 10–15 分钟后<br />数据源开始推送射门 / 控球 / 传球等指标
        </div>
      </div>
    );
  }

  const [home, away] = data.teams;
  const totalShotsH = statPct(getStatValue(home.stats, "Total Shots")) ?? 0;
  const totalShotsA = statPct(getStatValue(away.stats, "Total Shots")) ?? 0;
  const conversionH = totalShotsH > 0 ? Math.round(((statPct(getStatValue(home.stats, "Shots on Goal")) ?? 0) / totalShotsH) * 100) : 0;
  const conversionA = totalShotsA > 0 ? Math.round(((statPct(getStatValue(away.stats, "Shots on Goal")) ?? 0) / totalShotsA) * 100) : 0;

  return (
    <div className="px-3 pb-4">
      {/* Score HUD */}
      <div className="flex items-center justify-between border-b border-[var(--cg-separator)] py-3">
        <div className="flex-1 truncate text-[13px] font-bold">{match.home}</div>
        <div className="px-3 text-center">
          <div className="text-[20px] font-black tabular-nums">{match.scoreHome ?? 0} : {match.scoreAway ?? 0}</div>
          {match.scoreHomeHt != null && (
            <div className="text-[11px] text-[var(--cg-text-56)] tabular-nums">{match.scoreHomeHt}:{match.scoreAwayHt}</div>
          )}
        </div>
        <div className="flex-1 truncate text-right text-[13px] font-bold">{match.away}</div>
      </div>

      {/* Possession bar */}
      <StatBar
        title="控球"
        leftLabel={String(getStatValue(home.stats, "Ball Possession") ?? "—")}
        rightLabel={String(getStatValue(away.stats, "Ball Possession") ?? "—")}
        leftPct={statPct(getStatValue(home.stats, "Ball Possession")) ?? 0}
        rightPct={statPct(getStatValue(away.stats, "Ball Possession")) ?? 0}
      />

      {/* Cards */}
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-1 text-[13px] font-black">
          <span>{getStatValue(home.stats, "Yellow Cards") ?? 0}</span>
          <span className="inline-block size-3 bg-[#f6c44a]" />
          <span className="inline-block size-3 bg-[#d4380d]" />
          <span>{getStatValue(home.stats, "Red Cards") ?? 0}</span>
        </div>
        <span className="text-[12px] text-[var(--cg-text-56)]">牌</span>
        <div className="flex items-center gap-1 text-[13px] font-black">
          <span>{getStatValue(away.stats, "Yellow Cards") ?? 0}</span>
          <span className="inline-block size-3 bg-[#f6c44a]" />
          <span className="inline-block size-3 bg-[#d4380d]" />
          <span>{getStatValue(away.stats, "Red Cards") ?? 0}</span>
        </div>
      </div>

      {/* Conversion rate */}
      <StatBar
        title="转换率"
        leftLabel={`${conversionH}%`}
        rightLabel={`${conversionA}%`}
        leftPct={conversionH}
        rightPct={conversionA}
        className="mt-4"
      />

      {/* Remaining stats in two-column bars */}
      <div className="mt-4 space-y-2">
        {STAT_ORDER.filter((t) => !["Ball Possession", "Yellow Cards", "Red Cards"].includes(t)).map((t) => {
          const lhs = getStatValue(home.stats, t);
          const rhs = getStatValue(away.stats, t);
          if (lhs == null && rhs == null) return null;
          return <StatRow key={t} title={STAT_I18N[t] ?? t} left={lhs} right={rhs} />;
        })}
      </div>
    </div>
  );
}

function StatBar({
  title, leftLabel, rightLabel, leftPct, rightPct, className = "",
}: {
  title: string;
  leftLabel: string;
  rightLabel: string;
  leftPct: number;
  rightPct: number;
  className?: string;
}) {
  const total = leftPct + rightPct;
  const left = total > 0 ? (leftPct / total) * 100 : 50;
  const right = 100 - left;
  return (
    <div className={cx("text-center", className)}>
      <div className="text-[12px] text-[var(--cg-text-56)]">{title}</div>
      <div className="mt-1 flex items-center justify-between text-[13px] font-black">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
      <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded bg-[var(--cg-bg-light)]">
        <div className="h-full bg-[var(--cg-gold)]" style={{ width: `${left}%` }} />
        <div className="h-full bg-[var(--cg-brown)]" style={{ width: `${right}%` }} />
      </div>
    </div>
  );
}

function StatRow({ title, left, right }: { title: string; left: string | number | null; right: string | number | null }) {
  const lN = statPct(left) ?? 0;
  const rN = statPct(right) ?? 0;
  const total = lN + rN;
  const lPct = total > 0 ? (lN / total) * 100 : 50;
  return (
    <div>
      <div className="flex items-center justify-between text-[12px]">
        <span className="font-bold tabular-nums">{left ?? "—"}</span>
        <span className="text-[var(--cg-text-56)]">{title}</span>
        <span className="font-bold tabular-nums">{right ?? "—"}</span>
      </div>
      <div className="mt-0.5 flex h-1 w-full overflow-hidden rounded bg-[var(--cg-bg-light)]">
        <div className="h-full bg-[var(--cg-gold)]" style={{ width: `${lPct}%` }} />
        <div className="h-full bg-[var(--cg-brown)]" style={{ width: `${100 - lPct}%` }} />
      </div>
    </div>
  );
}

// ----- Timeline card --------------------------------------------------------
const EVENT_I18N: Record<string, string> = {
  "Goal": "进球",
  "Normal Goal": "进球",
  "Own Goal": "乌龙球",
  "Penalty": "点球",
  "Missed Penalty": "罚失点球",
  "Yellow Card": "黄牌",
  "Red Card": "红牌",
  "Second Yellow card": "两黄变红",
  "Substitution 1": "换人",
  "Substitution 2": "换人",
  "Substitution 3": "换人",
  "Substitution 4": "换人",
  "Substitution 5": "换人",
  "subst": "换人",
  "Var": "VAR",
  "Goal cancelled": "进球取消",
  "Penalty confirmed": "判罚点球",
};

function timelineLabel(ev: MatchEventItem): string {
  const detail = EVENT_I18N[ev.detail] || ev.detail;
  if (ev.type === "subst") return EVENT_I18N["subst"];
  if (ev.type === "Card") return detail;
  if (ev.type === "Goal") return detail;
  return EVENT_I18N[ev.type] || ev.type;
}

function TimelineCard({ match }: { match: FootballMatch }) {
  const [events, setEvents] = useState<MatchEventItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(true);
  const isLive = match.rawStatus === "inplay" || match.rawStatus === "live";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = () => {
      oddsApi.getMatchEvents(match.id).then((r) => {
        if (cancelled) return;
        setEvents(r.events ?? []);
        setLoading(false);
      }).catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    };
    load();
    if (!isLive) return () => { cancelled = true; };
    const t = window.setInterval(load, 15000);
    return () => { cancelled = true; window.clearInterval(t); };
  }, [match.id, isLive]);

  if (loading && !events) return <div className="p-4 text-center text-[12px] text-[var(--cg-text-56)]">正在加载文字直播…</div>;
  if (!events || events.length === 0) return <div className="p-4 text-center text-[12px] text-[var(--cg-text-56)]">该赛事暂未提供文字直播</div>;

  const filtered = showAll ? events : events.filter((e) => e.type === "Goal" || e.type === "Card");
  // Latest first
  const ordered = [...filtered].sort((a, b) => {
    const am = (a.minute ?? 0) + (a.extra ?? 0);
    const bm = (b.minute ?? 0) + (b.extra ?? 0);
    return bm - am;
  });

  return (
    <div>
      <div className="flex items-center justify-between border-b border-[var(--cg-separator)] bg-[var(--cg-gold-deep)] px-3 py-1.5 text-white">
        <span className="text-[11px]">{events.length} 条事件</span>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold"
        >
          {showAll ? "仅显示进球/牌" : "显示全部"}
        </button>
      </div>
      <ul className="max-h-[60vh] overflow-y-auto">
        {ordered.map((ev, i) => (
          <li
            key={`${ev.minute}-${ev.extra}-${ev.type}-${i}`}
            className="flex items-start gap-2 border-b border-[var(--cg-separator)] px-3 py-2 cg-slide-in"
          >
            <div className="w-9 shrink-0 text-[11px] font-bold tabular-nums text-[var(--cg-text-72)]">
              {ev.minute ?? "—"}{ev.extra ? `+${ev.extra}` : ""}&apos;
            </div>
            <span className={cx(
              "mt-1 inline-block size-2 shrink-0 rounded-full",
              ev.type === "Goal" ? "bg-[var(--cg-green)]" : ev.type === "Card" ? "bg-[#f6c44a]" : "bg-[var(--cg-gold)]"
            )} />
            <div className="flex-1 text-[12px]">
              <div className="font-bold text-[var(--cg-text)]">{timelineLabel(ev)}</div>
              {(ev.player || ev.team) && (
                <div className="text-[11px] text-[var(--cg-text-56)]">
                  {ev.player || ""}{ev.assist ? ` (助攻 ${ev.assist})` : ""}{ev.team ? ` · ${translateTeam(ev.team)}` : ""}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ----- H2H card -------------------------------------------------------------
function formResult(f: H2HFixtureSummary, homeId: number | null | undefined): "W" | "D" | "L" {
  // From the perspective of `homeId`. We assume the H2H entry's home/away
  // matches the caller, and use the goals to derive the result.
  const sH = f.score_home ?? 0;
  const sA = f.score_away ?? 0;
  if (sH === sA) return "D";
  const isHome = homeId != null && f.home_id === homeId;
  if (isHome) return sH > sA ? "W" : "L";
  // homeId played as away in this fixture
  return sA > sH ? "W" : "L";
}

function H2HCard({ match }: { match: FootballMatch }) {
  const [data, setData] = useState<MatchH2HResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    oddsApi.getH2H(match.id, 10).then((r) => {
      if (cancelled) return;
      setData(r);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [match.id]);

  if (loading && !data) return <div className="p-4 text-center text-[12px] text-[var(--cg-text-56)]">正在加载一对一…</div>;
  if (!data || !data.mapped) return <div className="p-4 text-center text-[12px] text-[var(--cg-text-56)]">该赛事暂未匹配到一对一数据</div>;

  const homeForm = data.home_form ?? [];
  const awayForm = data.away_form ?? [];
  const homeWins = homeForm.filter((f) => formResult(f, data.home?.id ?? null) === "W").length;
  const awayWins = awayForm.filter((f) => formResult(f, data.away?.id ?? null) === "W").length;
  const homeWinPct = homeForm.length > 0 ? Math.round((homeWins / homeForm.length) * 100) : 0;
  const awayWinPct = awayForm.length > 0 ? Math.round((awayWins / awayForm.length) * 100) : 0;

  // Past H2H summary
  const h2hList = data.h2h ?? [];
  const h2hHomeWins = h2hList.filter((f) => formResult(f, data.home?.id ?? null) === "W").length;
  const h2hAwayWins = h2hList.filter((f) => formResult(f, data.away?.id ?? null) === "W").length;
  const h2hDraws = h2hList.length - h2hHomeWins - h2hAwayWins;

  return (
    <div className="px-3 pb-4">
      <div className="flex items-center justify-between py-3">
        <div className="flex-1 truncate text-[13px] font-bold">{match.home}</div>
        <div className="text-[11px] text-[var(--cg-text-56)]">VS</div>
        <div className="flex-1 truncate text-right text-[13px] font-bold">{match.away}</div>
      </div>
      <div className="flex items-center justify-between">
        <FormRing pct={homeWinPct} color="var(--cg-gold)" />
        <div className="text-center">
          <div className="text-[10px] text-[var(--cg-text-56)]">联赛排名</div>
          <div className="mt-1 text-[12px] font-bold tabular-nums">— vs —</div>
        </div>
        <FormRing pct={awayWinPct} color="var(--cg-brown)" />
      </div>

      <div className="mt-4 rounded-md bg-[var(--cg-bg-light)] px-3 py-2 text-center text-[11px] font-bold text-[var(--cg-text-72)]">最后五场比赛</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <FormStrip fixtures={homeForm.slice(0, 5)} teamId={data.home?.id ?? null} />
        <FormStrip fixtures={awayForm.slice(0, 5)} teamId={data.away?.id ?? null} />
      </div>

      <div className="mt-4 rounded-md bg-[var(--cg-bg-light)] px-3 py-2 text-center text-[11px] font-bold text-[var(--cg-text-72)]">过往对赛</div>
      <div className="mt-3 grid grid-cols-3 items-center text-center">
        <div>
          <div className="text-[11px] text-[var(--cg-gold-deep)] font-bold">{match.home} 胜</div>
          <div className="mt-1 text-[20px] font-black text-[var(--cg-gold-deep)] tabular-nums">{h2hHomeWins}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--cg-text-56)] font-bold">平</div>
          <div className="mt-1 text-[20px] font-black tabular-nums">{h2hDraws}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--cg-brown)] font-bold">{match.away} 胜</div>
          <div className="mt-1 text-[20px] font-black text-[var(--cg-brown)] tabular-nums">{h2hAwayWins}</div>
        </div>
      </div>
    </div>
  );
}

function FormRing({ pct, color }: { pct: number; color: string }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, pct)) / 100) * c;
  return (
    <div className="relative grid size-[80px] place-items-center">
      <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--cg-bg-light)" strokeWidth="6" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <div className="text-center">
        <div className="text-[14px] font-black tabular-nums">{pct}%</div>
        <div className="text-[9px] text-[var(--cg-text-56)]">状态</div>
      </div>
    </div>
  );
}

function FormStrip({ fixtures, teamId }: { fixtures: H2HFixtureSummary[]; teamId: number | null }) {
  if (fixtures.length === 0) return <div className="text-center text-[11px] text-[var(--cg-text-56)]">无近期数据</div>;
  return (
    <div className="flex items-center justify-center gap-0.5">
      {fixtures.map((f, i) => {
        const r = formResult(f, teamId);
        const tone = r === "W" ? "bg-[var(--cg-gold-deep)] text-white" : r === "L" ? "bg-[var(--cg-brown)] text-white" : "bg-[var(--cg-bg-light)] text-[var(--cg-text-56)]";
        return (
          <div key={f.fixture_id ?? i} className="text-center">
            <div className={cx("grid size-6 place-items-center text-[10px] font-black", tone)}>
              {r === "W" ? "胜" : r === "L" ? "负" : "平"}
            </div>
            <div className="mt-0.5 text-[9px] tabular-nums text-[var(--cg-text-56)]">{f.score_home ?? "—"}:{f.score_away ?? "—"}</div>
          </div>
        );
      })}
    </div>
  );
}

// ----- Standings card -------------------------------------------------------
function StandingsCard({ match }: { match: FootballMatch }) {
  const [data, setData] = useState<MatchStandingsResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    oddsApi.getStandings(match.id).then((r) => {
      if (cancelled) return;
      setData(r);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [match.id]);

  if (loading && !data) return <div className="p-4 text-center text-[12px] text-[var(--cg-text-56)]">正在加载积分榜…</div>;
  if (!data || !data.mapped || (data.standings?.length ?? 0) === 0) {
    return <div className="p-4 text-center text-[12px] text-[var(--cg-text-56)]">该赛事暂未匹配到积分榜</div>;
  }

  return (
    <div>
      <div className="border-b border-[var(--cg-separator)] px-3 py-1.5">
        <span className="text-[12px] text-[var(--cg-gold-deep)] font-bold border-b-2 border-[var(--cg-gold)] pb-1">总体</span>
      </div>
      <div className="px-3 pt-2 text-[12px] font-bold text-[var(--cg-text-72)]">{data.league_name ?? match.stage}</div>
      <table className="mt-1 w-full text-[11px]">
        <thead>
          <tr className="text-[var(--cg-text-56)]">
            <th className="px-2 py-1 text-left font-normal">排名</th>
            <th className="px-2 py-1 text-left font-normal">队</th>
            <th className="px-1 py-1 text-right font-normal">比赛</th>
            <th className="px-1 py-1 text-right font-normal">胜</th>
            <th className="px-1 py-1 text-right font-normal">平</th>
            <th className="px-1 py-1 text-right font-normal">负</th>
            <th className="px-1 py-1 text-right font-normal">进:失</th>
            <th className="px-1 py-1 text-right font-normal">净</th>
            <th className="px-2 py-1 text-right font-normal">积分</th>
          </tr>
        </thead>
        <tbody>
          {data.standings.map((row) => <StandingsRowView key={row.rank ?? row.team_id} row={row} homeId={data.home_team_id} awayId={data.away_team_id} />)}
        </tbody>
      </table>
    </div>
  );
}

function StandingsRowView({ row, homeId, awayId }: { row: StandingsRow; homeId?: number | null; awayId?: number | null }) {
  const isHighlight = (homeId != null && row.team_id === homeId) || (awayId != null && row.team_id === awayId);
  return (
    <tr className={cx("border-b border-[var(--cg-separator)]", isHighlight && "bg-[var(--cg-gold)]/15 font-bold")}>
      <td className="px-2 py-1 tabular-nums">{row.rank}</td>
      <td className="px-2 py-1 truncate max-w-[120px]">{translateTeam(row.team_name) || row.team_name}</td>
      <td className="px-1 py-1 text-right tabular-nums">{row.played ?? "—"}</td>
      <td className="px-1 py-1 text-right tabular-nums">{row.win ?? "—"}</td>
      <td className="px-1 py-1 text-right tabular-nums">{row.draw ?? "—"}</td>
      <td className="px-1 py-1 text-right tabular-nums">{row.lose ?? "—"}</td>
      <td className="px-1 py-1 text-right tabular-nums">{row.goals_for ?? "—"}:{row.goals_against ?? "—"}</td>
      <td className="px-1 py-1 text-right tabular-nums">{row.goals_diff ?? "—"}</td>
      <td className="px-2 py-1 text-right font-black tabular-nums">{row.points ?? "—"}</td>
    </tr>
  );
}

function BetSlipScreen({
  selections,
  mode,
  totals,
  parlayStake,
  quoteSeconds,
  setMode,
  setParlayStake,
  setSelectionStake,
  removeSelection,
  clear,
  quickAmount,
  openConfirm,
  go,
  walletConnected,
  walletBalanceUsdt,
  walletBalanceNative,
  walletCurrency,
  stakeCurrency,
  setStakeCurrency,
  walletFxRate,
}: {
  selections: SlipSelection[];
  mode: SlipMode;
  totals: { totalStake: number; maxReturn: number; profit: number; combinedOdds: number; hasConflict: boolean; conflictText: string };
  parlayStake: string;
  quoteSeconds: number;
  setMode: (mode: SlipMode) => void;
  setParlayStake: (value: string) => void;
  setSelectionStake: (selectionId: string, value: string) => void;
  removeSelection: (selectionId: string) => void;
  clear: () => void;
  quickAmount: (value: number) => void;
  openConfirm: () => void;
  go: (screen: Screen) => void;
  walletConnected: boolean;
  walletBalanceUsdt: number | null;
  walletBalanceNative: number | null;
  walletCurrency: string;
  stakeCurrency: "USDT" | "RMB";
  setStakeCurrency: (c: "USDT" | "RMB") => void;
  walletFxRate: number;
}) {
  // Currency helpers: convert between USDT and RMB for display.
  const fxr = walletFxRate > 0 ? walletFxRate : 1;
  const balanceInStakeCur = stakeCurrency === "RMB"
    ? (walletBalanceNative ?? (walletBalanceUsdt != null ? walletBalanceUsdt * fxr : null))
    : walletBalanceUsdt;
  const insufficientBalance =
    walletConnected &&
    balanceInStakeCur != null &&
    totals.totalStake > 0 &&
    totals.totalStake > balanceInStakeCur;
  const balanceFmt = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v)
      ? "\u2014"
      : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cLabel = curSymbol(stakeCurrency);
  const cName = curName(stakeCurrency);
  const quickAmounts = stakeCurrency === "RMB" ? [50, 200, 500, 2000, 5000] : [5, 10, 20, 50, 100];
  const fxHint = stakeCurrency === "RMB"
    ? `1 ${curName('USDT')} ≈ ${fxr.toFixed(2)} RMB`
    : `1 RMB ≈ ${(1 / fxr).toFixed(4)} ${curName('USDT')}`;
  return (
    <>
      <AppHeader title="底部预测单 / 购物车" />
      <div className="space-y-3 px-4 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[26px] font-black">预测单</h2>
          <button type="button" onClick={clear} className="text-[12px] font-black text-[#f04438]">清空</button>
        </div>
        {/* Currency toggle */}
        <div className="flex items-center gap-2">
          <div className="grid grid-cols-2 gap-1 rounded-[18px] bg-[#f1f5f9] p-1.5 flex-1">
            <button type="button" onClick={() => setMode("single")} className={cx("rounded-[15px] py-2.5 text-[13px] font-black", mode === "single" ? "bg-[var(--cg-green)] text-white" : "text-[var(--cg-text-56)]")}>单关</button>
            <button type="button" onClick={() => setMode("parlay")} className={cx("rounded-[15px] py-2.5 text-[13px] font-black", mode === "parlay" ? "bg-[var(--cg-green)] text-white" : "text-[var(--cg-text-56)]")}>串关</button>
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-[18px] bg-[#f1f5f9] p-1.5 shrink-0">
            <button type="button" onClick={() => setStakeCurrency("RMB")} className={cx("rounded-[15px] px-3 py-2.5 text-[12px] font-black", stakeCurrency === "RMB" ? "bg-[var(--cg-brown)] text-white" : "text-[var(--cg-text-56)]")}>¥ RMB</button>
            <button type="button" onClick={() => setStakeCurrency("USDT")} className={cx("rounded-[15px] px-3 py-2.5 text-[12px] font-black", stakeCurrency === "USDT" ? "bg-[var(--cg-brown)] text-white" : "text-[var(--cg-text-56)]")}>$ USD</button>
          </div>
        </div>
        <p className="text-[10px] text-[var(--cg-text-56)]">{fxHint} · 汇率每6h更新</p>
        {selections.length === 0 ? (
          <EmptyState title="还没有选择预测项" text="从足球新手模式或老玩家市场点击任意赔率后，会自动加入预测单。" action="去选择" onClick={() => go("footballList")} />
        ) : (
          <div className="space-y-2">
            {selections.map((item) => (
              <div key={item.selectionId} className="min-w-0 rounded-[16px] border border-[var(--cg-border)] bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <b className="block truncate text-[14px]">{item.label}</b>
                    <p className="mt-1 text-[11px] text-[var(--cg-text-56)]">{item.marketTitle} · 赔率 {item.odds.toFixed(2)}</p>
                  </div>
                  <button type="button" onClick={() => removeSelection(item.selectionId)} className="grid size-7 shrink-0 place-items-center rounded-full bg-[#f1f5f9] text-[14px] font-black text-[#94a3b8]">x</button>
                </div>
                {mode === "single" ? (
                  <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(118px,1fr)] gap-3 text-[12px]">
                    <label className="min-w-0 space-y-1">
                      <span className="block font-bold text-[var(--cg-text-56)]">投入 {cLabel} {cName}</span>
                      <input
                        value={item.stake.toString()}
                        onChange={(event) => setSelectionStake(item.selectionId, event.target.value)}
                        className="h-11 w-full rounded-[12px] border border-[var(--cg-border)] px-3 font-mono font-black outline-none focus:border-[var(--cg-brown)]"
                      />
                    </label>
                    <div className="min-w-0 rounded-[12px] bg-[#f8fafc] px-3 py-2">
                      <span className="text-[var(--cg-text-56)]">预计返还</span>
                      <b className="block truncate font-mono text-[#0ead69]">{balanceFmt(item.stake * item.odds)} {cName}</b>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-[11px] text-[var(--cg-text-56)]">串关模式下使用整单投入金额。</p>
                )}
              </div>
            ))}
          </div>
        )}
        {mode === "parlay" && (
          <label className="block space-y-1 rounded-[16px] border border-[var(--cg-border)] bg-white p-3 text-[12px]">
            <span className="font-bold text-[var(--cg-text-56)]">串关总投入 {cLabel} {cName}</span>
            <input value={parlayStake} onChange={(event) => setParlayStake(event.target.value)} className="h-11 w-full rounded-[12px] border border-[var(--cg-border)] px-3 font-mono text-[15px] font-black outline-none focus:border-[var(--cg-brown)]" />
          </label>
        )}
        <div className="space-y-2">
          <p className="text-[12px] font-black text-[var(--cg-text-56)]">快捷金额 ({cName})</p>
          <div className="grid grid-cols-5 gap-2">
            {quickAmounts.map((value) => <button key={value} type="button" onClick={() => quickAmount(value)} className="rounded-[13px] border border-[var(--cg-border)] bg-white py-2 text-[12px] font-black text-[var(--cg-text-56)]">{value}</button>)}
          </div>
        </div>
        {(mode === "parlay" || totals.hasConflict) && (
          <div className={cx("rounded-[16px] border p-3 text-[12px] font-bold leading-5", totals.hasConflict ? "border-[#ffd1d1] bg-[#fff0ef] text-[#7f1d1d]" : "border-[#fde1a6] bg-[#fff7e6] text-[#92400e]")}>
            {totals.hasConflict ? totals.conflictText : "串关需要所有选择全部命中，任意一项未命中，整张串关单失败。"}
          </div>
        )}
        <div className="rounded-[20px] bg-[var(--cg-brown)] p-4 text-[#cbd5e1]">
          {walletConnected ? (
            <SummaryLine
              label="可用余额"
              value={`${balanceFmt(balanceInStakeCur)} ${cName}`}
              hint={
                stakeCurrency === "RMB" && walletBalanceUsdt != null
                  ? `≈ ${balanceFmt(walletBalanceUsdt)} ${curName('USDT')}`
                  : stakeCurrency === "USDT" && walletBalanceNative != null
                    ? `≈ ${balanceFmt(walletBalanceNative)} RMB`
                    : undefined
              }
              accent
            />
          ) : (
            <SummaryLine label="可用余额" value="未登陆" />
          )}
          {mode === "parlay" && <SummaryLine label="组合赔率" value={totals.combinedOdds.toFixed(2)} />}
          <SummaryLine label="总投入" value={`${balanceFmt(totals.totalStake)} ${cName}`} />
          <SummaryLine label="最高预计返还" value={`${balanceFmt(totals.maxReturn)} ${cName}`} accent />
          <SummaryLine label="预计盈利" value={`${balanceFmt(Math.max(totals.profit, 0))} ${cName}`} accent />
          <SummaryLine label="网络费用" value="0" />
          {stakeCurrency !== "USDT" && totals.totalStake > 0 && (
            <SummaryLine label={`等值 ${curName('USDT')}`} value={balanceFmt(totals.totalStake / fxr)} hint={`返还 ≈ ${balanceFmt(totals.maxReturn / fxr)} ${curName('USDT')}`} />
          )}
          <SummaryLine label="报价有效期" value={`00:${String(quoteSeconds).padStart(2, "0")}`} />
        </div>
        {insufficientBalance && (
          <div className="rounded-[16px] border border-[#fecaca] bg-[#fef2f2] p-3 text-[12px] font-bold leading-5 text-[#7f1d1d]">
            余额不足：可用 {balanceFmt(balanceInStakeCur)} {cName}，本单需要 {balanceFmt(totals.totalStake)} {cName}。
          </div>
        )}
        <Button full onClick={openConfirm} disabled={selections.length === 0 || totals.hasConflict || insufficientBalance}>确认下单</Button>
        <p className="text-center text-[10px] leading-4 text-[var(--cg-text-56)]">已勾选：接受赔率小幅变化；若赔率变化过大，系统会要求重新确认。</p>
      </div>
    </>
  );
}

function SummaryLine({ label, value, accent = false, hint }: { label: string; value: string; accent?: boolean; hint?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[13px]">
      <span>{label}</span>
      <div className="flex flex-col items-end">
        <strong className={cx("font-mono", accent ? "text-[#0ead69]" : "text-white")}>{value}</strong>
        {hint && <span className="font-mono text-[10px] text-white/50">{hint}</span>}
      </div>
    </div>
  );
}

function ConfirmScreen({
  selections,
  mode,
  totals,
  quoteSeconds,
  walletConnected,
  walletAddress,
  walletBalance,
  riskAccepted,
  setRiskAccepted,
  submitOrder,
  openWallet,
  go,
  stakeCurrency,
  walletFxRate,
}: {
  selections: SlipSelection[];
  mode: SlipMode;
  totals: { totalStake: number; maxReturn: number; profit: number };
  quoteSeconds: number;
  walletConnected: boolean;
  walletAddress: string;
  walletBalance: string;
  riskAccepted: boolean;
  setRiskAccepted: (value: boolean) => void;
  submitOrder: () => void;
  openWallet: () => void;
  go: (screen: Screen) => void;
  stakeCurrency: "USDT" | "RMB";
  walletFxRate: number;
}) {
  const cN = curName(stakeCurrency);
  const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fxr = walletFxRate > 0 ? walletFxRate : 1;
  return (
    <>
      {/* Two-step back chain on purpose: confirm → betslip (review/edit
          selections) → previous markets page (via goBack popping the
          screenStack).  This lets the user adjust the slip without
          losing context. */}
      <AppHeader title={`${cN} 下单确认`} back={() => go("betslip")} walletAddress={walletAddress} walletBalance={walletBalance} />
      <div className="space-y-3 p-4">
        <Card>
          <h2 className="text-[18px] font-black">账户确认</h2>
          <div className="mt-3 flex flex-wrap gap-2"><Chip tone={walletConnected ? "green" : "orange"}>{walletConnected ? `已登陆 玩家 · ${walletAddress || "账户"}` : "未登陆账户"}</Chip><Chip tone="blue">{walletBalance || "信用 —"}</Chip></div>
        </Card>
        <Card>
          <h3 className="text-[16px] font-black">订单明细</h3>
          <DetailRow label="订单类型" value={mode === "single" ? `单关 ${Math.max(selections.length, 1)} 项` : `${selections.length} 串 1`} />
          <DetailRow label="投入" value={`${fmt(totals.totalStake)} ${cN}`} />
          <DetailRow label="预计返还" value={`${fmt(totals.maxReturn)} ${cN}`} accent />
          <DetailRow label="预计盈利" value={`${fmt(Math.max(totals.profit, 0))} ${cN}`} accent />
          <DetailRow label="网络费用" value="0" />
          {stakeCurrency !== "USDT" && totals.totalStake > 0 && (
            <DetailRow label={`等值 ${curName('USDT')}`} value={`${fmt(totals.totalStake / fxr)} ${curName('USDT')}`} />
          )}
          <DetailRow label="报价有效期" value={`00:${String(quoteSeconds).padStart(2, "0")}`} />
        </Card>
        <label className="flex gap-3 rounded-[18px] border border-[#ffd1d1] bg-[#fff0ef] p-4 text-[12px] font-bold leading-5 text-[#7f1d1d]">
          <input type="checkbox" checked={riskAccepted} onChange={(event) => setRiskAccepted(event.target.checked)} className="mt-1 size-4 accent-[var(--cg-gold)]" />
          <span>我已了解预测存在亏损风险，赔率/价格可能变化，足球场次锁单后无法卖出或撤单。</span>
        </label>
        {!walletConnected && <Button full variant="soft" onClick={openWallet}>登陆账户并下单</Button>}
        <Button full onClick={submitOrder} disabled={!walletConnected || !riskAccepted}>确认下单（扣信用额度）</Button>
        <p className="text-center text-[10px] text-[var(--cg-text-56)]">账户下单后仅冻结信用额度；结算后由代理及平台转账。</p>
      </div>
    </>
  );
}

function DetailRow({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--cg-border)] py-2 text-[13px] last:border-b-0">
      <span className="text-[var(--cg-text-56)]">{label}</span>
      <b className={cx("font-mono", accent ? "text-[#0ead69]" : "text-[#111827]")}>{value}</b>
    </div>
  );
}

function PositionsScreen({
  positions,
  setSellTarget,
  walletAddress,
  walletBalance,
}: {
  positions: PositionItem[];
  setSellTarget: (position: PositionItem) => void;
  walletAddress: string;
  walletBalance: string;
}) {
  return (
    <>
      <AppHeader title="持仓交易 · 结果前卖出" walletAddress={walletAddress} walletBalance={walletBalance} />
      <div className="space-y-3 p-4">
        <Card>
          <h2 className="text-[18px] font-black">我的持仓</h2>
          <p className="mt-1 text-[12px] leading-5 text-[var(--cg-text-56)]">结果未出前可退出；足球锁单后停止撮合和卖出。</p>
        </Card>
        {positions.length === 0 && (
          <Card className="text-center">
            <h3 className="text-[16px] font-black">持仓暂未接入后端</h3>
            <p className="mx-auto mt-2 max-w-[260px] text-[12px] leading-5 text-[var(--cg-text-56)]">
              PmPm 持仓二级卖出在 Crown DB 中没有对应字段；需要预测市场后端。
            </p>
          </Card>
        )}
        {positions.map((position) => (
          <Card key={position.id}>
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-[16px] font-black">{position.title}</h3><p className="mt-1 text-[12px] text-[var(--cg-text-56)]">持仓：{position.outcome}</p></div>
              <Chip tone={position.canSell ? "green" : "orange"}>{position.canSell ? "可卖出" : "不可卖"}</Chip>
            </div>
            <div className="mt-3 h-[64px] rounded-[14px] border border-[var(--cg-border)] bg-[linear-gradient(90deg,#e8f7ef,#ffffff)]" />
            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
              <Metric label="份额" value={position.shares.toFixed(1)} />
              <Metric label="当前卖出价" value={position.currentPrice.toFixed(2)} />
              <Metric label="浮盈" value={`+${position.pnl.toFixed(1)}`} accent />
            </div>
            {position.lockedReason && <p className="mt-3 rounded-[12px] bg-[#fff7e6] p-2 text-[11px] font-bold text-[#92400e]">{position.lockedReason}</p>}
            <div className="mt-3"><Button full disabled={!position.canSell} onClick={() => setSellTarget(position)}>{position.canSell ? "卖出" : "已锁定"}</Button></div>
          </Card>
        ))}
      </div>
    </>
  );
}

function Metric({ label, value, accent = false, compact = false }: { label: string; value: string; accent?: boolean; compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex min-w-0 items-center justify-between gap-2 rounded-[14px] bg-[#f8fafc] px-3 py-2.5">
        <span className="min-w-0 truncate whitespace-nowrap text-[12px] font-bold text-[var(--cg-text-56)]">{label}</span>
        <b className={cx("shrink-0 font-mono text-[16px] font-black", accent ? "text-[#0ead69]" : "text-[#111827]")}>{value}</b>
      </div>
    );
  }

  return <div className="rounded-[14px] bg-[#f8fafc] p-2"><span className="block text-[var(--cg-text-56)]">{label}</span><b className={cx("font-mono text-[15px]", accent ? "text-[#0ead69]" : "text-[#111827]")}>{value}</b></div>;
}

function SellDrawer({ target, percent, setPercent, close, confirm }: { target: PositionItem; percent: number; setPercent: (value: number) => void; close: () => void; confirm: () => void }) {
  const receive = target.shares * (percent / 100) * target.currentPrice;
  return (
    <div className="absolute inset-x-0 bottom-0 z-[20] rounded-t-[28px] border border-[var(--cg-border)] bg-white p-4 shadow-[0_-20px_60px_rgba(15,23,42,.25)]">
      <div className="mx-auto mb-3 h-1 w-14 rounded-full bg-[#cbd5e1]" />
      <div className="flex items-start justify-between">
        <div><h2 className="text-[20px] font-black">卖出持仓</h2><p className="mt-1 text-[12px] text-[var(--cg-text-56)]">{target.outcome}</p></div>
        <button type="button" onClick={close} className="grid size-8 place-items-center rounded-full bg-[#f1f5f9] font-black text-[var(--cg-text-56)]">x</button>
      </div>
      <div className="mt-4">
        <input type="range" min="1" max="100" value={percent} onChange={(event) => setPercent(Number(event.target.value))} className="w-full accent-[var(--cg-gold)]" />
        <p className="mt-2 text-[13px] font-black">{percent}% · 到账约 {money(receive - 0.03)}</p>
      </div>
      <div className="mt-3 rounded-[14px] bg-[#fff7e6] p-3 text-[12px] font-bold text-[#92400e]">卖出后你将退出该部分预测结果，后续即使该结果命中，也不再获得对应返还。</div>
      <div className="mt-4 grid grid-cols-2 gap-2"><Button onClick={confirm}>市价卖出</Button><Button variant="soft" onClick={confirm}>挂单卖出</Button></div>
    </div>
  );
}

function LockedScreen({
  go,
  match,
  markets,
  walletAddress,
  walletBalance,
}: {
  go: (screen: Screen) => void;
  match: FootballMatch | null;
  markets: BeginnerMarketGroup[];
  walletAddress: string;
  walletBalance: string;
}) {
  return (
    <>
      <AppHeader title="足球场次 · 已锁单" walletAddress={walletAddress} walletBalance={walletBalance} />
      <div className="space-y-3 p-4">
        <Card className="bg-[var(--cg-brown)] text-white">
          <div className="flex items-center justify-between">
            <h2 className="text-[20px] font-black">{match ? matchTitle(match) : "未选择赛事"}</h2>
            <Chip tone="orange">已锁单</Chip>
          </div>
          <p className="mt-3 text-[12px] leading-5 text-[#d1d5db]">开赛前 5 分钟停止下单、卖出、挂单和撮合。</p>
        </Card>
        {markets.slice(0, 3).map((group) => {
          // 已锁单视图仅供回顾，不需要可交互的"展开剩余"按钮，
          // 直接截取前 COLLAPSE_THRESHOLD 项即可，超出的标注一下数量。
          const visible = group.options.slice(0, COLLAPSE_THRESHOLD);
          const hidden = group.options.length - visible.length;
          return (
            <Card key={group.title} className="opacity-60">
              <h3 className="text-[15px] font-black">{group.title}</h3>
              <div className={cx("mt-3 grid gap-2", group.options.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
                {visible.map((option) => <OutcomeButton key={option.id} option={option} active={false} onPick={() => {}} disabled />)}
              </div>
              {hidden > 0 && (
                <p className="mt-2 text-center text-[11px] font-bold text-[#94a3b8]">已锁单 · 隐藏 {hidden} 项</p>
              )}
            </Card>
          );
        })}
        {markets.length === 0 && (
          <Card><p className="text-center text-[12px] font-bold text-[var(--cg-text-56)]">该赛事暂无可展示的已锁盘口。</p></Card>
        )}
        <Card>
          <h3 className="text-[16px] font-black">我的订单</h3>
          <Chip tone="orange">等待结算</Chip>
          <p className="mt-2 text-[12px] text-[var(--cg-text-56)]">从 /api/bets 读取订单 · 详情跳转“订单”页</p>
          <Button full onClick={() => go("orders")}>查看订单详情</Button>
        </Card>
      </div>
    </>
  );
}

function CreateScreen({ publish }: { publish: (draft: CreatedPrediction) => void }) {
  // CreateScreen is a creation form for friend circles (no on-chain action
  // until publish), so AppHeader uses its default empty wallet state.
  const [question, setQuestion] = useState(defaultCreatedPrediction.question);
  const [resultType, setResultType] = useState(defaultCreatedPrediction.resultType);
  const [scope, setScope] = useState(defaultCreatedPrediction.scope);
  const [stakeCap, setStakeCap] = useState(defaultCreatedPrediction.stakeCap);
  const [deadline, setDeadline] = useState(defaultCreatedPrediction.deadline);
  const [adjudicator, setAdjudicator] = useState(defaultCreatedPrediction.adjudicator);
  const [evidence, setEvidence] = useState(defaultCreatedPrediction.evidence);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const resultOptions = ["是 / 否", "多选一", "朋友投票"];
  const scopeOptions = ["仅邀请朋友可见", "公开市场 · 提交审核"];
  const validationItems = [
    { label: "问题至少 6 个字", ok: question.trim().length >= 6 },
    { label: "截止时间已填写", ok: deadline.trim().length > 0 },
    { label: "裁定人已配置", ok: adjudicator.trim().length > 0 },
    { label: "证据要求已填写", ok: evidence.trim().length > 0 },
    { label: "已确认争议规则", ok: rulesAccepted },
  ];
  const canPublish = validationItems.every((item) => item.ok);
  const submit = () => {
    if (!canPublish) return;
    publish({ question: question.trim(), resultType, scope, stakeCap, deadline: deadline.trim(), adjudicator: adjudicator.trim(), evidence: evidence.trim() });
  };

  return (
    <>
      <AppHeader title="创建预测" />
      <div className="space-y-3 p-4">
        <Card><h2 className="text-[18px] font-black">朋友局自由创建，公开市场需审核</h2><p className="mt-2 text-[12px] leading-5 text-[var(--cg-text-56)]">USDT 朋友局必须配置裁定、证据与争议投票。</p></Card>
        <div className="grid grid-cols-4 gap-2 text-center text-[11px] font-bold text-[var(--cg-text-56)]">
          {["问题", "结果", "范围", "规则"].map((item, index) => (
            <div key={item}>
              <b className={cx("mx-auto mb-1 grid size-7 place-items-center rounded-full text-white", index < 3 || rulesAccepted ? "bg-[var(--cg-gold)]" : "bg-[#cbd5e1]")}>{index + 1}</b>
              {item}
            </div>
          ))}
        </div>
        <Card>
          <label className="block">
            <span className="text-[16px] font-black">预测问题</span>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={3}
              className="mt-3 w-full resize-none rounded-[14px] border border-[var(--cg-border)] bg-[#f8fafc] p-3 text-[13px] font-semibold leading-5 text-[#111827] outline-none transition focus:border-[var(--cg-brown)]"
            />
            <span className="mt-2 block text-[11px] text-[var(--cg-text-56)]">至少 6 个字，问题会出现在朋友局邀请页。</span>
          </label>
        </Card>
        <Card>
          <h3 className="text-[16px] font-black">结果类型</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {resultOptions.map((item) => (
              <Button key={item} onClick={() => setResultType(item)} variant={resultType === item ? "primary" : "soft"}>{item}</Button>
            ))}
          </div>
        </Card>
        <Card>
          <h3 className="text-[16px] font-black">参与范围与资金</h3>
          <div className="mt-3 space-y-2">
            {scopeOptions.map((item) => (
              <Button key={item} full onClick={() => setScope(item)} variant={scope === item ? "primary" : "soft"}>{item}</Button>
            ))}
          </div>
          <label className="mt-3 block">
            <span className="text-[12px] font-bold text-[var(--cg-text-56)]">单人上限 USDT</span>
            <input
              value={stakeCap}
              onChange={(event) => setStakeCap(event.target.value.replace(/[^\d.]/g, ""))}
              className="mt-1 h-11 w-full rounded-[14px] border border-[var(--cg-border)] bg-white px-3 font-mono text-[14px] font-black outline-none focus:border-[var(--cg-brown)]"
            />
          </label>
        </Card>
        <Card>
          <h3 className="text-[16px] font-black">结算规则</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[12px] font-bold text-[var(--cg-text-56)]">截止时间</span>
              <input value={deadline} onChange={(event) => setDeadline(event.target.value)} className="mt-1 h-11 w-full rounded-[14px] border border-[var(--cg-border)] bg-white px-3 text-[13px] font-bold outline-none focus:border-[var(--cg-brown)]" />
            </label>
            <label className="block">
              <span className="text-[12px] font-bold text-[var(--cg-text-56)]">裁定人</span>
              <input value={adjudicator} onChange={(event) => setAdjudicator(event.target.value)} className="mt-1 h-11 w-full rounded-[14px] border border-[var(--cg-border)] bg-white px-3 text-[13px] font-bold outline-none focus:border-[var(--cg-brown)]" />
            </label>
          </div>
          <label className="mt-3 block">
            <span className="text-[12px] font-bold text-[var(--cg-text-56)]">证据要求</span>
            <input value={evidence} onChange={(event) => setEvidence(event.target.value)} className="mt-1 h-11 w-full rounded-[14px] border border-[var(--cg-border)] bg-white px-3 text-[13px] font-bold outline-none focus:border-[var(--cg-brown)]" />
          </label>
        </Card>
        <label className="flex gap-3 rounded-[16px] border border-[#fde1a6] bg-[#fff7e6] p-3 text-[12px] font-bold leading-5 text-[#92400e]">
          <input type="checkbox" checked={rulesAccepted} onChange={(event) => setRulesAccepted(event.target.checked)} className="mt-1 size-4 accent-[var(--cg-gold)]" />
          <span>结算规则必填：截止时间、结果来源、裁定人、证据、争议窗口。我确认规则会随邀请一起展示。</span>
        </label>
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-black">发布检查</h3>
            <Chip tone={canPublish ? "green" : "orange"}>{validationItems.filter((item) => item.ok).length}/{validationItems.length}</Chip>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2">
            {validationItems.map((item) => (
              <div key={item.label} className={cx("flex items-center justify-between rounded-[12px] px-3 py-2 text-[12px] font-bold", item.ok ? "bg-[#e8f7ef] text-[#0f7a4b]" : "bg-[#fff7e6] text-[#92400e]")}>
                <span>{item.label}</span>
                <span>{item.ok ? "完成" : "待补"}</span>
              </div>
            ))}
          </div>
        </Card>
        <Button full onClick={submit} disabled={!canPublish}>下一步：发布并邀请</Button>
      </div>
    </>
  );
}

function InviteScreen({ go, created }: { go: (screen: Screen) => void; created: CreatedPrediction }) {
  const [copied, setCopied] = useState(false);
  const inviteLink = `https://pmpm.local/circle/${encodeURIComponent(created.question).slice(0, 36)}`;
  const copyInviteLink = async () => {
    try {
      await navigator.clipboard?.writeText(inviteLink);
    } catch {
      // Local preview can block clipboard writes; still show the generated link.
    }
    setCopied(true);
  };

  return (
    <>
      <AppHeader title="发布成功 · 邀请朋友" />
      <div className="space-y-3 p-4">
        <Card><div className="flex gap-2"><Chip tone="purple">朋友局</Chip><Chip tone="green">USDT</Chip></div><h2 className="mt-3 text-[20px] font-black leading-7">{created.question}</h2><p className="mt-2 text-[12px] leading-5 text-[var(--cg-text-56)]">{created.resultType} · {created.scope} · 单人上限 {created.stakeCap || "0"} USDT。裁定人：{created.adjudicator}，争议窗口 30 分钟。</p></Card>
        <Card><h3 className="text-[16px] font-black">分享邀请</h3><div className="mt-3 flex gap-3"><div className="grid size-24 grid-cols-4 gap-1 rounded-lg border border-[var(--cg-border)] bg-[#f8fafc] p-2">{Array.from({ length: 16 }).map((_, i) => <span key={i} className={cx("rounded-sm", [0, 2, 5, 7, 8, 10, 13, 15].includes(i) ? "bg-[#111827]" : "bg-transparent")} />)}</div><div className="min-w-0 flex-1"><p className="text-[13px] font-black">朋友可以用昵称、邮箱或钱包加入</p><p className="mt-1 text-[12px] leading-5 text-[var(--cg-text-56)]">链接含邀请码，不在公开市场展示。</p><div className="my-2 truncate rounded-[12px] bg-[#f8fafc] px-3 py-2 text-[11px] font-bold text-[var(--cg-text-56)]">{inviteLink}</div><Button onClick={() => { void copyInviteLink(); }}>{copied ? "已复制链接" : "复制链接"}</Button></div></div></Card>
        <Card><h3 className="text-[16px] font-black">朋友局 USDT 安全设置</h3><ul className="mt-2 space-y-1 text-[12px] leading-5 text-[#0ead69]"><li>单人上限 {created.stakeCap || "0"} USDT</li><li>{created.deadline} 自动关闭参与</li><li>证据要求：{created.evidence}</li><li>争议时朋友投票，超过 60% 生效</li></ul></Card>
        <Button full onClick={() => go("circles")}>进入朋友局房间</Button>
      </div>
    </>
  );
}

function CirclesScreen({
  go,
  rooms,
  circleRiskAccepted,
  setCircleRiskAccepted,
  onJoin,
}: {
  go: (screen: Screen) => void;
  rooms: CircleRoom[];
  circleRiskAccepted: boolean;
  setCircleRiskAccepted: (value: boolean) => void;
  onJoin: (room: CircleRoom, outcome: "Yes" | "No") => void;
}) {
  const [selectedRoomId, setSelectedRoomId] = useState(rooms[0]?.id || "");
  const [selectedOutcome, setSelectedOutcome] = useState<"Yes" | "No">("Yes");
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) || rooms[0];

  return (
    <>
      <AppHeader title="朋友局" />
      <div className="space-y-3 p-4">
        <Card><div className="flex items-center justify-between"><div><h2 className="text-[18px] font-black">小范围预测房间</h2><p className="mt-1 text-[12px] text-[var(--cg-text-56)]">身边朋友参与，可使用 USDT。</p></div><Button onClick={() => go("create")}>创建局</Button></div></Card>
        <div className="grid grid-cols-3 gap-2"><Button>我创建的</Button><Button variant="soft">我参与的</Button><Button variant="soft">邀请我的</Button></div>
        {rooms.map((room) => (
          <Card key={room.id} className={cx(selectedRoomId === room.id ? "border-[var(--cg-gold)] bg-[var(--cg-gold)]/5" : "")}>
            <button type="button" onClick={() => setSelectedRoomId(room.id)} className="block w-full text-left">
              <div className="flex flex-wrap gap-2"><Chip tone="green">USDT</Chip><Chip tone={room.joined ? "green" : "orange"}>{room.joined ? "已参与" : room.status}</Chip></div>
              <h3 className="mt-3 text-[17px] font-black leading-6">{room.question}</h3>
              <p className="mt-2 text-[12px] leading-5 text-[var(--cg-text-56)]">朋友局 · {room.participants} 人 · {room.pool}。裁定人：{room.adjudicator}；证据：{room.evidence}。</p>
            </button>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setSelectedRoomId(room.id); setSelectedOutcome("Yes"); }}
                className={cx("rounded-[15px] px-4 py-2.5 text-[13px] font-black transition active:scale-[0.98]", selectedRoomId === room.id && selectedOutcome === "Yes" ? "bg-[#e8f7ef] text-[#0ead69] ring-1 ring-[#bdebd2]" : "bg-[#f8fafc] text-[var(--cg-text-56)]")}
              >
                Yes {room.yes}%
              </button>
              <button
                type="button"
                onClick={() => { setSelectedRoomId(room.id); setSelectedOutcome("No"); }}
                className={cx("rounded-[15px] px-4 py-2.5 text-[13px] font-black transition active:scale-[0.98]", selectedRoomId === room.id && selectedOutcome === "No" ? "bg-[#fff0ef] text-[#f04438] ring-1 ring-[#ffd1d1]" : "bg-[#f8fafc] text-[var(--cg-text-56)]")}
              >
                No {100 - room.yes}%
              </button>
            </div>
          </Card>
        ))}
        <label className="flex gap-3 rounded-[18px] border border-[#fde1a6] bg-[#fff7e6] p-3 text-[12px] font-bold leading-5 text-[#92400e]"><input type="checkbox" checked={circleRiskAccepted} onChange={(event) => setCircleRiskAccepted(event.target.checked)} className="mt-1 size-4 accent-[var(--cg-gold)]" /><span>朋友局结果可能由创建者或朋友投票裁定，请先确认规则和争议处理方式。</span></label>
        {selectedRoom ? (
          <Button full disabled={!selectedRoom.joined && !circleRiskAccepted} onClick={() => (selectedRoom.joined ? go("orders") : onJoin(selectedRoom, selectedOutcome))}>
            {selectedRoom.joined ? "已参与，查看订单" : `信用账户确认参与 ${selectedOutcome}`}
          </Button>
        ) : (
          <Button full disabled>暂无可参与朋友局</Button>
        )}
      </div>
    </>
  );
}

function OrdersScreen({
  orders,
  go,
  walletAddress,
  walletBalance,
}: {
  orders: OrderItem[];
  go: (screen: Screen) => void;
  walletAddress: string;
  walletBalance: string;
}) {
  const openCount = orders.filter((o) => o.tag === "open" || o.tag === "locked").length;
  const settledCount = orders.filter((o) => o.tag === "settled").length;
  const circleCount = orders.filter((o) => o.tag === "circle").length;
  // Track which order row has its details panel expanded. Only one at a
  // time so the page stays compact on mobile.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <>
      <AppHeader title="我的 · 订单与战绩" walletAddress={walletAddress} walletBalance={walletBalance} />
      <div className="space-y-3 p-4">
        <Card>
          <h2 className="text-[18px] font-black">Crown 中近期下注</h2>
          <p className="mt-1 text-[12px] text-[var(--cg-text-56)]">数据来自 /api/bets（gtype=FT）。</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Metric compact label="近期订单" value={String(orders.length)} />
            <Metric compact label="已结算" value={String(settledCount)} accent />
            <Metric compact label="未结算" value={String(openCount)} />
          </div>
        </Card>
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          <Chip tone="blue">全部 {orders.length}</Chip>
          <Chip>未结算 {openCount}</Chip>
          <Chip>已结算 {settledCount}</Chip>
          <Chip tone="purple">朋友局 {circleCount}</Chip>
        </div>
        {orders.length === 0 && (
          <EmptyState title="还没有订单" text="连接后端失败或过滤后为空。请检查 crown-explorer 是否运行。" action="返回发现页" onClick={() => go("discover")} />
        )}
        {orders.map((order) => {
          const isOpen = expandedId === order.id;
          return (
            <Card key={order.id}>
              <div className="flex items-start justify-between gap-3"><div><h3 className="text-[15px] font-black">{order.title}</h3><p className="mt-1 text-[12px] text-[var(--cg-text-56)]">{order.meta}</p></div><Chip tone={order.tag === "open" ? "green" : order.tag === "locked" ? "orange" : order.tag === "settled" ? "blue" : "purple"}>{order.status}</Chip></div>
              <div className="mt-3 flex gap-2">
                <Button variant="soft" onClick={() => setExpandedId(isOpen ? null : order.id)}>
                  {isOpen ? "收起详情" : "详情"}
                </Button>
              </div>
              {isOpen && <OrderDetails order={order} />}
            </Card>
          );
        })}
      </div>
    </>
  );
}

function OrderDetails({ order }: { order: OrderItem }) {
  const bet = order.bet;
  if (!bet) {
    // Non-Crown orders (e.g. 朋友局) don't carry a BetRow. Fall back to the
    // already-formatted summary fields.
    return (
      <div className="mt-3 rounded-[14px] bg-[var(--cg-bg-light)] p-3">
        <DetailRow label="订单号" value={order.id} />
        <DetailRow label="状态" value={order.status} />
        <DetailRow label="摘要" value={order.meta} />
      </div>
    );
  }
  const stakeNum = parseFloat(bet.bet_golds || "0") || 0;
  const memResultNum = parseFloat(bet.mem_result || "0") || 0;
  const validNum = parseFloat(bet.valid_gold || "0") || 0;
  const betTimeText = bet.bet_time
    ? new Date(bet.bet_time * 1000).toLocaleString("zh-CN", { hour12: false })
    : "—";
  const cur = curName(bet.currency || "USDT");
  const resolved = (bet.isResult ?? 0) === 1;
  const cancelled = (bet.cancel ?? 0) === 1;
  return (
    <div className="mt-3 rounded-[14px] bg-[var(--cg-bg-light)] p-3">
      <DetailRow label="订单号" value={`#${bet.ID}`} />
      <DetailRow label="下注时间" value={betTimeText} />
      {bet.league && <DetailRow label="联赛" value={translateLeague(bet.league) || bet.league} />}
      <DetailRow label="主队" value={translateTeam(bet.team_h) || bet.team_h || "—"} />
      <DetailRow label="客队" value={translateTeam(bet.team_c) || bet.team_c || "—"} />
      <DetailRow label="盘口类型" value={translateWtype(bet) || "—"} />
      <DetailRow label="玩法" value={bet.ptype_label || bet.ptype || "—"} />
      {/* 选择 row — chose_team gives a quick H/C/D hint, betstr the full
          human-readable outcome label (Crown writes this at place-bet time).
          Both are filled by api_v2.php → /api/bets and let the user verify
          which side they actually picked. */}
      {(bet.betstr || bet.chose_team) && (
        <DetailRow
          label="选择"
          value={(() => {
            const outcome = describeBetOutcome(bet);
            if (!bet.betstr || outcome === bet.betstr) return outcome || "—";
            return `${outcome}（${bet.betstr}）`;
          })()}
          accent
        />
      )}
      {bet.spread && <DetailRow label="让分 / 大小" value={bet.spread} />}
      <DetailRow label="赔率" value={bet.ioratio ?? "—"} />
      <DetailRow label="下注金额" value={`${stakeNum.toFixed(2)} ${cur}`} />
      {validNum > 0 && <DetailRow label="有效金额" value={`${validNum.toFixed(2)} ${cur}`} />}
      <DetailRow label="实际比分" value={bet.score || "—"} />
      {bet.org_score && bet.org_score !== bet.score && (
        <DetailRow label="盘口快照比分" value={bet.org_score} />
      )}
      <DetailRow label="状态" value={cancelled ? "已取消" : resolved ? "已结算" : "未结算"} />
      {resolved && bet.result && <DetailRow label="结算结果" value={bet.result} accent />}
      {resolved && (
        <DetailRow
          label="盈亏"
          value={`${memResultNum >= 0 ? "+" : ""}${memResultNum.toFixed(2)} ${cur}`}
          accent={memResultNum >= 0}
        />
      )}
      {bet.ticket_id && <DetailRow label="票据编号" value={bet.ticket_id} />}
    </div>
  );
}

function SettleScreen({
  walletAddress,
  walletBalance,
}: {
  walletAddress: string;
  walletBalance: string;
}) {
  return (
    <>
      <AppHeader title="结算 / 争议处理" walletAddress={walletAddress} walletBalance={walletBalance} />
      <div className="space-y-3 p-4">
        <Card>
          <h2 className="text-[18px] font-black">Crown 结算字段说明</h2>
          <p className="mt-1 text-[12px] leading-5 text-[var(--cg-text-56)]">这些是 Crown bet 表记录的核心结果字段；具体订单请在“我的订单”查看。</p>
        </Card>
        <Card>
          <h3 className="text-[16px] font-black">结算字段</h3>
          <DetailRow label="score" value="实际比分：/api/bets 中的 score" />
          <DetailRow label="org_score" value="源始比分：inplay 快照时的数值" />
          <DetailRow label="isResult" value="是否已结算（0/1）" />
          <DetailRow label="result" value="单个订单结算类别：W/L/T" />
          <DetailRow label="mem_result" value="会员仓位结算金额（负数为亏损）" />
        </Card>
        <Card>
          <h3 className="text-[16px] font-black">争议处理</h3>
          <p className="mt-2 text-[12px] leading-5 text-[var(--cg-text-56)]">Crown 仅供取证查看，不提供争议仲裁。朋友局 / 预测市场争议需要专用后端。</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="soft" disabled>发起争议</Button>
            <Button variant="soft" disabled>确认结算</Button>
          </div>
        </Card>
      </div>
    </>
  );
}

function ProfileScreen({
  walletConnected,
  setWalletConnected,
  go,
  walletAddress,
  walletBalance,
  setWalletAddress,
  setWalletBalance,
  openSettings,
}: {
  walletConnected: boolean;
  setWalletConnected: (value: boolean) => void;
  go: (screen: Screen) => void;
  walletAddress: string;
  walletBalance: string;
  setWalletAddress: (value: string) => void;
  setWalletBalance: (value: string) => void;
  openSettings: () => void;
}) {
  const isAgent = walletAddress.includes('代理');
  const toggleWallet = async () => {
    if (walletConnected) {
      try { await pmppmApi.logout(); } catch { /* ignore */ }
      setWalletConnected(false);
      setWalletAddress("");
      setWalletBalance("");
      return;
    }
    window.dispatchEvent(new Event("pmpm-open-login"));
  };
  return (
    <>
      <AppHeader title="我的 · 信用账户" walletAddress={walletAddress} walletBalance={walletBalance} />
      <div className="space-y-3 p-4">
        <Card><div className="flex items-center gap-3"><div className="grid size-14 place-items-center rounded-full border border-[var(--cg-gold)] bg-[var(--cg-gold)]/15 text-[20px] font-black text-[var(--cg-gold-deep)]">P</div><div><h2 className="text-[18px] font-black">Crown Gold 用户</h2><p className="text-[12px] text-[var(--cg-text-56)]">{walletConnected ? walletAddress : "未登陆账户"}</p></div></div></Card>
        <div className="grid grid-cols-3 gap-2"><Metric label="信用额度" value={walletConnected ? walletBalance.replace(/^信用\s*/, "") : "—"} accent={walletConnected} /><Metric label="WCP 积分" value="—" /><Metric label="佣金账户" value="—" /></div>
        <Card>
          <div className="space-y-0.5">
            <SettingsNavItem icon="📋" label="帐户历史 · 我的订单" onClick={() => go("orders")} />
            <SettingsNavItem icon="⚙️" label="显示设定" onClick={openSettings} />
          </div>
        </Card>
        {isAgent && (
          <Card>
            <h3 className="text-[16px] font-black">代理 / 授权</h3>
            <p className="mt-1 text-[12px] leading-5 text-[var(--cg-text-56)]">账户由代理生成、密码由代理设置、信用额度由代理授权；联系代理可调整额度或重置密码。</p>
            <DetailRow label="角色" value="—" />
            <DetailRow label="邀请码" value="—" />
            <DetailRow label="下级用户" value="—" />
          </Card>
        )}
        <Button full variant={walletConnected ? "red" : "primary"} onClick={toggleWallet}>{walletConnected ? "退出登陆" : "登陆账户"}</Button>
      </div>
    </>
  );
}

function SettingsNavItem({ icon, label, detail, accent, onClick }: { icon: string; label: string; detail?: string; accent?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition hover:bg-[#f8fafc] active:bg-[#f1f5f9]"
    >
      <span className="text-[16px]">{icon}</span>
      <span className="flex-1 text-[13px] font-bold text-[var(--cg-text)]">{label}</span>
      {detail && <span className={cx("text-[12px] font-bold", accent ? "text-[var(--cg-gold)]" : "text-[var(--cg-text-56)]")}>{detail}</span>}
      <span className="text-[14px] text-[var(--cg-text-56)]">›</span>
    </button>
  );
}

function SettingsDrawerItem({ icon, label, detail, accent, onClick }: { icon: string; label: string; detail?: string; accent?: boolean; onClick?: () => void }) {
  // When `onClick` is omitted the item is treated as locked / display-only:
  // no hover affordance, no › chevron, disabled <button> so the user can
  // still focus and screen-read it but can't interact.  Used for 语言 and
  // 盘口类型 which the H5 build only supports in one canonical value.
  const locked = !onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={locked}
      className={cx(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition",
        locked ? "cursor-default" : "hover:bg-[#f8fafc] active:bg-[#f1f5f9]"
      )}
    >
      <span className="text-[16px]">{icon}</span>
      <span className="flex-1 text-[13px] font-bold text-[#1f2937]">{label}</span>
      {detail && <span className={cx("text-[11px] font-bold", accent ? "text-[var(--cg-gold)]" : "text-[var(--cg-text-56)]")}>{detail}</span>}
      {!locked && <span className="text-[14px] text-[var(--cg-text-56)]">›</span>}
    </button>
  );
}

function SettingsDrawerToggle({ icon, label, detail, checked, onChange }: { icon: string; label: string; detail?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-[#f8fafc] cursor-pointer">
      <span className="text-[16px]">{icon}</span>
      <span className="flex-1 text-[13px] font-bold text-[#1f2937]">
        {label}
        {detail && <span className="ml-2 text-[11px] font-bold text-[var(--cg-text-56)]">{detail}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
      <span className="relative h-5 w-9 rounded-full bg-gray-300 transition peer-checked:bg-[var(--cg-gold)]">
        <span className={cx("absolute left-0.5 top-0.5 size-4 rounded-full bg-white transition", checked && "translate-x-4")} />
      </span>
    </label>
  );
}

// "管理" hub — surfaces the订单 / 持仓 / 朋友局 sub-flows that are no longer
// in the top-level sidebar, plus a placeholder for operator-side market &
// commission management (matches pmpm.uk's 盘口 / 佣金 label).
function ManageScreen({
  walletAddress,
  walletBalance,
  go,
}: {
  walletAddress: string;
  walletBalance: string;
  go: (screen: Screen) => void;
}) {
  // The bottom navbar drops the dedicated 代理 button (mobile real-estate
  // is precious), so for accounts flagged as 代理 we surface a shortcut to
  // the agent center here. We sniff the role from `walletAddress`, which
  // `applyAccountState` formats as "L1 代理 · username" or "玩家 · username".
  const isAgent = walletAddress.includes('代理');
  return (
    <>
      <AppHeader title="管理 · 盘口 / 佣金" walletAddress={walletAddress} walletBalance={walletBalance} />
      <div className="space-y-3 p-4">
        <Card>
          <h3 className="text-[16px] font-black">我的活动</h3>
          <p className="mt-1 text-[12px] leading-5 text-[var(--cg-text-56)]">
            订单、持仓、朋友局都从这里进入；数据来自 crown-explorer 与 odds-api.io。
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button full variant="soft" onClick={() => go("orders")}>我的订单</Button>
            <Button full variant="soft" onClick={() => go("positions")}>持仓 / 卖出</Button>
            <Button full variant="soft" onClick={() => go("circles")}>朋友局</Button>
            <Button full variant="soft" onClick={() => go("settle")}>结算 / 争议</Button>
          </div>
        </Card>
        {isAgent && (
          <Card>
            <h3 className="text-[16px] font-black">代理中心</h3>
            <p className="mt-1 text-[12px] leading-5 text-[var(--cg-text-56)]">
              生成下级账户、授权信用额度、查看下级流水。
            </p>
            <div className="mt-3"><Button full onClick={() => go("agent")}>进入代理中心</Button></div>
          </Card>
        )}
        <Card>
          <h3 className="text-[16px] font-black">盘口 / 佣金</h3>
          <p className="mt-1 text-[12px] leading-5 text-[var(--cg-text-56)]">
            盘口流水、佣金分润、风控规则等运营功能正在接入。
          </p>
          <div className="mt-3"><Chip tone="orange">敬请期待</Chip></div>
        </Card>
      </div>
    </>
  );
}

// "代理" hub — placeholder for downline / commission management; the
// crown-explorer /api/agents endpoint can hydrate this later.
// Agent ops screen — real fetches against the pmppm-com-go backend.
//
//   GET  /api/agent/list-users        my downline (auth: withAgent)
//   GET  /api/agent/credit/list       credit accounts I issued
//   POST /api/agent/create-user       generate username + password
//   POST /api/agent/credit/topup      add credit to a downline user
//
// Surfaces "freshly created" credentials inline so the agent can hand
// them to the user (the backend returns the *plaintext* password
// exactly once — never again — so we keep the entries in component
// state until the agent navigates away).
function AgentScreen({
  walletAddress,
  walletBalance,
}: {
  walletAddress: string;
  walletBalance: string;
}) {
  const [downline, setDownline] = useState<PmppmUser[]>([]);
  const [creditList, setCreditList] = useState<Array<PmppmUser & { credit_balance: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingCreds, setPendingCreds] = useState<Array<{ user_id: number; username: string; password: string; credit_balance: number }>>([]);
  // Initial credit authorisation (USDT) for newly-generated accounts.
  // 1000 is a sensible default for a v0 sportsbook test.
  const [initialCredit, setInitialCredit] = useState("1000");
  // Per-row top-up amount (USDT). Agent enters number, clicks 加额度.
  const [topupAmount, setTopupAmount] = useState<Record<number, string>>({});
  const [toast, setToast] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, c] = await Promise.all([
        pmppmApi.agentListUsers(),
        pmppmApi.agentCreditList(),
      ]);
      setDownline(u.users);
      setCreditList(c.users);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status} ${err.body || err.message}`
          : err instanceof Error
            ? err.message
            : "未知错误",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const createUser = async () => {
    const initial = Number(initialCredit);
    if (!Number.isFinite(initial) || initial < 0) {
      setToast("初始信用必须 ≥ 0");
      return;
    }
    setBusy(true);
    setToast("");
    try {
      const resp = await pmppmApi.agentCreateUser(1, initial);
      setPendingCreds((prev) => [...resp.users, ...prev]);
      setToast(
        `新账户已生成：${resp.users.map((u) => u.username).join(", ")} · 授权 ${initial.toFixed(2)} USDT`,
      );
      await refresh();
    } catch (err) {
      setToast(err instanceof ApiError ? `${err.status} ${err.body || err.message}` : "生成失败");
    } finally {
      setBusy(false);
    }
  };

  const topup = async (userId: number) => {
    const raw = topupAmount[userId] || "";
    const amt = Number(raw);
    if (!Number.isFinite(amt) || amt === 0) {
      setToast("请输入非零金额（正数加额度，负数扣减）");
      return;
    }
    setBusy(true);
    try {
      const resp = await pmppmApi.agentCreditTopup(userId, amt);
      setToast(
        `已为 #${userId} 调整 ${amt.toFixed(2)} USDT${
          typeof resp.balance === "number" ? ` · 新余额 ${resp.balance.toFixed(2)}` : ""
        }`,
      );
      setTopupAmount((s) => ({ ...s, [userId]: "" }));
      await refresh();
    } catch (err) {
      setToast(err instanceof ApiError ? `${err.status} ${err.body || err.message}` : "调额失败");
    } finally {
      setBusy(false);
    }
  };

  // Merge downline + credit list into one display map keyed by user id so
  // we can show credit_balance alongside username. The backend's
  // /api/agent/credit/list is the authoritative source for credit_balance
  // (downline only carries it via scanUser via userCols). We prefer
  // credit_balance from creditList when present.
  const merged = useMemo(() => {
    const byId = new Map<number, PmppmUser & { credit_balance: number }>();
    for (const u of downline) byId.set(u.id, { ...u, credit_balance: u.credit_balance ?? 0 });
    for (const c of creditList) byId.set(c.id, { ...byId.get(c.id), ...c });
    return Array.from(byId.values()).sort((a, b) => b.id - a.id);
  }, [downline, creditList]);

  return (
    <>
      <AppHeader title="代理 · 下级 / 佣金" walletAddress={walletAddress} walletBalance={walletBalance} />
      <div className="space-y-3 p-4">
        <Card>
          <h3 className="text-[16px] font-black">代理中心</h3>
          <p className="mt-1 text-[12px] leading-5 text-[var(--cg-text-56)]">
            为下级生成账户与初始密码、授权信用额度；下级下注会按授权额度扣减。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip tone="blue">L1 代理</Chip>
            <Chip tone="green">下级 {merged.length}</Chip>
            <Chip tone="orange">{walletBalance || "信用 — USDT"}</Chip>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[11px] font-bold text-[var(--cg-text-56)]">初始信用</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="100"
              value={initialCredit}
              onChange={(e) => setInitialCredit(e.target.value)}
              className="w-24 rounded-[10px] border border-[var(--cg-border)] bg-white px-2 py-1 text-[12px] font-semibold outline-none focus:border-[var(--cg-brown)]"
            />
            <span className="text-[11px] font-bold text-[var(--cg-text-56)]">USDT</span>
          </div>
          <div className="mt-2 flex gap-2">
            <Button onClick={createUser} disabled={busy}>{busy ? "生成中…" : "生成新账户"}</Button>
            <Button variant="soft" onClick={refresh} disabled={busy || loading}>{loading ? "加载中…" : "刷新"}</Button>
          </div>
        </Card>

        {error && (
          <Card className="bg-[#fff0ef]">
            <p className="text-[12px] font-bold text-[#b91c1c]">代理接口错误：{error}</p>
          </Card>
        )}

        {pendingCreds.length > 0 && (
          <Card className="bg-[#fffbe6] border-[#fde1a6]">
            <h3 className="text-[14px] font-black text-[#92400e]">本次生成的账号 / 密码</h3>
            <p className="mt-1 text-[11px] leading-5 text-[#92400e]">
              密码仅在此显示一次；请立即转交给对应用户，刷新或离开页面后无法再次查看。
            </p>
            <div className="mt-2 space-y-1 text-[12px] font-mono">
              {pendingCreds.map((c) => (
                <div key={c.username} className="flex items-center justify-between rounded-[10px] bg-white px-3 py-2">
                  <span className="font-black">{c.username}</span>
                  <span className="text-[#b91c1c]">{c.password}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-black">下级账户</h3>
            <span className="text-[11px] font-bold text-[var(--cg-text-56)]">{merged.length} 个</span>
          </div>
          {!loading && merged.length === 0 && (
            <p className="mt-2 text-[12px] text-[var(--cg-text-56)]">还没有下级账户。点击上方&quot;生成新账户&quot;开始。</p>
          )}
          {merged.map((u) => (
            <div key={u.id} className="mt-3 rounded-[14px] border border-[var(--cg-border)] bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[14px] font-black">{u.username}</div>
                  <div className="mt-0.5 text-[10px] text-[var(--cg-text-56)]">
                    #{u.id} · {u.is_credit ? "信用账户" : "未开信用"} · {u.status}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[14px] font-mono font-black text-[var(--cg-gold-deep)]">
                    {u.credit_balance != null ? u.credit_balance.toFixed(2) : "—"}
                  </div>
                  <div className="text-[10px] text-[var(--cg-text-56)]">USDT 信用</div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="加额度 USDT"
                  value={topupAmount[u.id] || ""}
                  onChange={(e) => setTopupAmount((s) => ({ ...s, [u.id]: e.target.value }))}
                  className="flex-1 rounded-[10px] border border-[var(--cg-border)] bg-white px-3 py-1.5 text-[12px] font-semibold outline-none focus:border-[var(--cg-brown)]"
                />
                <button
                  type="button"
                  onClick={() => topup(u.id)}
                  disabled={busy || !topupAmount[u.id]}
                  className="rounded-[10px] bg-[var(--cg-gold)] px-3 py-1.5 text-[11px] font-black text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  加额度
                </button>
              </div>
            </div>
          ))}
        </Card>

        {toast && (
          <Card className="bg-[var(--cg-gold)]/15">
            <p className="text-[12px] font-bold text-[var(--cg-gold-deep)]">{toast}</p>
          </Card>
        )}
      </div>
    </>
  );
}

function BottomNav({ screen, go }: { screen: string; go: (screen: Screen) => void }) {
  // Mobile bottom navigation. The dedicated 代理 entry is intentionally
  // omitted — agent ops are surfaced inside ManageScreen for accounts
  // flagged as 代理, freeing up real estate for the four primary tabs.
  const items: Array<{ id: Screen; label: string; icon: ReactNode }> = [
    {
      id: "discover",
      label: "首页",
      icon: (
        <svg viewBox="0 0 24 24" className="size-[22px] fill-current">
          <path d="M12 3.2 3 10.6V21h6v-6h6v6h6V10.6z" />
        </svg>
      ),
    },
    {
      id: "footballList",
      label: "下注",
      icon: (
        <svg viewBox="0 0 24 24" className="size-[22px] fill-current">
          <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm6.93 9H16.5a14.6 14.6 0 0 0-1.34-5.43A8 8 0 0 1 18.93 11ZM12 4.07a12.4 12.4 0 0 1 2 6.93h-4a12.4 12.4 0 0 1 2-6.93ZM4.26 14a8 8 0 0 1 0-4h2.66a16.34 16.34 0 0 0 0 4Zm.81 2H7.5a14.6 14.6 0 0 0 1.34 5.43A8 8 0 0 1 5.07 16Zm2.43-5H5.07a8 8 0 0 1 3.77-5.43A14.6 14.6 0 0 0 7.5 11ZM12 19.93A12.4 12.4 0 0 1 10 13h4a12.4 12.4 0 0 1-2 6.93Zm3.16-2.43A14.6 14.6 0 0 0 16.5 13h2.43a8 8 0 0 1-3.77 4.5Zm1.92-3.5a16.34 16.34 0 0 0 0-4h2.66a8 8 0 0 1 0 4Z" />
        </svg>
      ),
    },
    {
      id: "profile",
      label: "钱包",
      icon: (
        <svg viewBox="0 0 24 24" className="size-[22px] fill-current">
          <path d="M21 7H5a1 1 0 0 1 0-2h14V3H5a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Zm-3.5 8a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5Z" />
        </svg>
      ),
    },
    {
      id: "manage",
      label: "管理",
      icon: (
        <svg viewBox="0 0 24 24" className="size-[22px] fill-current">
          <path d="M19.14 12.94a7.49 7.49 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.34 7.34 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7.34 7.34 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.65 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.49 7.49 0 0 0 0 1.88L2.77 14.52a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .61.22l2.39-.96a7.34 7.34 0 0 0 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54a7.34 7.34 0 0 0 1.62-.94l2.39.96a.5.5 0 0 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64ZM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5Z" />
        </svg>
      ),
    },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 flex h-[64px] items-stretch justify-around border-t border-[var(--cg-brown-dark)] bg-gradient-to-b from-[var(--cg-brown)] to-[var(--cg-brown-dark)] pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_12px_rgba(0,0,0,.18)] min-[1024px]:hidden"
      aria-label="主导航"
    >
      {items.map((item) => {
        const active = screen === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => go(item.id)}
            aria-current={active ? "page" : undefined}
            className={cx(
              "relative flex flex-1 flex-col items-center justify-center gap-0.5 px-2 pt-2 pb-1.5 text-[11px] font-bold transition-colors",
              active ? "text-[var(--cg-gold)]" : "text-white/55 active:text-[var(--cg-gold)] hover:text-[var(--cg-gold)]/80"
            )}
          >
            {/* Active indicator pill on top edge */}
            <span
              aria-hidden="true"
              className={cx(
                "pointer-events-none absolute left-1/2 top-0 h-[3px] w-7 -translate-x-1/2 rounded-b-full bg-[var(--cg-gold)] transition-opacity",
                active ? "opacity-100" : "opacity-0"
              )}
            />
            <span
              className={cx(
                "grid size-[34px] place-items-center rounded-full transition",
                active ? "bg-[var(--cg-gold)]/15" : "bg-transparent"
              )}
            >
              {item.icon}
            </span>
            <span className={cx("leading-none", active ? "tracking-wide" : "")}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function EmptyState({ title, text, action, onClick }: { title: string; text: string; action: string; onClick: () => void }) {
  return <Card className="text-center"><h3 className="text-[16px] font-bold">{title}</h3><p className="mx-auto mt-2 max-w-[260px] text-[12px] leading-5 text-[var(--cg-text-56)]">{text}</p><div className="mt-4"><Button onClick={onClick}>{action}</Button></div></Card>;
}

function Toast({ message, clear }: { message: string; clear: () => void }) {
  return (
    <div className="fixed inset-x-4 bottom-20 z-[30] flex items-center justify-between rounded-lg bg-[var(--cg-brown)] px-4 py-3 text-[12px] font-bold text-white shadow-[0_4px_20px_rgba(0,0,0,.2)]">
      <span>{message}</span>
      <button type="button" onClick={clear} className="ml-3 font-bold text-[var(--cg-gold)]">✕</button>
    </div>
  );
}

// First-login forced change drawer — mirrors legacy PHP behaviour where
// newly created accounts must set a loginname or change password.
function MustChangeDrawer({
  reason,
  onComplete,
  setToast,
}: {
  reason: 'set_loginname' | 'change_password';
  onComplete: (newUsername?: string) => void;
  setToast: (msg: string) => void;
}) {
  const [loginname, setLoginname] = useState('');
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submitLoginname = async () => {
    if (!loginname.trim()) return;
    setSubmitting(true);
    try {
      const resp = await pmppmApi.setLoginname(loginname.trim());
      if (resp.ok) {
        onComplete(resp.username);
      } else {
        setToast(resp.detail || '设置失败');
      }
    } catch (err) {
      setToast(err instanceof Error ? err.message : '设置失败');
    } finally {
      setSubmitting(false);
    }
  };

  const submitPassword = async () => {
    if (!oldPwd || !newPwd) return;
    if (newPwd !== confirmPwd) {
      setToast('两次输入的新密码不一致');
      return;
    }
    setSubmitting(true);
    try {
      const resp = await pmppmApi.changePwd(oldPwd, newPwd);
      if (resp.ok) {
        onComplete();
      } else {
        setToast(resp.detail || '修改失败');
      }
    } catch (err) {
      setToast(err instanceof Error ? err.message : '修改失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[26] flex items-center justify-center bg-black/60">
      <div className="w-[90%] max-w-md rounded-2xl bg-white p-5 shadow-[0_8px_40px_rgba(0,0,0,.3)]">
        {reason === 'set_loginname' ? (
          <>
            <h2 className="text-[18px] font-bold text-[var(--cg-brown)]">首次登入 — 设置登入帐号</h2>
            <p className="mt-2 text-[12px] leading-5 text-[var(--cg-text-56)]">
              您的账户是首次登入，需要设置一个专属的登入帐号。以后使用此帐号登陆。
            </p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="block text-[11px] font-bold text-[var(--cg-text-56)]">新登入帐号</span>
                <input
                  type="text"
                  value={loginname}
                  onChange={(e) => setLoginname(e.target.value)}
                  placeholder="4-12位，字母开头，字母数字下划线"
                  className="mt-1 w-full rounded-lg border border-[var(--cg-border)] bg-white px-3 py-2.5 text-[14px] font-semibold outline-none focus:border-[var(--cg-brown)]"
                />
              </label>
              <Button full onClick={submitLoginname} disabled={!loginname.trim() || submitting}>
                {submitting ? '设置中...' : '确认设置'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-[18px] font-bold text-[var(--cg-brown)]">安全提示 — 修改密码</h2>
            <p className="mt-2 text-[12px] leading-5 text-[var(--cg-text-56)]">
              您的密码已超过30天未修改，为保障账户安全，建议尽快更改密码。如暂不方便，可点击「稍后修改」继续。
            </p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="block text-[11px] font-bold text-[var(--cg-text-56)]">旧密码</span>
                <input
                  type="password"
                  value={oldPwd}
                  onChange={(e) => setOldPwd(e.target.value)}
                  placeholder="当前密码"
                  className="mt-1 w-full rounded-lg border border-[var(--cg-border)] bg-white px-3 py-2.5 text-[14px] font-semibold outline-none focus:border-[var(--cg-brown)]"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-bold text-[var(--cg-text-56)]">新密码</span>
                <input
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder="6-12位，需含字母和数字"
                  className="mt-1 w-full rounded-lg border border-[var(--cg-border)] bg-white px-3 py-2.5 text-[14px] font-semibold outline-none focus:border-[var(--cg-brown)]"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] font-bold text-[var(--cg-text-56)]">确认新密码</span>
                <input
                  type="password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  placeholder="再次输入新密码"
                  className="mt-1 w-full rounded-lg border border-[var(--cg-border)] bg-white px-3 py-2.5 text-[14px] font-semibold outline-none focus:border-[var(--cg-brown)]"
                />
              </label>
              {/* Two-button layout: "稍后修改" lets the user skip the
                  30-day password-reminder prompt without touching the
                  database (the backend session flag is harmless on its
                  own — it only re-triggers on the next login).
                  Mandatory loginname creation has no skip button because
                  the column is NOT NULL on first use. */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onComplete()}
                  disabled={submitting}
                  className="flex-1 rounded-lg border border-[var(--cg-border)] bg-white py-2.5 text-[13px] font-bold text-[var(--cg-text-56)] hover:bg-[var(--cg-card-bg)] disabled:opacity-50"
                >
                  稍后修改
                </button>
                <button
                  type="button"
                  onClick={submitPassword}
                  disabled={!oldPwd || !newPwd || !confirmPwd || submitting}
                  className="flex-1 rounded-lg bg-[var(--cg-green)] py-2.5 text-[13px] font-bold text-white hover:bg-[var(--cg-green)]/90 disabled:opacity-50"
                >
                  {submitting ? '修改中...' : '确认修改'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Credit-account login drawer. PmPm runs a sportsbook-style信用账户 model
// (账户由代理生成，授权信用额度用于下注) — no on-chain wallet required.
// The form submits to `login(...)`, which the parent wires up to mock
// account state for the prototype; a real backend would POST these
// credentials to /api/auth and return an account session.
function LoginDrawer({
  close,
  login,
}: {
  close: () => void;
  login: (creds: { username: string; password: string; agentCode: string }) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const disabled = !username.trim() || !password.trim();
  const submit = () => {
    if (disabled) return;
    login({ username: username.trim(), password, agentCode: "" });
  };
  return (
    <div className="fixed inset-0 z-[25] flex items-end justify-center bg-black/40">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-[0_-8px_30px_rgba(0,0,0,.2)]">
        <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-[var(--cg-separator)]" />
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[18px] font-bold text-[var(--cg-brown)]">登陆信用账户</h2>
            <p className="mt-1 text-[12px] leading-5 text-[var(--cg-text-56)]">
              账户由代理生成；输入用户名、密码后即可使用授权的信用额度下注。
            </p>
          </div>
          <button type="button" onClick={close} className="grid size-8 place-items-center rounded-full bg-[var(--cg-bg-light)] font-bold text-[var(--cg-text-56)]">✕</button>
        </div>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="block text-[11px] font-bold text-[var(--cg-text-56)]">用户名</span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="账号"
              className="mt-1 w-full rounded-lg border border-[var(--cg-border)] bg-white px-3 py-2.5 text-[14px] font-semibold outline-none focus:border-[var(--cg-brown)]"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-bold text-[var(--cg-text-56)]">密码</span>
            <div className="mt-1 flex items-center rounded-lg border border-[var(--cg-border)] bg-white px-3 py-2.5 focus-within:border-[var(--cg-brown)]">
              <input
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="代理为你设置的密码"
                className="flex-1 bg-transparent text-[14px] font-semibold outline-none"
              />
              <button type="button" onClick={() => setShowPw((v) => !v)} className="text-[11px] font-bold text-[var(--cg-gold-deep)]">
                {showPw ? "隐藏" : "显示"}
              </button>
            </div>
          </label>
          <Button full onClick={submit} disabled={disabled}>登陆并下注</Button>
          <p className="text-center text-[11px] leading-5 text-[var(--cg-text-24)]">
            忘记密码？请联系给你账户的代理重置。
          </p>
        </div>
      </div>
    </div>
  );
}
