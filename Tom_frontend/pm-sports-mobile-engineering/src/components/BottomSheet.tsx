import type { ReactNode } from 'react';
import { CloseIcon } from './Icons';

interface BottomSheetProps {
  open: boolean;
  title: string;
  children: ReactNode;
  right?: ReactNode;
  tall?: boolean;
  onClose: () => void;
}

export function BottomSheet({ open, title, children, right, tall, onClose }: BottomSheetProps) {
  return (
    <div className={`sheetLayer ${open ? 'show' : ''}`} aria-hidden={!open}>
      <button className="sheetMask" onClick={onClose} aria-label="关闭弹层" />
      <section className={`bottomSheet ${tall ? 'tall' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="grabber" />
        <header className="sheetHeader">
          <h2>{title}</h2>
          <div className="sheetHeaderRight">
            {right}
            <button className="sheetClose" onClick={onClose} aria-label="关闭">
              <CloseIcon />
            </button>
          </div>
        </header>
        {children}
      </section>
    </div>
  );
}
