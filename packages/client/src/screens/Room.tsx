// ルームの中の画面の切り替え（design-client §3、§4.8、§7.2、§7.3、§7.9）。
// 画面は届いた state で決まる。client が自分で次の画面を決めない。

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { RoomClient, type Snapshot } from '../net/RoomClient.ts';
import { GameResult, MatchResult } from './Results.tsx';
import { Lobby } from './Lobby.tsx';
import { Message, NameEntry } from './Simple.tsx';
import { Table } from './Table.tsx';
import type { RoomApi } from './types.ts';
import s from './Room.module.css';

const ROOM_ID_RE = /^[A-Za-z0-9_-]{22}$/;

export function RoomBody({ snap, api, fixedNow }: { snap: Snapshot; api: RoomApi; fixedNow?: number }) {
  const st = snap.state;
  const home = (
    <button type="button" className="f btn2" onClick={api.goHome}>
      ホームへ
    </button>
  );
  switch (snap.status) {
    case 'replaced':
      return <Message text="別の画面で開かれました">{home}</Message>;
    case 'closed':
      return <Message text="ルームが閉じられました">{home}</Message>;
    case 'cannotJoin':
      return <Message text={snap.joinError === 'cannotJoin' ? '試合の途中なので、いまは入れません' : '満員で入れません'}>{home}</Message>;
    case 'gaveUp':
      return (
        <Message text="ルームが見つからないか、つながりません">
          <button type="button" className="f btn" onClick={api.retry}>
            もう一度
          </button>
          {home}
        </Message>
      );
    default:
      break;
  }
  if (snap.joinStage === 'needName') {
    return (
      <NameEntry
        state={st}
        onJoin={api.join}
        joinError={snap.joinError === null ? null : snap.joinError === 'roomFull' ? '満員で入れません' : '試合の途中なので、いまは入れません'}
      />
    );
  }
  if (st === null || st.seat === null || (st.view === null && st.matchPhase !== null)) return <Message text="接続中…" />;
  const props = { state: st, snap, api, ...(fixedNow !== undefined ? { fixedNow } : {}) };
  switch (st.matchPhase) {
    case null:
      return <Lobby {...props} />;
    case 'exchange':
    case 'play':
      return <Table {...props} />;
    case 'gameResult':
      return <GameResult {...props} finalGame={false} />;
    case 'matchResult':
      return st.matchId !== null && snap.gameResultFirst.has(st.matchId) ? <GameResult {...props} finalGame /> : <MatchResult {...props} />;
  }
}

export function Banner({ snap }: { snap: Snapshot }) {
  let text: string | null = null;
  if (snap.status === 'reconnecting' && snap.joinStage === 'joined') text = 'つなぎ直しています…';
  // 一時停止の帯は、自分が参加したあとの、試合が始まっている間だけ（§7.13）
  else if (snap.joinStage === 'joined' && snap.state?.room.paused && snap.state.matchPhase !== null) text = '一時停止中';
  if (text === null) return null;
  return (
    <div className={`f red redt ${s.banner}`} role="alert">
      {text}
    </div>
  );
}

function wsUrlFor(roomId: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/api/rooms/${roomId}/ws`;
}

export function Room({ roomId, goHome }: { roomId: string; goHome: () => void }) {
  const valid = ROOM_ID_RE.test(roomId);
  const client = useMemo(() => new RoomClient(roomId, wsUrlFor(roomId)), [roomId]);
  useEffect(() => {
    if (!valid) return;
    client.start();
    return () => client.dispose();
  }, [client, valid]);
  const snap = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const api: RoomApi = useMemo(
    () => ({
      send: (m, w) => client.send(m, w),
      sendAction: (a, w) => client.sendAction(a, w),
      showLine: (t) => client.showLine(t),
      showMatchResult: (id) => client.showMatchResult(id),
      join: (n) => client.join(n),
      retry: () => client.retry(),
      goHome,
    }),
    [client, goHome],
  );
  if (!valid) {
    return (
      <Message text="ルームが見つからないか、つながりません">
        <button type="button" className="f btn2" onClick={goHome}>
          ホームへ
        </button>
      </Message>
    );
  }
  return (
    <>
      <RoomBody snap={snap} api={api} />
      <Banner snap={snap} />
    </>
  );
}
