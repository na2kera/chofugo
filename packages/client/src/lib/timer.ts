// 残り時間（design-client §5.2、§7.6）。
// サーバーの時刻（serverTime）と端末の時計のずれを補正して、期限（at）までの残りを出す。

import type { AwaitKind } from '@chofugo/engine';
import type { DeadlineView } from '@chofugo/server/protocol';

/** ずれの見積もり。受け取った時刻は通信の遅れの分だけ遅いので、最近の見積もりのうち最大を使う。 */
export class ClockSkew {
  private samples: number[] = [];
  constructor(private readonly keep = 5) {}

  /** serverTime と受け取った時刻（端末の時計）から1件足す。 */
  add(serverTime: number, receivedAt: number): void {
    this.samples.push(serverTime - receivedAt);
    if (this.samples.length > this.keep) this.samples.shift();
  }

  /** サーバーの時刻 − 端末の時刻（ミリ秒）。見積もりがなければ 0。 */
  get offset(): number {
    return this.samples.length === 0 ? 0 : Math.max(...this.samples);
  }
}

/** 期限までの残り（ミリ秒、0 未満にはしない）。一時停止中（at が null）は remainingMs を使う。 */
export function remainingMs(d: Pick<DeadlineView, 'at' | 'remainingMs'>, offset: number, now: number): number {
  if (d.at === null) return Math.max(0, d.remainingMs ?? 0);
  return Math.max(0, d.at - (now + offset));
}

/**
 * 待ちの種類ごとの持ち時間（decisions §8）。バーの長さの基準にだけ使う。
 * DeadlineView には持ち時間が含まれないので、画面の側で決めた値（client-assumptions B1）。
 */
export const FULL_MS: Record<AwaitKind, number> = {
  turn: 30_000,
  respond: 10_000,
  exchangeGive: 60_000,
};

/** バーの点灯数（0〜segments）。持ち時間より長い残り（復帰の付け直しなど）は満タンにする。 */
export function barSegments(remaining: number, kind: AwaitKind, segments: number): number {
  const full = FULL_MS[kind];
  const ratio = Math.min(1, Math.max(0, remaining / full));
  return Math.ceil(ratio * segments);
}

/** 秒数の数字を出すか（自分が待たれていて、残り10秒以下）。出す場合は切り上げた秒数。 */
export function secondsToShow(remaining: number, mine: boolean): number | null {
  if (!mine || remaining > 10_000) return null;
  return Math.ceil(remaining / 1000);
}
