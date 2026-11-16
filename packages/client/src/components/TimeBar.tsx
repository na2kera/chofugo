// 残り時間のバー（design-client §7.6）。区切った点の列で、残りに応じて金色に灯る。
// 0 になっても画面の側では何もしない（サーバーから届く状態を待つ）。

import type { DeadlineView } from '@chofugo/server/protocol';
import { barSegments, remainingMs, secondsToShow } from '../lib/timer.ts';
import { useNow } from './hooks.ts';
import s from './TimeBar.module.css';

type Props = {
  deadline: DeadlineView;
  offset: number;
  /** 自分が待たれている（残り10秒以下で秒数を出す）。 */
  mine?: boolean;
  segments?: number;
  small?: boolean;
  /** 固定の時刻で描く（見本ページ用）。 */
  fixedNow?: number;
};

export function TimeBar({ deadline, offset, mine = false, segments = 15, small = false, fixedNow }: Props) {
  const ticking = fixedNow === undefined && deadline.at !== null;
  const live = useNow(250, ticking);
  const now = fixedNow ?? live;
  const rem = remainingMs(deadline, offset, now);
  const on = barSegments(rem, deadline.kind, segments);
  const sec = secondsToShow(rem, mine);
  return (
    <div className={`${s.wrap} ${small ? s.small : ''}`} role="timer" aria-label={`残り${Math.ceil(rem / 1000)}秒`}>
      <div className={s.bar}>
        {Array.from({ length: segments }, (_, i) => (
          <i key={i} className={i < on ? s.on : undefined} />
        ))}
      </div>
      {sec !== null && <span className={s.sec}>{sec}</span>}
    </div>
  );
}
