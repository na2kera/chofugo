// 名前の確かめ方（サーバーと同じ数え方。server-assumptions C6）。
// NFC に正規化し、前後の空白を除いて連続する空白を1つにしたうえで、コードポイントで 1〜12 文字。

export const NAME_MAX = 12;

export function normalizeName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

export function codePointLength(s: string): number {
  return [...s].length;
}

// 制御文字・書式文字・私用領域・サロゲートの片割れ・行区切り・段落区切り
const BAD = /[\p{Cc}\p{Cf}\p{Co}\u2028\u2029]/u;

function hasLoneSurrogate(t: string): boolean {
  for (const ch of t) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0xd800 && c <= 0xdfff) return true;
  }
  return false;
}

export function nameError(raw: string): string | null {
  const n = normalizeName(raw);
  if (n.length === 0) return '名前を入れてください';
  if (codePointLength(n) > NAME_MAX) return `名前は${NAME_MAX}文字までです`;
  if (BAD.test(n) || hasLoneSurrogate(n)) return '使えない文字が入っています';
  return null;
}
