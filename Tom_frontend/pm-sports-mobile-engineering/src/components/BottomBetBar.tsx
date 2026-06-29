import type { BetItem } from '../types';
import { calcTotalStake, money } from '../utils/calc';

interface BottomBetBarProps {
  items: BetItem[];
  onOpen: () => void;
}

export function BottomBetBar({ items, onOpen }: BottomBetBarProps) {
  if (!items.length) return null;
  return (
    <div className="bottomBetBar" role="button" onClick={onOpen} tabIndex={0}>
      <div className="bottomBetLeft">
        <b>投注单</b>
        <span>{items.length}</span>
      </div>
      <strong className="num">¥ {money(calcTotalStake(items))}</strong>
      <button>去投注</button>
    </div>
  );
}
