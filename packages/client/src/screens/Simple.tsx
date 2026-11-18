// ホーム・名前の入力・接続中・入れない理由（design-client §4.1、§4.2、§3、§7.9）。

import { useState } from 'react';
import type { CreateRoomResponse, StateMessage } from '@chofugo/server/protocol';
import { Logo } from '../components/Logo.tsx';
import { TitleDeco } from '../components/TitleDeco.tsx';
import { NAME_MAX, nameError, normalizeName } from '../lib/names.ts';
import { getSavedName } from '../lib/storage.ts';
import s from './Simple.module.css';

export function Home({ go, initialError = null }: { go: (path: string) => void; initialError?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(initialError);
  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (r.status !== 201) throw new Error(String(r.status));
      const body = (await r.json()) as CreateRoomResponse;
      go(`/r/${body.roomId}`);
    } catch {
      setErr('ルームを作れませんでした。もう一度試してください');
      setBusy(false);
    }
  };
  return (
    <div className={s.page}>
      <div className={s.center}>
        <TitleDeco><Logo /></TitleDeco>
      </div>
      {err !== null && <p className={`redt ${s.line}`}>{err}</p>}
      <button type="button" className="f btn" disabled={busy} onClick={create}>
        ルームを作る
      </button>
    </div>
  );
}

/** 入れないときの理由（満員、試合の途中）。席のない state から分かる。 */
export function joinBlockReason(state: StateMessage | null): string | null {
  if (state === null) return null;
  const seats = state.room.seats;
  if (state.room.phase === 'lobby' || state.matchPhase === null) {
    return seats.some((x) => x.kind === 'empty') ? null : '満員で入れません';
  }
  if (state.matchPhase === 'gameResult' || state.matchPhase === 'matchResult') {
    return seats.some((x) => x.kind === 'cpu') ? null : '満員で入れません';
  }
  return '試合の途中なので、いまは入れません';
}

export function NameEntry({ state, onJoin, joinError }: { state: StateMessage | null; onJoin: (name: string) => void; joinError: string | null }) {
  const [name, setName] = useState(() => getSavedName());
  const [touched, setTouched] = useState(false);
  const block = joinError ?? joinBlockReason(state);
  const err = nameError(name);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (err !== null || block !== null) return;
    onJoin(normalizeName(name));
  };
  return (
    <form className={s.page} onSubmit={submit}>
      <div className={s.grow} />
      <label className={s.label} htmlFor="name">
        名前
      </label>
      <input
        id="name"
        className={`f win ${s.input}`}
        value={name}
        maxLength={NAME_MAX * 2}
        autoComplete="nickname"
        enterKeyHint="go"
        onChange={(e) => setName(e.target.value)}
      />
      <p className={`${s.line} ${block !== null || (touched && err !== null) ? 'redt' : ''}`}>{block ?? (touched ? err : null) ?? ''}</p>
      <div className={s.grow} />
      <button type="submit" className="f btn" disabled={block !== null || state === null}>
        参加する
      </button>
    </form>
  );
}

export function Message({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className={s.page}>
      <div className={s.grow} />
      <p className={s.msg} role="status">
        {text}
      </p>
      <div className={s.grow} />
      <div className={s.buttons}>{children}</div>
    </div>
  );
}
