import type { BetItem, BetMode, Match, OddOption } from '../types';

export const money = (value: number) =>
  new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

export const oddsText = (value: number) => value.toFixed(2);

export const getBetId = (matchId: string, oddId: string) => `${matchId}__${oddId}`;

export const matchStatusLabel = (match: Match) => {
  if (match.status === 'live') return `滚球 · ${match.minute}'`;
  if (match.status === 'halftime') return `滚球 · ${match.phaseLabel ?? '中场'}`;
  if (match.status === 'paused') return '比赛暂停';
  if (match.status === 'ended') return '已完场';
  return `${match.startTime} 开赛`;
};

export const createBetItem = (match: Match, odd: OddOption, defaultStake = 100): BetItem => ({
  betId: getBetId(match.id, odd.id),
  matchId: match.id,
  oddId: odd.id,
  leagueName: match.leagueName,
  matchName: `${match.home.name} vs ${match.away.name}`,
  marketName: odd.marketName,
  line: odd.line,
  selection: odd.label,
  odds: odd.value,
  stake: defaultStake,
  matchStatus: matchStatusLabel(match),
  marketCount: match.marketCount
});

export const calcTotalStake = (items: BetItem[]) => items.reduce((sum, item) => sum + item.stake, 0);

export const calcTotalOdds = (items: BetItem[], mode: BetMode) => {
  if (!items.length) return 0;
  if (mode === 'single') return items.reduce((sum, item) => sum + item.odds, 0);
  return items.reduce((total, item) => total * item.odds, 1);
};

export const calcEstimatedReturn = (items: BetItem[], mode: BetMode) => {
  if (!items.length) return 0;
  if (mode === 'single') return items.reduce((sum, item) => sum + item.stake * item.odds, 0);
  const stake = items[0]?.stake ?? 0;
  return stake * calcTotalOdds(items, mode);
};
