// 受け取ったメッセージの検査（design §4.5）。形・長さ・値の範囲をすべて確かめ、知らないキーも拒否する。
// 例外は投げない。

import { ALL_RULE_IDS, cardOf, type GameCount, type RuleId } from '@chofugo/engine';
import type { ClientAction, ClientMessage, GameMode } from './protocol.ts';

/** 受け付けるメッセージの最大の長さ（文字数。UTF-16 の単位）。54枚の ID を並べても 1KB 程度。 */
export const MAX_MESSAGE_LENGTH = 4096;
/** selectAbilities の abilities の最大の個数（特権は6種）。 */
const MAX_ABILITIES = 6;
/** 名前の最大文字数（コードポイント）。 */
export const MAX_NAME_LENGTH = 12;

export type ParseResult =
  | { ok: true; msg: ClientMessage }
  | { ok: false; code: 'tooLarge' | 'badMessage'; message: string; reqId: number | null };

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function onlyKeys(o: Obj, allowed: readonly string[]): boolean {
  return Object.keys(o).every((k) => allowed.includes(k));
}

function isReqId(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 2 ** 31;
}

function isAwaitId(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v < 2 ** 31;
}

/** 知っているカード ID の重複のない列（1〜max 枚。min=0 なら空も可）。 */
function isCardIds(v: unknown, min: number, max: number): v is string[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) return false;
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x !== 'string' || x.length > 16 || cardOf(x) === null || seen.has(x)) return false;
    seen.add(x);
  }
  return true;
}

/** 席の番号（0〜3 の整数）。 */
function isSeatNo(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3;
}

/** Q ボンバーで宣言できる数字の最大の個数（3〜15 の13個と 'joker'）。 */
const MAX_CALL_RANKS = 14;

/**
 * Q ボンバーの宣言の形（design-4 §3）：長さ14以下の穴のない配列で、各要素は 3〜15 の整数か 'joker'。
 * 重複と個数の上限（出した枚数）は engine が確かめる。
 */
function parseCallRanks(v: unknown): (number | 'joker')[] | null {
  if (!Array.isArray(v) || v.length > MAX_CALL_RANKS) return null;
  const out: (number | 'joker')[] = [];
  // 穴のある配列は for...of で undefined になり、下の検査で落ちる
  for (const x of v) {
    if (x === 'joker') out.push(x);
    else if (typeof x === 'number' && Number.isInteger(x) && x >= 3 && x <= 15) out.push(x);
    else return null;
  }
  return out;
}

const TOKEN_RE =/^[A-Za-z0-9_-]{22,64}$/;
const MATCH_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

function isMatchId(v: unknown): v is string {
  return typeof v === 'string' && MATCH_ID_RE.test(v);
}
// 制御文字・書式文字・行区切り・段落区切り・私用領域・サロゲートの片割れを拒否する
const BAD_NAME_CHAR = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/u;

/** 名前を整える。前後の空白を除き NFC にする。不正なら null。 */
export function normalizeName(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 64) return null;
  const s = v.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const len = [...s].length;
  if (len < 1 || len > MAX_NAME_LENGTH) return null;
  if (BAD_NAME_CHAR.test(s)) return null;
  return s;
}

function isGameCount(v: unknown): v is GameCount {
  return v === 5 || v === 10 || v === null;
}

function isGameMode(v: unknown): v is GameMode {
  return v === 'daifugo' || v === 'custom' || v === 'chofugo';
}

/**
 * ルール ID の列の形を確かめる（知っている ID、重複なし）。モードで選べるかどうかと前提は見ない
 * （それは形が正しい値の中身として、room.ts が直す。design-2 §3.1、§6.5）。
 */
function parseRules(v: unknown): RuleId[] | null {
  if (!Array.isArray(v) || v.length > ALL_RULE_IDS.length) return null;
  const out: RuleId[] = [];
  // 穴のある配列（new Array(1)）は for...of で undefined になり、下の検査で落ちる
  for (const r of v) {
    if (typeof r !== 'string') return null;
    const id = ALL_RULE_IDS.find((x) => x === r);
    if (id === undefined || out.includes(id)) return null;
    out.push(id);
  }
  return out;
}

