// つなぎ直し（design-client §5.2、§7.9）。

import type { CloseCode } from '@chofugo/server/protocol';

/** つなぎ直すまでの間隔。1秒、2秒、4秒、以後8秒。attempt は 0 から。 */
export function backoffMs(attempt: number): number {
  return Math.min(8000, 1000 * 2 ** Math.max(0, Math.min(attempt, 3)));
}

/** 閉じられたあとの扱い。コードで決める（理由の文字列は見ない）。 */
export type CloseOutcome =
  | { kind: 'retry' }
  | { kind: 'replaced' } // 同じ席が別の画面で開かれた
  | { kind: 'closed' } // ルームが閉じられた
  | { kind: 'cannotJoin' }; // 入れる席がない・途中参加できない

const REPLACED: CloseCode = 4001;
const CANNOT_JOIN: CloseCode = 4002;
const ROOM_CLOSED: CloseCode = 4003;

export function closeOutcome(code: number): CloseOutcome {
  if (code === REPLACED) return { kind: 'replaced' };
  if (code === ROOM_CLOSED) return { kind: 'closed' };
  if (code === CANNOT_JOIN) return { kind: 'cannotJoin' };
  return { kind: 'retry' };
}

/** 一度もつながらないまま、この回数続けて失敗したら諦めて知らせる。 */
export const GIVE_UP_AFTER = 3;

/** 何も届かなければ接続を捨てる時間（pong を含む）。 */
export const SILENCE_MS = 15_000;

/** ping を送る間隔。 */
export const PING_MS = 5_000;

/** 失敗が続いたときに諦めるか。一度でもつながったことがあれば諦めない。 */
export function shouldGiveUp(everConnected: boolean, failuresInARow: number): boolean {
  return !everConnected && failuresInARow >= GIVE_UP_AFTER;
}
