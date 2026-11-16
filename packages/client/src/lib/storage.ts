// ブラウザに保存する値（design-client §5.1、§7.2、§7.12）。
// localStorage が使えない環境（無効・容量切れ・プライベートモード）では、そのタブの間だけメモリに覚える。
// URL に ?p=1〜4 を付けると保存先を分ける（同じブラウザの4つのタブで4席を開く開発用の切り替え）。

const memory = new Map<string, string>();

function ls(): Storage | null {
  try {
    const s = globalThis.localStorage;
    if (s === undefined || s === null) return null;
    const k = '__chofugo_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

/** ?p= の値（1〜4）。なければ空文字。 */
export function profileSuffix(search: string): string {
  const m = /[?&]p=([1-4])(?:&|$)/.exec(search);
  return m === null ? '' : `.p${m[1]}`;
}

function currentSuffix(): string {
  try {
    return profileSuffix(globalThis.location?.search ?? '');
  } catch {
    return '';
  }
}

function key(name: string): string {
  return `chofugo.${name}${currentSuffix()}`;
}

export function readItem(name: string): string | null {
  const k = key(name);
  const s = ls();
  if (s !== null) {
    try {
      const v = s.getItem(k);
      if (v !== null) return v;
    } catch {
      // 読めなければメモリを見る
    }
  }
  return memory.get(k) ?? null;
}

export function writeItem(name: string, value: string): void {
  const k = key(name);
  memory.set(k, value);
  const s = ls();
  if (s === null) return;
  try {
    s.setItem(k, value);
  } catch {
    // 書けなくてもメモリには残っている
  }
}

/** 本人確認の値（128ビット以上の乱数、base64url で 22 文字以上）。初回に作って保存する。 */
export function getToken(): string {
  const old = readItem('token');
  if (old !== null && /^[A-Za-z0-9_-]{22,64}$/.test(old)) return old;
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  const t = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  writeItem('token', t);
  return t;
}

export function getSavedName(): string {
  return readItem('name') ?? '';
}

export function saveName(name: string): void {
  writeItem('name', name);
}

const ROOMS_KEEP = 20;

/** 前に参加したルームの一覧に足す（新しい順に20件）。 */
export function rememberRoom(roomId: string): void {
  const list = knownRooms().filter((x) => x !== roomId);
  list.unshift(roomId);
  writeItem('rooms', JSON.stringify(list.slice(0, ROOMS_KEEP)));
}

export function knownRooms(): string[] {
  const raw = readItem('rooms');
  if (raw === null) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, ROOMS_KEEP) : [];
  } catch {
    return [];
  }
}

export function isKnownRoom(roomId: string): boolean {
  return knownRooms().includes(roomId);
}
