export type MainTab = 'all' | 'live' | 'today' | 'early' | 'hot' | 'favorite' | 'champion';
export type MatchStatus = 'live' | 'upcoming' | 'halftime' | 'paused' | 'ended';
export type MarketKey = 'handicap' | 'total' | 'moneyline' | 'half' | 'corner' | 'score' | 'special';
export type OddsStatus = 'open' | 'locked' | 'up' | 'down';
export type BetMode = 'single' | 'parlay';
export type SheetKind = 'betslip' | 'league-filter' | 'settings' | 'my-bets' | null;

export interface League {
  id: string;
  name: string;
  shortName?: string;
  count: number;
  region: string;
  featured?: boolean;
  liveOnly?: boolean;
}

export interface Team {
  name: string;
  shortName: string;
  tone: 'gold' | 'blue' | 'green' | 'red' | 'neutral';
}

export interface OddOption {
  id: string;
  marketKey: MarketKey;
  marketName: string;
  label: string;
  line?: string;
  value: number;
  status: OddsStatus;
}

export interface MarketGroup {
  key: MarketKey;
  title: string;
  count: number;
  options: OddOption[];
}

export interface Match {
  id: string;
  leagueId: string;
  leagueName: string;
  leagueType: string;
  status: MatchStatus;
  minute?: number;
  phaseLabel?: string;
  startTime: string;
  dateLabel: string;
  home: Team;
  away: Team;
  homeScore: number;
  awayScore: number;
  marketCount: number;
  isHot: boolean;
  isChampion?: boolean;
  markets: MarketGroup[];
}

export interface BetItem {
  betId: string;
  matchId: string;
  oddId: string;
  leagueName: string;
  matchName: string;
  marketName: string;
  line?: string;
  selection: string;
  odds: number;
  stake: number;
  matchStatus: string;
  marketCount: number;
}

export interface BetRecord {
  id: string;
  tags: string[];
  leagueName: string;
  matchName: string;
  placedAt: string;
  stake: number;
  odds: number;
  returnAmount: number;
  status: '进行中' | '赢' | '输' | '退款 / 取消';
}
