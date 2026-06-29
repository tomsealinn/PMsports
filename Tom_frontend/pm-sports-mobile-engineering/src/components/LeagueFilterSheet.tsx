import { useMemo, useState } from 'react';
import type { League } from '../types';
import { BottomSheet } from './BottomSheet';
import { SearchIcon } from './Icons';

interface LeagueFilterSheetProps {
  open: boolean;
  leagues: League[];
  selectedLeagueIds: string[];
  onApply: (leagueIds: string[]) => void;
  onClose: () => void;
}

export function LeagueFilterSheet({ open, leagues, selectedLeagueIds, onApply, onClose }: LeagueFilterSheetProps) {
  const [draft, setDraft] = useState<string[]>(selectedLeagueIds);
  const [keyword, setKeyword] = useState('');
  const [quick, setQuick] = useState<'all' | 'live' | 'hot' | 'today' | 'favorite'>('all');

  const filtered = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return leagues
      .filter((league) => league.id !== 'all')
      .filter((league) => {
        const keywordMatched = !normalized || `${league.name}${league.region}${league.shortName ?? ''}`.toLowerCase().includes(normalized);
        const quickMatched = quick === 'all' || (quick === 'live' ? league.liveOnly : true);
        return keywordMatched && quickMatched;
      });
  }, [keyword, leagues, quick]);

  const toggleLeague = (leagueId: string) => {
    setDraft((value) => (value.includes(leagueId) ? value.filter((id) => id !== leagueId) : [...value, leagueId]));
  };

  return (
    <BottomSheet open={open} title="选择联赛" tall onClose={onClose} right={<span className="miniBadge">{draft.length}</span>}>
      <div className="leagueFilterContent">
        <label className="searchBox sheetSearch">
          <SearchIcon />
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索联赛 / 国家 / 球队" />
        </label>

        <div className="filterChips">
          {[
            ['all', '全部'],
            ['live', '滚球'],
            ['hot', '热门'],
            ['today', '今日有赛'],
            ['favorite', '已收藏']
          ].map(([key, label]) => (
            <button key={key} className={quick === key ? 'active' : ''} onClick={() => setQuick(key as typeof quick)}>
              {label}
            </button>
          ))}
        </div>

        <div className="leagueCheckList">
          {filtered.map((league) => (
            <button
              key={league.id}
              className={`checkRow ${draft.includes(league.id) ? 'active' : ''}`}
              onClick={() => toggleLeague(league.id)}
            >
              <span className="checkBox" />
              <span>
                <b>{league.name}</b>
                <small>{league.region}</small>
              </span>
              <em>{league.count}</em>
            </button>
          ))}
        </div>

        <div className="filterFooter">
          <button className="secondaryButton" onClick={() => setDraft([])}>重置</button>
          <button className="primaryButton" onClick={() => onApply(draft)}>确定 {draft.length ? `${draft.length} 项` : '全部'}</button>
        </div>
      </div>
    </BottomSheet>
  );
}
