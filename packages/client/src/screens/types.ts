import type { ClientAction, ClientMessage, StateMessage } from '@chofugo/server/protocol';
import type { Snapshot } from '../net/RoomClient.ts';

/** 画面から呼ぶ操作。見本ページでは何もしないものを渡す。 */
export type RoomApi = {
  send(msg: ClientMessage, what: string): boolean;
  sendAction(action: ClientAction, what: string): boolean;
  showLine(text: string): void;
  showMatchResult(matchId: string): void;
  join(name: string): void;
  retry(): void;
  goHome(): void;
};

export type ScreenProps = {
  state: StateMessage;
  snap: Snapshot;
  api: RoomApi;
  /** 固定の時刻で描く（見本ページ用）。 */
  fixedNow?: number;
};

export const noopApi: RoomApi = {
  send: () => false,
  sendAction: () => false,
  showLine: () => {},
  showMatchResult: () => {},
  join: () => {},
  retry: () => {},
  goHome: () => {},
};
