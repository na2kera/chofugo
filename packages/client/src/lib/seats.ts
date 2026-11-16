// 席の並びと名前（design-client §4.5）。

import type { SeatId } from '@chofugo/engine';
import type { SeatInfo } from '@chofugo/server/protocol';

export function seatName(seats: readonly SeatInfo[], seat: SeatId, me: SeatId | null = null): string {
  if (me !== null && seat === me) return 'あなた';
  const s = seats.find((x) => x.seat === seat);
  if (s === undefined || s.name === null) return `席${seat + 1}`;
  return s.name;
}

/** 自分の次の人を左、その次を中央、その次を右に置く（手番が左から右へ進む）。 */
export function opponentOrder(me: SeatId): [SeatId, SeatId, SeatId] {
  return [((me + 1) % 4) as SeatId, ((me + 2) % 4) as SeatId, ((me + 3) % 4) as SeatId];
}

/** 相手の位置（0=左、1=中央、2=右）。自分なら null。 */
export function relativePos(me: SeatId, seat: SeatId): 0 | 1 | 2 | null {
  const d = (seat - me + 4) % 4;
  return d === 0 ? null : ((d - 1) as 0 | 1 | 2);
}
