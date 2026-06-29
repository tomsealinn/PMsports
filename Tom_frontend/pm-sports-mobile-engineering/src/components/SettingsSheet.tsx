import { BottomSheet } from './BottomSheet';

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsSheet({ open, onClose }: SettingsSheetProps) {
  return (
    <BottomSheet open={open} title="设置" onClose={onClose}>
      <div className="settingsList">
        <button className="settingsRow">
          <span>赔率格式</span>
          <b>欧洲盘</b>
        </button>
        <button className="settingsRow">
          <span>赛事排序</span>
          <b>按时间</b>
        </button>
        <button className="settingsRow">
          <span>盘口显示</span>
          <b>标准</b>
        </button>
        <button className="settingsRow">
          <span>声音提醒</span>
          <i className="switch on" />
        </button>
        <button className="settingsRow">
          <span>震动反馈</span>
          <i className="switch on" />
        </button>
        <button className="settingsRow">
          <span>接受赔率变化</span>
          <b>接受更高赔率</b>
        </button>
      </div>
    </BottomSheet>
  );
}
