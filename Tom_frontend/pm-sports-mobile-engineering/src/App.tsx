import { useMemo, useState } from 'react';
import { BetSlipSheet } from './components/BetSlipSheet';
import { BottomBetBar } from './components/BottomBetBar';
import { DateChips } from './components/DateChips';
import { LeagueBlock } from './components/MatchCard';
import { LeagueFilterSheet } from './components/LeagueFilterSheet';
import { LeagueStrip } from './components/LeagueStrip';
import { MainTabs } from './components/MainTabs';
import { MatchDetailDrawer } from './components/MatchDetailDrawer';
import { MyBetsSheet } from './components/MyBetsSheet';
import { SearchFilter } from './components/SearchFilter';
import { SettingsSheet } from './components/SettingsSheet';
import { Toast } from './components/Toast';
import { TopBar } from './components/TopBar';
import { betRecords, leagues, matches } from './data/mockData';
import type { BetItem, BetMode, MainTab, Match, OddOption, SheetKind } from './types';
import { createBetItem, getBetId } from './utils/calc';

export default function App() {
  const [activeTab, setActiveTab] = useState<MainTab>('all');
  const [dateChip, setDateChip] = useState('全部');
  const [keyword, setKeyword] = useState('');
  const [selectedLeagueIds, setSelectedLeagueIds] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set(['m-chi-tha']));
  const [betItems, setBetItems] = useState<BetItem[]>([]);
  const [betMode, setBetMode] = useState<BetMode>('single');
  const [openSheet, setOpenSheet] = useState<SheetKind>(null);
  const [detailMatchId, setDetailMatchId] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 1800);
  };

  const filteredMatches = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();

    return matches.filter((match) => {
      const tabMatched =
        activeTab === 'all' ||
        (activeTab === 'live' && ['live', 'halftime', 'paused'].includes(match.status)) ||
        (activeTab === 'today' && match.dateLabel === '今日') ||
        (activeTab === 'early' && match.status === 'upcoming') ||
        (activeTab === 'hot' && match.isHot) ||
        (activeTab === 'favorite' && favorites.has(match.id)) ||
        (activeTab === 'champion' && match.isChampion);

      const leagueMatched = !selectedLeagueIds.length || selectedLeagueIds.includes(match.leagueId);
      const dateMatched = dateChip === '全部' || dateChip === match.dateLabel;
      const keywordMatched =
        !normalized ||
        `${match.home.name}${match.away.name}${match.leagueName}${match.home.shortName}${match.away.shortName}`
          .toLowerCase()
          .includes(normalized);

      return tabMatched && leagueMatched && dateMatched && keywordMatched;
    });
  }, [activeTab, dateChip, favorites, keyword, selectedLeagueIds]);

  const groupedMatches = useMemo(() => {
    const map = new Map<string, Match[]>();
    filteredMatches.forEach((match) => {
      const key = match.leagueName;
      map.set(key, [...(map.get(key) ?? []), match]);
    });
    return Array.from(map.entries()).map(([leagueName, group]) => ({ leagueName, matches: group, leagueType: group[0].leagueType }));
  }, [filteredMatches]);

  const detailMatch = useMemo(() => matches.find((match) => match.id === detailMatchId) ?? null, [detailMatchId]);

  const toggleLeagueQuick = (leagueId: string) => {
    if (leagueId === 'all') {
      setSelectedLeagueIds([]);
      return;
    }
    setSelectedLeagueIds((ids) => (ids.includes(leagueId) ? ids.filter((id) => id !== leagueId) : [leagueId]));
  };

  const toggleFavorite = (matchId: string) => {
    setFavorites((value) => {
      const next = new Set(value);
      if (next.has(matchId)) {
        next.delete(matchId);
        showToast('已取消收藏');
      } else {
        next.add(matchId);
        showToast('已收藏');
      }
      return next;
    });
  };

  const toggleOdd = (match: Match, odd: OddOption) => {
    if (odd.status === 'locked') {
      showToast('盘口已关闭');
      return;
    }

    const betId = getBetId(match.id, odd.id);
    setBetItems((items) => {
      if (items.some((item) => item.betId === betId)) {
        showToast('已从投注单移除');
        return items.filter((item) => item.betId !== betId);
      }
      showToast('已加入投注单');
      return [...items, createBetItem(match, odd)];
    });
  };

  const changeStake = (betId: string, stake: number) => {
    setBetItems((items) => items.map((item) => (item.betId === betId ? { ...item, stake } : item)));
  };

  const submitBet = () => {
    if (!betItems.length) return;
    showToast('投注成功');
    setOpenSheet(null);
  };

  return (
    <div className="appShell">
      <TopBar
        onSettings={() => setOpenSheet('settings')}
        onMyBets={() => setOpenSheet('my-bets')}
        onConnection={() => showToast('连接状态：已连接 · 延迟 0.2s')}
      />
      <MainTabs value={activeTab} onChange={setActiveTab} />

      <main className="contentScroll">
        <SearchFilter
          keyword={keyword}
          selectedCount={selectedLeagueIds.length}
          onKeywordChange={setKeyword}
          onOpenFilter={() => setOpenSheet('league-filter')}
        />
        <LeagueStrip
          leagues={leagues}
          selectedLeagueIds={selectedLeagueIds}
          onToggle={toggleLeagueQuick}
          onMore={() => setOpenSheet('league-filter')}
        />
        <DateChips value={dateChip} onChange={setDateChip} />

        {groupedMatches.length ? (
          groupedMatches.map((group) => (
            <LeagueBlock
              key={group.leagueName}
              leagueName={group.leagueName}
              leagueType={group.leagueType}
              matches={group.matches}
              favorites={favorites}
              betItems={betItems}
              onOpenDetail={setDetailMatchId}
              onToggleFavorite={toggleFavorite}
              onToggleOdd={toggleOdd}
            />
          ))
        ) : (
          <section className="emptyState mainEmpty">
            <h3>暂无赛事</h3>
            <p>当前筛选下没有可用比赛</p>
            <button
              onClick={() => {
                setActiveTab('all');
                setSelectedLeagueIds([]);
                setKeyword('');
                setDateChip('全部');
              }}
            >
              重置筛选
            </button>
          </section>
        )}
      </main>

      <BottomBetBar items={betItems} onOpen={() => setOpenSheet('betslip')} />

      <BetSlipSheet
        items={betItems}
        mode={betMode}
        open={openSheet === 'betslip'}
        onClose={() => setOpenSheet(null)}
        onModeChange={setBetMode}
        onStakeChange={changeStake}
        onRemove={(betId) => setBetItems((items) => items.filter((item) => item.betId !== betId))}
        onClear={() => setBetItems([])}
        onSubmit={submitBet}
      />

      <LeagueFilterSheet
        open={openSheet === 'league-filter'}
        leagues={leagues}
        selectedLeagueIds={selectedLeagueIds}
        onApply={(leagueIds) => {
          setSelectedLeagueIds(leagueIds);
          setOpenSheet(null);
        }}
        onClose={() => setOpenSheet(null)}
      />

      <SettingsSheet open={openSheet === 'settings'} onClose={() => setOpenSheet(null)} />
      <MyBetsSheet open={openSheet === 'my-bets'} records={betRecords} onClose={() => setOpenSheet(null)} />

      <MatchDetailDrawer
        match={detailMatch}
        betItems={betItems}
        favorites={favorites}
        onClose={() => setDetailMatchId(null)}
        onToggleFavorite={toggleFavorite}
        onToggleOdd={toggleOdd}
        onOpenBetSlip={() => setOpenSheet('betslip')}
        onToast={showToast}
      />

      <Toast message={toast} />
    </div>
  );
}
