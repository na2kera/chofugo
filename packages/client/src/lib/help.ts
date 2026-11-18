// ルールの説明「？」の判断（design-5）。画面の部品から判断を分けて、関数のテストで確かめる。
// 一覧の並びと「使う・使わない」、見本のコマの進め方、見本の枠の大きさ、見本のデータの検査、「あなたの番です」を出す条件。

import { ALL_ABILITY_IDS, cardOf, type AbilityId, type MyAwaiting, type RuleId } from '@chofugo/engine';
import type { GameMode } from '@chofugo/server/protocol';
import { ABILITY_TEXT } from '../abilities-text.ts';
import { ABILITY_DEMOS, RULE_DEMOS, type RuleDemoData } from '../rule-demos.ts';
import { ADVANCED_RULE_ORDER, LOBBY_RULE_ORDER, RULES_TEXT, SPECIAL_RULE_ORDER } from '../rules-text.ts';

// ---------- 一覧 ----------

/** 説明を開く項目。革命はルールにも特権にもあるので、種類で分ける。 */
export type HelpItem = { kind: 'rule'; id: RuleId } | { kind: 'ability'; id: AbilityId };

export type HelpEntry = { item: HelpItem; name: string; used: boolean };
export type HelpSection = { title: string; entries: HelpEntry[] };

/**
 * 一覧の見出しと並び（§3.1）。並び順はロビーと同じ、特権は ALL_ABILITY_IDS の順。
 * used：この試合（ロビーではいまの設定）で使うか。ルールは設定に入っているか、特権は超富豪モードのときだけ。
 */
export function helpSections(mode: GameMode, rules: readonly RuleId[]): HelpSection[] {
  const ruleEntries = (order: readonly RuleId[]): HelpEntry[] =>
    order.map((id) => ({ item: { kind: 'rule', id }, name: RULES_TEXT[id].name, used: rules.includes(id) }));
  return [
    { title: '定番', entries: ruleEntries(LOBBY_RULE_ORDER) },
    { title: '応用', entries: ruleEntries(ADVANCED_RULE_ORDER) },
    { title: '特殊', entries: ruleEntries(SPECIAL_RULE_ORDER) },
    {
      title: '特権',
      entries: ALL_ABILITY_IDS.map((id) => ({ item: { kind: 'ability', id }, name: ABILITY_TEXT[id].name, used: mode === 'chofugo' })),
    },
  ];
}

export function helpItemKey(item: HelpItem): string {
  return `${item.kind}:${item.id}`;
}

/** 名前と説明の文（いまの rules-text・abilities-text の文をそのまま使う）。 */
export function helpText(item: HelpItem): { name: string; text: string } {
  return item.kind === 'rule' ? RULES_TEXT[item.id] : ABILITY_TEXT[item.id];
}

/** その項目の見本。まだ作っていなければ null（名前と説明の文だけを出す）。 */
export function demoOf(item: HelpItem): RuleDemoData | null {
  return (item.kind === 'rule' ? RULE_DEMOS[item.id] : ABILITY_DEMOS[item.id]) ?? null;
}

// ---------- 「あなたの番です」 ----------

/** 説明を開いている間に、自分の操作の番か（手番・返し・選択・交換・特権の選択。§6.4）。 */
export function showYourTurn(mine: MyAwaiting | null | undefined): boolean {
  if (mine === null || mine === undefined) return false;
  switch (mine.kind) {
    case 'turn':
    case 'respond':
    case 'choice':
    case 'exchangeGive':
    case 'abilitySelect':
      return true;
  }
}

// ---------- コマの進め方（§6.6） ----------

export const FRAME_MS = 1400;
export const LAST_FRAME_MS = 2200;

/** そのコマを出しておく時間。最後のコマだけ長い。 */
export function frameDuration(frame: number, count: number): number {
  return frame >= count - 1 ? LAST_FRAME_MS : FRAME_MS;
}

/** 次のコマ（最後のあとは最初へ）。 */
export function nextFrame(frame: number, count: number): number {
  return count <= 0 ? 0 : (frame + 1) % count;
}

/** いまのコマと、そのコマになった時刻。 */
export type DemoClock = { frame: number; since: number };

/** 次のコマへ進める（自動でも、押したときでも）。進めた時刻から数え直す。 */
export function advanceDemo(clock: DemoClock, count: number, now: number): DemoClock {
  return { frame: nextFrame(clock.frame, count), since: now };
}

/** 次に自動で進む時刻。 */
export function nextAdvanceAt(clock: DemoClock, count: number): number {
  return clock.since + frameDuration(clock.frame, count);
}

/** 見本ページの frame=（1から数える）を、コマの番号（0から）に直す。範囲の外は端に寄せる。読めなければ null。 */
export function parseFixedFrame(raw: string | null, count: number): number | null {
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  return Math.min(Math.max(n, 1), Math.max(count, 1)) - 1;
}

// ---------- 見本の枠の大きさ（§6.5） ----------

/** 見本の枠にいつも空けておく場所：札の行があるか、行をいくつ空けるか。どのコマでも同じ高さにするため。 */
export function demoShape(data: RuleDemoData): { badges: boolean; rows: number } {
  return {
    badges: data.some((f) => (f.badges?.length ?? 0) > 0),
    rows: Math.max(0, ...data.map((f) => f.rows?.length ?? 0)),
  };
}

// ---------- 見本のデータの検査（§5、§6.2） ----------

export const NOTE_MAX = 16;
export const FIELD_MAX = 4;
export const ROWS_MAX = 2;
export const ROW_CARDS_MAX = 4;

/** 見本のデータの誤り（なければ空）。コマの数、枚数、行の数、説明の長さ、カードの ID、同じコマの中の重なり。 */
export function demoProblems(data: RuleDemoData): string[] {
  const out: string[] = [];
  if (data.length < 2 || data.length > 4) out.push(`コマの数が ${data.length}`);
  data.forEach((f, i) => {
    const at = `${i + 1}コマ目`;
    if (f.field.length > FIELD_MAX) out.push(`${at}：場が ${f.field.length}枚`);
    const rows = f.rows ?? [];
    if (rows.length > ROWS_MAX) out.push(`${at}：行が ${rows.length}つ`);
    // 説明の長さは文字（コードポイント）で数える。半角も1文字に数える（厳しいほうに寄せる）
    const len = [...f.note].length;
    if (len === 0) out.push(`${at}：説明がない`);
    if (len > NOTE_MAX) out.push(`${at}：説明が ${len}文字`);
    const seen = new Set<string>();
    const check = (id: string) => {
      if (cardOf(id) === null) out.push(`${at}：知らないカード ${id}`);
      if (seen.has(id)) out.push(`${at}：${id} が2回`);
      seen.add(id);
    };
    f.field.forEach(check);
    for (const r of rows) {
      if (r.label === '') out.push(`${at}：行の見出しがない`);
      if (r.cards.length > ROW_CARDS_MAX) out.push(`${at}：「${r.label}」が ${r.cards.length}枚`);
      for (const c of r.cards) if (c !== 'back') check(c);
      for (const m of r.mark ?? []) if (!r.cards.includes(m)) out.push(`${at}：「${r.label}」にない ${m} を強調`);
    }
  });
  return out;
}
