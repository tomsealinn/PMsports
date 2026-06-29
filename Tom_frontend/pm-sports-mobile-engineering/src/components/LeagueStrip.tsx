import type { League } from '../types';
import { BallIcon, ChevronIcon, GlobeIcon } from './Icons';

interface LeagueStripProps {
  leagues: League[];
  selectedLeagueIds: string[];
  onToggle: (leagueId: string) => void;
  onMore: () => void;
}

export function LeagueStrip({ leagues, selectedLeagueIds, onToggle, onMore }: LeagueStripProps) {
  const featured = leagues.filter((league) => league.featured).slice(0, 7);

  return (
    <section className="quickPanel">
      <div className="quickPanelHeader">
        <span>快捷联赛</span>
        <button onClick={onMore}>
          更多 <ChevronIcon />
        </button>
      </div>
      <div className="leagueStrip">
        {featured.map((league, index) => {
          const active = league.id === 'all' ? selectedLeagueIds.length === 0 : selectedLeagueIds.includes(league.id);
          return (
            <button
              className={`leagueItem ${active ? 'active' : ''}`}
              key={league.id}
              onClick={() => onToggle(league.id)}
            >
              <span className="leagueIcon">{index === 0 ? <GlobeIcon /> : <BallIcon />}</span>
              <span className="leagueNameClip">{league.shortName ?? league.name}</span>
              <small>{league.count}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}
