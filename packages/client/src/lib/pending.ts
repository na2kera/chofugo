// 送信中の扱い（design-client §7.1）。
// 返事を待つ間はそのボタンを押せなくする。待ちを解くのは次の4つのどれか。
//  (a) 次の state が届いた  (b) 同じ reqId の error が届いた  (c) 接続が切れた  (d) 3秒たっても何も届かない

export const PENDING_TIMEOUT_MS = 3000;

export type Pending = { reqId: number; what: string; sentAt: number } | null;

export type PendingSignal =
  | { type: 'state' }
  | { type: 'error'; reqId: number | null }
  | { type: 'disconnected' }
  | { type: 'tick'; now: number };

export function pendingAfter(p: Pending, sig: PendingSignal): Pending {
  if (p === null) return null;
  switch (sig.type) {
    case 'state':
    case 'disconnected':
      return null;
    case 'error':
      return sig.reqId === p.reqId ? null : p;
    case 'tick':
      return sig.now - p.sentAt >= PENDING_TIMEOUT_MS ? null : p;
  }
}

/** reqId を振る（0 以上 2^31 未満）。 */
export function nextReqId(prev: number): number {
  return prev >= 2 ** 31 - 2 ? 1 : prev + 1;
}
