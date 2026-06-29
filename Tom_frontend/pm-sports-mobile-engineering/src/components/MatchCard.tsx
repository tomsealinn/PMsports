import type { BetItem, Match, OddOption } from '../types';
import { BallIcon, StarIcon } from './Icons';
import { getBetId, matchStatusLabel, oddsText } from '../utils/calc';

interface MatchCardProps {
  match: Match;
  isFavorite: boolean;
  betItems: BetItem[];
  onOpenDetail: (matchId: string) => void;
  onToggleFavorite: (matchId: string) => void;
  onToggleOdd: (match: Match, odd: OddOption) => void;
}

const toneClass = (tone: Match['home']['tone']) => `abbr ${tone}`;

export function MatchCard({ match, isFavorite, betItems, onOpenDetail, onToggleFavorite, onToggleOdd }: MatchCardProps) {
  const handicap = match.markets.find((group) => group.key === 'handicap')?.options.slice(0, 2) ?? [];
  const totals = match.markets.find((group) => group.key === 'total')?.options.slice(0, 2) ?? [];
  const moneyline = match.markets.find((group) => group.key === 'moneyline')?.options ?? [];
  const visibleOdds = [...handicap.slice(0, 1), ...totals.slice(0, 1), ...moneyline];

  const isSelected = (odd: OddOption) => betItems.some((item) => item.betId === getBetId(match.id, odd.id));

  return (
    <article className="matchCard">
      <div className="matchCardTapLayer" onClick={() => onOpenDetail(match.id)} aria-label="打开赛事详情" />
      <div className="matchTop">
        <div className="leftMeta">
          <button
            className={`favoriteBtn ${isFavorite ? 'active' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite(match.id);
            }}
            aria-label="收藏赛事"
          >
            <StarIcon />
          </button>
          <span className={match.status === 'upcoming' ? 'prematchTag' : 'liveTag'}>{matchStatusLabel(match)}</span>
        </div>
        <button className="marketCount" onClick={() => onOpenDetail(match.id)}>
          <b>{match.marketCount}</b> 个盘口
        </button>
      </div>

      <div className="teamsScore" onClick={() => onOpenDetail(match.id)}>
        <div className="teamSide">
          <span className={toneClass(match.home.tone)}>{match.home.shortName}</span>
          <b>{match.home.name}</b>
        </div>
        <div className="scoreBox num">
          <span>{match.homeScore}</span>
          <i>-</i>
          <span>{match.awayScore}</span>
        </div>
        <div className="teamSide away">
          <b>{match.away.name}</b>
          <span className={toneClass(match.away.tone)}>{match.away.shortName}</span>
        </div>
      </div>

      <div className="oddsGrid">
        {visibleOdds.map((odd) => (
          <button
            key={odd.id}
            className={`oddsButton ${isSelected(odd) ? 'selected' : ''} ${odd.status !== 'open' ? odd.status : ''}`}
            disabled={odd.status === 'locked'}
            onClick={(event) => {
              event.stopPropagation();
              onToggleOdd(match, odd);
            }}
          >
            <span>{odd.marketName}{odd.line ? ` ${odd.line}` : ''}</span>
            <b className="num">{oddsText(odd.value)}</b>
          </button>
        ))}
      </div>
    </article>
  );
}

interface LeagueBlockProps {
  leagueName: string;
  leagueType: string;
  matches: Match[];
  favorites: Set<string>;
  betItems: BetItem[];
  onOpenDetail: (matchId: string) => void;
  onToggleFavorite: (matchId: string) => void;
  onToggleOdd: (match: Match, odd: OddOption) => void;
}

export function LeagueBlock({
  leagueName,
  leagueType,
  matches,
  favorites,
  betItems,
  onOpenDetail,
  onToggleFavorite,
  onToggleOdd
}: LeagueBlockProps) {
  return (
    <section className="leagueBlock">
      <header className="leagueHeader">
        <div className="leagueHeaderTitle">
          <span className="leagueBall"><BallIcon /></span>
          <span>
            <b>{leagueName}</b>
            <small>{leagueType}</small>
          </span>
        </div>
        <span className="leagueCount">{matches.length} 场</span>
      </header>
      {matches.map((match) => (
        <MatchCard
          key={match.id}
          match={match}
          isFavorite={favorites.has(match.id)}
          betItems={betItems}
          onOpenDetail={onOpenDetail}
          onToggleFavorite={onToggleFavorite}
          onToggleOdd={onToggleOdd}
        />
      ))}
    </section>
  );
}
