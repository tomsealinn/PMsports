import { FilterIcon, SearchIcon } from './Icons';

interface SearchFilterProps {
  keyword: string;
  selectedCount: number;
  onKeywordChange: (keyword: string) => void;
  onOpenFilter: () => void;
}

export function SearchFilter({ keyword, selectedCount, onKeywordChange, onOpenFilter }: SearchFilterProps) {
  return (
    <div className="searchRow">
      <label className="searchBox">
        <SearchIcon />
        <input
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
          placeholder="搜索球队 / 联赛 / 国家"
        />
      </label>
      <button className="filterBtn" onClick={onOpenFilter}>
        <FilterIcon />
        联赛{selectedCount ? ` ${selectedCount}` : ''}
      </button>
    </div>
  );
}
