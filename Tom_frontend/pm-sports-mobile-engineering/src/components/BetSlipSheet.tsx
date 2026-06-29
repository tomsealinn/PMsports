import type { BetItem, BetMode } from '../types';
import { calcEstimatedReturn, calcTotalOdds, calcTotalStake, money, oddsText } from '../utils/calc';
import { CloseIcon, TrashIcon } from './Icons';

interface BetSlipSheetProps {
  items: BetItem[];
  mode: BetMode;
  open: boolean;
  onClose: () => void;
  onModeChange: (mode: BetMode) => void;
  onStakeChange: (betId: string, stake: number) => void;
  onRemove: (betId: string) => void;
  onClear: () => void;
  onSubmit: () => void;
}

const quickAmounts = [50, 100, 500];

export function BetSlipSheet({
  items,
  mode,
  open,
  onClose,
  onModeChange,
  onStakeChange,
  onRemove,
  onClear,
  onSubmit
}: BetSlipSheetProps) {
  const totalStake = calcTotalStake(items);
  const totalOdds = calcTotalOdds(items, mode);
  const estimatedReturn = calcEstimatedReturn(items, mode);
  const canParlay = items.length >= 2 && new Set(items.map((item) => item.matchId)).size === items.length;
  const submitDisabled = totalStake <= 0 || !items.length;

  return (
    <div className={`sheetLayer ${open ? 'show' : ''}`} aria-hidden={!open}>
      <button className="sheetMask" onClick={onClose} aria-label="收起投注单" />
      <section className="bottomSheet betSlipSheet" role="dialog" aria-modal="true" aria-label="投注单">
        <div className="grabber" />
        <header className="sheetHeader">
          <h2>
            投注单 <span className="miniBadge">{items.length}</span>
          </h2>
          <div className="sheetHeaderRight">
            {items.length ? <button className="linkButton" onClick={onClear}>清空</button> : null}
            <button className="sheetClose" onClick={onClose} aria-label="收起">
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className="betModeTabs">
          <button className={mode === 'single' ? 'active' : ''} onClick={() => onModeChange('single')}>单关</button>
          <button
            className={mode === 'parlay' ? 'active' : ''}
            disabled={!canParlay}
            onClick={() => canParlay && onModeChange('parlay')}
          >
            串关
          </button>
        </div>

        <div className="betSlipBody">
          {!items.length ? (
            <div className="emptyState">
              <h3>暂无投注项</h3>
              <p>点击赛事卡片中的赔率即可加入投注单</p>
              <button onClick={onClose}>去看赛事</button>
            </div>
          ) : (
            items.map((item) => (
              <article className="betItemCard" key={item.betId}>
                <div className="betItemTop">
                  <div>
                    <b>{item.marketName}{item.line ? ` ${item.line}` : ''}</b>
                    <p>{item.selection}</p>
                  </div>
                  <div className="oddsAt">
                    <span>@</span>
                    <b className="num">{oddsText(item.odds)}</b>
                    <button onClick={() => onRemove(item.betId)} aria-label="删除投注项">
                      <TrashIcon />
                    </button>
                  </div>
                </div>
                <div className="betMatchName">{item.matchName}</div>
                <div className="betMeta">{item.leagueName} · {item.matchStatus} · {item.marketCount} 个盘口</div>
                <div className="stakeRow">
                  <label>
                    <span>金额</span>
                    <input
                      className="num"
                      value={Number.isFinite(item.stake) ? item.stake : 0}
                      inputMode="decimal"
                      onChange={(event) => onStakeChange(item.betId, Number(event.target.value.replace(/[^0-9.]/g, '')) || 0)}
                    />
                  </label>
                  <span className="currency">¥</span>
                </div>
                <div className="quickAmounts">
                  {quickAmounts.map((amount) => (
                    <button key={amount} onClick={() => onStakeChange(item.betId, item.stake + amount)}>+{amount}</button>
                  ))}
                  <button onClick={() => onStakeChange(item.betId, 5000)}>最大</button>
                </div>
              </article>
            ))
          )}
        </div>

        <footer className="betSummary">
          <div>
            <span>{mode === 'parlay' ? '总赔率' : '综合赔率'}</span>
            <b className="num">{items.length ? oddsText(totalOdds) : '—'}</b>
          </div>
          <div>
            <span>总投注金额</span>
            <b className="num">¥ {money(totalStake)}</b>
          </div>
          <div>
            <span>预计可赢</span>
            <b className="num win">¥ {money(estimatedReturn)}</b>
          </div>
          <button className="primaryButton" disabled={submitDisabled} onClick={onSubmit}>去投注</button>
        </footer>
      </section>
    </div>
  );
}