function parseAction(v: unknown): ClientAction | null {
  if (!isObj(v)) return null;
  switch (v['type']) {
    case 'play': {
      if (!onlyKeys(v, ['type', 'awaitId', 'cards', 'shape', 'confirmFoul', 'withSkip'])) return null;
      if (!isAwaitId(v['awaitId']) || !isCardIds(v['cards'], 1, 54)) return null;
      const a: ClientAction = { type: 'play', awaitId: v['awaitId'], cards: v['cards'].slice() };
      if ('shape' in v) {
        if (v['shape'] !== 'group' && v['shape'] !== 'run') return null;
        a.shape = v['shape'];
      }
      if ('confirmFoul' in v) {
        if (typeof v['confirmFoul'] !== 'boolean') return null;
        a.confirmFoul = v['confirmFoul'];
      }
      if ('withSkip' in v) {
        if (typeof v['withSkip'] !== 'boolean') return null;
        a.withSkip = v['withSkip'];
      }
      return a;
    }
    case 'pass':
      if (!onlyKeys(v, ['type', 'awaitId']) || !isAwaitId(v['awaitId'])) return null;
      return { type: 'pass', awaitId: v['awaitId'] };
    case 'respond': {
      if (!onlyKeys(v, ['type', 'awaitId', 'cards']) || !isAwaitId(v['awaitId'])) return null;
      const cards = v['cards'];
      if (cards === null) return { type: 'respond', awaitId: v['awaitId'], cards: null };
      if (!isCardIds(cards, 1, 54)) return null;
      return { type: 'respond', awaitId: v['awaitId'], cards: cards.slice() };
    }
    case 'exchangeGive': {
      if (!onlyKeys(v, ['type', 'awaitId', 'cards']) || !isAwaitId(v['awaitId'])) return null;
      if (!isCardIds(v['cards'], 0, 54)) return null;
      return { type: 'exchangeGive', awaitId: v['awaitId'], cards: v['cards'].slice() };
    }
    case 'choose': {
      // cards は exchangeGive と同じ（design-2 §3.2）。第2段階で target（闇市の相手）と ranks（Q ボンバーの宣言）を足した
      // （design-4 §3）。どちらも省略できる。形だけを確かめ、中身（選べる相手か、枚数・個数が合うか）は engine が確かめる
      if (!onlyKeys(v, ['type', 'awaitId', 'cards', 'target', 'ranks']) || !isAwaitId(v['awaitId'])) return null;
      if (!isCardIds(v['cards'], 0, 54)) return null;
      const a: ClientAction = { type: 'choose', awaitId: v['awaitId'], cards: v['cards'].slice() };
      if ('target' in v) {
        if (!isSeatNo(v['target'])) return null;
        a.target = v['target'];
      }
      if ('ranks' in v) {
        const ranks = parseCallRanks(v['ranks']);
        if (ranks === null) return null;
        a.ranks = ranks;
      }
      return a;
    }
    // その3（design-3 §3.2）。形だけを確かめ、中身（持っているか、使えるか）は engine が確かめる
    case 'selectAbilities': {
      if (!onlyKeys(v, ['type', 'awaitId', 'abilities', 'confirm']) || !isAwaitId(v['awaitId'])) return null;
      const list = v['abilities'];
      if (!Array.isArray(list) || list.length > MAX_ABILITIES) return null;
      const abilities: string[] = [];
      // 穴のある配列は for...of で undefined になり、下の検査で落ちる
      for (const x of list) {
        if (typeof x !== 'string' || x.length > 32) return null;
        abilities.push(x);
      }
      if (typeof v['confirm'] !== 'boolean') return null;
      return { type: 'selectAbilities', awaitId: v['awaitId'], abilities, confirm: v['confirm'] };
    }
    case 'useAbility': {
      if (!onlyKeys(v, ['type', 'awaitId', 'ability', 'target', 'card', 'rank']) || !isAwaitId(v['awaitId'])) return null;
      const ability = v['ability'];
      if (typeof ability !== 'string' || ability.length > 32) return null;
      const a: ClientAction = { type: 'useAbility', awaitId: v['awaitId'], ability };
      if ('target' in v) {
        const t = v['target'];
        if (!isSeatNo(t)) return null;
        a.target = t;
      }
      if ('card' in v) {
        const c = v['card'];
        if (typeof c !== 'string' || c.length > 16 || cardOf(c) === null) return null;
        a.card = c;
      }
      if ('rank' in v) {
        const r = v['rank'];
        if (typeof r !== 'number' || !Number.isInteger(r) || r < 3 || r > 15) return null;
        a.rank = r;
      }
      return a;
    }
    default:
      return null;
  }
}

