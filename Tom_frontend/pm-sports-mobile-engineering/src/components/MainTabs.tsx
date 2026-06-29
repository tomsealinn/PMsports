import type { MainTab } from '../types';

const tabs: Array<{ key: MainTab; label: string; count?: number }> = [
  { key: 'all', label: '全部' },
  { key: 'live', label: '滚球', count: 14 },
  { key: 'today', label: '今日' },
  { key: 'early', label: '早盘' },
  { key: 'hot', label: '热门' },
  { key: 'favorite', label: '收藏' },
  { key: 'champion', label: '冠军' }
];

interface MainTabsProps {
  value: MainTab;
  onChange: (tab: MainTab) => void;
}

export function MainTabs({ value, onChange }: MainTabsProps) {
  return (
    <nav className="mainTabs" aria-label="赛事筛选">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={`mainTab ${value === tab.key ? 'active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          {tab.count ? <span className="tabBadge">{tab.count}</span> : null}
        </button>
      ))}
    </nav>
  );
}
