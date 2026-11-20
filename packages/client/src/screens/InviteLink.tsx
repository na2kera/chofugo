// 招待リンクと「コピー」ボタン（ロビーでは右隣に「QR」も）。

import { useEffect, useRef, useState } from 'react';
import s from './InviteLink.module.css';

export function inviteUrl(roomId: string): string {
  try {
    return `${location.origin}/r/${roomId}`;
  } catch {
    return `/r/${roomId}`;
  }
}

type Props = {
  roomId: string;
  /** 渡されたときだけ「コピー」の右隣に「QR」を出す（ロビーだけ。対戦中のメニューは渡さない）。 */
  onShowQr?: () => void;
};

export function InviteLink({ roomId, onShowQr }: Props) {
  const url = inviteUrl(roomId);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const done = () => {
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      done();
    } catch {
      // 使えないときは文字を選んだ状態にする（長押しでコピーできる）
      const el = codeRef.current;
      const sel = window.getSelection();
      if (el && sel) {
        const r = document.createRange();
        r.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }
  };
  return (
    <div className={s.link}>
      <code ref={codeRef} className={s.code}>
        {url.replace(/^https?:\/\//, '')}
      </code>
      <button type="button" className={s.btn} onClick={copy} aria-label="招待リンクをコピー">
        <span className={`f btn2 ${s.face}`}>{copied ? 'コピー済' : 'コピー'}</span>
      </button>
      {onShowQr !== undefined && (
        <button type="button" className={s.btn} onClick={onShowQr} aria-label="招待の QR コードを出す">
          <span className={`f btn2 ${s.face} ${s.qrFace}`}>QR</span>
        </button>
      )}
    </div>
  );
}