/** WebSocket で受け取った1件を検査する。 */
export function parseClientMessage(raw: string | ArrayBuffer): ParseResult {
  if (typeof raw !== 'string') return { ok: false, code: 'badMessage', message: 'binary messages are not accepted', reqId: null };
  if (raw.length > MAX_MESSAGE_LENGTH) return { ok: false, code: 'tooLarge', message: 'message too large', reqId: null };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'badMessage', message: 'not JSON', reqId: null };
  }
  if (!isObj(v)) return { ok: false, code: 'badMessage', message: 'message must be an object', reqId: null };
  const reqIdRaw = v['reqId'];
  if (reqIdRaw !== undefined && !isReqId(reqIdRaw)) {
    return { ok: false, code: 'badMessage', message: 'reqId must be an integer in [0, 2^31)', reqId: null };
  }
  const reqId = reqIdRaw === undefined ? null : reqIdRaw;
  const bad = (message: string): ParseResult => ({ ok: false, code: 'badMessage', message, reqId });
  const withReq = <T extends ClientMessage>(m: T): ParseResult => {
    if (reqId !== null) m.reqId = reqId;
    return { ok: true, msg: m };
  };
  switch (v['type']) {
    case 'hello': {
      if (!onlyKeys(v, ['type', 'token', 'name', 'reqId'])) return bad('unknown keys in hello');
      const token = v['token'];
      if (typeof token !== 'string' || !TOKEN_RE.test(token)) return bad('token must be 22-64 chars of [A-Za-z0-9_-]');
      const name = normalizeName(v['name']);
      if (name === null) return bad(`name must be 1-${MAX_NAME_LENGTH} characters without control characters`);
      return withReq({ type: 'hello', token, name });
    }
    case 'setConfig': {
      if (!onlyKeys(v, ['type', 'mode', 'rules', 'gameCount', 'reqId'])) return bad('unknown keys in setConfig');
      const mode = v['mode'];
      if (!isGameMode(mode)) return bad('mode must be "daifugo", "custom" or "chofugo"');
      const rules = parseRules(v['rules']);
      if (rules === null) return bad('rules must be a list of distinct rule ids');
      const gc = v['gameCount'];
      if (!isGameCount(gc)) return bad('gameCount must be 5, 10 or null');
      return withReq({ type: 'setConfig', mode, rules, gameCount: gc });
    }
    case 'action': {
      if (!onlyKeys(v, ['type', 'matchId', 'action', 'reqId'])) return bad('unknown keys in action');
      const matchId = v['matchId'];
      if (!isMatchId(matchId)) return bad('matchId is required');
      const action = parseAction(v['action']);
      if (action === null) return bad('malformed action');
      return withReq({ type: 'action', matchId, action });
    }
    case 'start':
      if (!onlyKeys(v, ['type', 'reqId'])) return bad('unknown keys in start');
      return withReq({ type: 'start' });
    case 'nextGame':
    case 'endMatch':
    case 'rematch': {
      const type = v['type'];
      if (!onlyKeys(v, ['type', 'matchId', 'reqId'])) return bad(`unknown keys in ${type}`);
      const matchId = v['matchId'];
      if (!isMatchId(matchId)) return bad('matchId is required');
      return withReq({ type, matchId });
    }
    default:
      return bad('unknown message type');
  }
}
