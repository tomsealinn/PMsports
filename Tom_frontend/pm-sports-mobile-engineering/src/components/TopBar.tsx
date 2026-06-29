import { CrownIcon, SettingsIcon, TicketIcon } from './Icons';

interface TopBarProps {
  onSettings: () => void;
  onMyBets: () => void;
  onConnection: () => void;
}

export function TopBar({ onSettings, onMyBets, onConnection }: TopBarProps) {
  return (
    <header className="topbar">
      <button className="brand" aria-label="PM体育首页">
        <span className="brandIcon">
          <CrownIcon />
        </span>
        <span className="brandName">PM体育</span>
      </button>

      <button className="wsPill" onClick={onConnection} aria-label="连接状态">
        <span className="wsDot" />
        <span className="num">WS · 0s</span>
      </button>

      <button className="iconBtn" onClick={onSettings} aria-label="设置">
        <SettingsIcon />
      </button>

      <button className="walletBtn" onClick={onMyBets} aria-label="账户和注单">
        <span className="avatar">D</span>
        <span className="walletText">
          <small>dmac001</small>
          <b className="num">¥91,510.00</b>
        </span>
      </button>

      <button className="tinyTicket" onClick={onMyBets} aria-label="我的注单">
        <TicketIcon />
      </button>
    </header>
  );
}
