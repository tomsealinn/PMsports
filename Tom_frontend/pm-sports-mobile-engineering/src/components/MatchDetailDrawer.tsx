import { useMemo, useState } from 'react';
import type { BetItem, MarketKey, Match, OddOption } from '../types';
import { getBetId, matchStatusLabel, money, oddsText } from '../utils/calc';
import { BackIcon, ChartIcon, PlayIcon, RefreshIcon, StarIcon, TicketIcon, UsersIcon } from './Icons';

interface MatchDetailDrawerProps {
  match: Match | null;
  betItems: BetItem[];
  favorites: Set<string>;
  onClose: () => void;
  onToggleFavorite: (matchId: string) => void;
  onToggleOdd: (match: Match, odd: OddOption) => void;
  onOpenBetSlip: () => void;
  onToast: (message: string) => void;
}

const tabs: Array<{ key: 'all' | MarketKey; label: string }> = [
  { key: 'all', label: '全部盘口' },
  { key: 'handicap', label: '让球' },
  { key: 'total', label: '大小' },
  { key: 'moneyline', label: '独赢' },
  { key: 'half', label: '半场' },
  { key: 'corner', label: '角球' },
  { key: 'score', label: '更多' }
];

export function MatchDetailDrawer({
  match,
  betItems,
  favorites,
  onClose,
  onToggleFavorite,
  onToggleOdd,
  onOpenBetSlip,
  onToast
}: MatchDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<'all' | MarketKey>('all');

  const visibleGroups = useMemo(() => {
    if (!match) return [];
    if (activeTab === 'all' || activeTab === 'score') return match.markets;
    return match.markets.filter((group) => group.key === activeTab);
  }, [activeTab, match]);

  if (!match) {
    return <section className="detailDrawer" aria-hidden="true" />;
  }

  const selected = (odd: OddOption) => betItems.some((item) => item.betId === getBetId(match.id, odd.id));
  const totalStake = betItems.reduce((sum, item) => sum + item.stake, 0);

  return (
    <section className="detailDrawer show" role="dialog" aria-modal="true" aria-label="赛事详情">
      <header className="detailTopbar">
        <button className="backBtn" onClick={onClose} aria-label="返回"><BackIcon /></button>
        <h2>{match.home.name} vs {match.away.name}</h2>
        <div className="detailActions">
          <button className={`iconBtn plain ${favorites.has(match.id) ? 'activeStar' : ''}`} onClick={() => onToggleFavorite(match.id)} aria-label="收藏">
            <StarIcon />
          </button>
          <button className="iconBtn plain" onClick={() => onToast('盘口已刷新')} aria-label="刷新">
            <RefreshIcon />
          </button>
        </div>
      </header>

      <section className="scoreHero">
        <div className="heroTeams">
          <div className="heroTeam">
            <span className={`abbr big ${match.home.tone}`}>{match.home.shortName}</span>
            <b>{match.home.name}</b>
          </div>
          <div className="heroScore">
            <strong className="num">{match.homeScore} - {match.awayScore}</strong>
            <span>{matchStatusLabel(match)}</span>
          </div>
          <div className="heroTeam">
            <span className={`abbr big ${match.away.tone}`}>{match.away.shortName}</span>
            <b>{match.away.name}</b>
          </div>
        </div>
        <button className="heroLeague">{match.leagueName}</button>
        <div className="heroShortcuts">
          <button><PlayIcon />直播</button>
          <button><UsersIcon />阵容</button>
          <button><ChartIcon />数据</button>
          <button><TicketIcon />事件</button>
        </div>
      </section>

      <nav className="marketTabs" aria-label="盘口分类">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={activeTab === tab.key ? 'active' : ''}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="marketScroll">
        {visibleGroups.map((group) => (
          <section className="marketGroup" key={group.key}>
            <header>
              <h3>{group.title}</h3>
              <span>{group.count} 个盘口</span>
            </header>
            <div className={`detailOddsGrid ${group.options.length === 3 ? 'three' : ''}`}>
              {group.options.map((odd) => (
                <button
                  key={odd.id}
                  className={`detailOddsButton ${selected(odd) ? 'selected' : ''}`}
                  onClick={() => onToggleOdd(match, odd)}
                >
                  <span>{odd.label}{odd.line ? ` ${odd.line}` : ''}</span>
                  <b className="num">{oddsText(odd.value)}</b>
                </button>
              ))}
            </div>
            {group.options.length > 4 ? <button className="expandMore">展开更多</button> : null}
          </section>
        ))}
      </main>

      {betItems.length ? (
        <div className="detailBetBar" onClick={onOpenBetSlip} role="button" tabIndex={0}>
          <div>
            <b>投注单</b>
            <span>{betItems.length}</span>
          </div>
          <strong className="num">¥ {money(totalStake)}</strong>
          <button>去投注</button>
        </div>
      ) : null}
    </section>
  );
}
