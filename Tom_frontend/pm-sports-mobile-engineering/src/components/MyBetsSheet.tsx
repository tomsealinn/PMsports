import type { BetRecord } from '../types';
import { money, oddsText } from '../utils/calc';
import { BackIcon } from './Icons';

interface MyBetsSheetProps {
  open: boolean;
  records: BetRecord[];
  onClose: () => void;
}

export function MyBetsSheet({ open, records, onClose }: MyBetsSheetProps) {
  const totalStake = records.reduce((sum, record) => sum + record.stake, 0);

  return (
    <section className={`fullSheet ${open ? 'show' : ''}`} aria-hidden={!open} role="dialog" aria-modal="true" aria-label="我的注单">
      <header className="fullSheetTop">
        <button className="backBtn" onClick={onClose} aria-label="关闭我的注单"><BackIcon /></button>
        <h2>我的注单</h2>
        <button className="ghostText" onClick={onClose}>关闭</button>
      </header>
      <div className="myBetsBody">
        <div className="summaryCards">
          <div><span>注单数</span><b className="num">{records.length}</b></div>
          <div><span>投注总额</span><b className="num">¥ {money(totalStake)}</b></div>
          <div><span>已结算盈亏</span><b className="num">+¥ 0.00</b></div>
        </div>
        <div className="filterChips wrap">
          {['全部', '今日', '本周', '本月'].map((chip, index) => <button key={chip} className={index === 0 ? 'active' : ''}>{chip}</button>)}
          {['进行中', '赢', '输', '退款 / 取消'].map((chip, index) => <button key={chip} className={index === 0 ? 'active soft' : ''}>{chip}</button>)}
          {['单关', '串关'].map((chip) => <button key={chip}>{chip}</button>)}
        </div>
        <div className="recordList">
          {records.map((record) => (
            <article className="recordCard" key={record.id}>
              <div className="recordMain">
                <div>
                  <div className="tagRow">
                    {record.tags.map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                  <b>{record.matchName}</b>
                  <p>{record.leagueName}</p>
                  <small>{record.placedAt}</small>
                </div>
                <div className="recordMoney">
                  <strong className="num">@ {oddsText(record.odds)}</strong>
                  <span className="num">¥ {money(record.stake)} → ¥ {money(record.returnAmount)}</span>
                  <em className={record.status === '进行中' ? 'running' : ''}>{record.status}</em>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
