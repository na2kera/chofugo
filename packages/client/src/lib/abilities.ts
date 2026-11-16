// 特権の画面の決まり（design-3 §4.2〜§4.4、§6.1〜§6.3）。判定はしない。サーバーから届いた view だけを使う。

import { ALL_ABILITY_IDS, RANKS, type AbilityId, type CardId, type LegalPlay, type MyAwaiting, type Rank } from '@chofugo/engine';
import { cardShort } from './cards.ts';

type TurnMine = Extract<MyAwaiting, { kind: 'turn' }>;
type SelectMine = Extract<MyAwaiting, { kind: 'abilitySelect' }>;

// ---------- 特権の選択（§4.2、§6.2） ----------

/**
 * 特権の行を押したときに送る draft。表示はサーバーに保存された draft だけなので、画面の側では選択を変えない。
 * 選んでいれば外し、枠が残っていれば足す。枠がいっぱいで選んでいない行は null（送らない）。並びは ALL_ABILITY_IDS の順。
 */
export function toggleDraft(mine: Pick<SelectMine, 'draft' | 'slots'>, id: AbilityId): AbilityId[] | null {
  if (mine.draft.includes(id)) return mine.draft.filter((x) => x !== id);
  if (mine.draft.length >= mine.slots) return null;
  return ALL_ABILITY_IDS.filter((x) => x === id || mine.draft.includes(x));
}

/** 特権の行の見え方。sel = 選んでいる、full = 枠がいっぱいで選べない。 */
export function draftRowState(mine: Pick<SelectMine, 'draft' | 'slots'>, id: AbilityId): 'sel' | 'normal' | 'full' {
  if (mine.draft.includes(id)) return 'sel';
  return mine.draft.length >= mine.slots ? 'full' : 'normal';
}

/** 選ぶ人のメッセージ。 */
export function selectPrompt(slots: number): string {
  return `特権を ${slots}個 選べます`;
}

/** ほかの人のメッセージ。 */
export function selectingLine(name: string, slots: number): string {
  return `${name} が 特権を選んでいます（${slots}個）`;
}

// ---------- 対戦中の特権のボタン（§4.3） ----------

export type AbilityButton = { id: AbilityId; usable: boolean };

/**
 * 手番の特権のボタンの並び。自分の番で、未使用の特権があるときだけ中身がある（空なら並びを出さない）。
 * スキップ以外は UsableAbility の順（ALL_ABILITY_IDS の順）。スキップは最後（ALL_ABILITY_IDS でも最後）。
 */
export function abilityButtons(mine: MyAwaiting | null): AbilityButton[] {
  if (mine === null || mine.kind !== 'turn') return [];
  const out: AbilityButton[] = mine.abilities.map((u) => ({ id: u.id, usable: u.usable }));
  if (mine.skipAvailable) out.push({ id: 'skip', usable: true });
  return out;
}

/** 開いている選択の枠の種類（スキップは枠を開かず、押すたびに ON/OFF）。 */
export type AbilityPanel = Exclude<AbilityId, 'skip'>;

export function usableOf(mine: TurnMine, id: AbilityId) {
  return mine.abilities.find((u) => u.id === id) ?? null;
}

/** 選択の枠の問いかけ。 */
export const PANEL_PROMPT: Record<AbilityPanel, string> = {
  peek: '誰の手札を見ますか？',
  // 幅の狭い画面で語の途中で折り返さないよう、読点のあとで改行する（white-space: pre-line）
  steal: '渡すカードを1枚選んで、\n相手を選んでください',
  ban: '出せなくする数字',
  revolution: '革命を使いますか？',
  forceFlush: '強制流しを使いますか？',
};

// ---------- 強奪のカード選び（§6.3） ----------

/** 強奪の枠を開いている間の手札の押し方。渡せるカードから1枚だけ。もう一度押すと外れる。渡せないカードは null（変えない）。 */
export function toggleStealCard(cards: readonly CardId[], selected: CardId | null, id: CardId): CardId | null | undefined {
  if (selected === id) return null;
  if (!cards.includes(id)) return undefined;
  return id;
}

// ---------- 独裁の数字（§4.3） ----------

/** 独裁の数字のボタン（3〜2 の13個）。指定できない数字は usable: false。 */
export function banButtons(ranks: readonly Rank[] | undefined): { rank: Rank; usable: boolean }[] {
  return RANKS.map((rank) => ({ rank, usable: (ranks ?? []).includes(rank) }));
}

// ---------- スキップ（§4.3） ----------

export const CANNOT_SKIP_TEXT = 'この手には スキップを付けられません';

/** 「出す」で送る手。スキップを ON にしていて、その手に canSkip がなければ送らずに理由を出す。 */
export function playWithSkip(play: LegalPlay, skipOn: boolean): { ok: true; withSkip: boolean } | { ok: false; line: string } {
  if (!skipOn) return { ok: true, withSkip: false };
  if (play.canSkip !== true) return { ok: false, line: CANNOT_SKIP_TEXT };
  return { ok: true, withSkip: true };
}

// ---------- 表示（§4.4） ----------

/** 特権の残りの札（「特権 2」）。残りが1個以上のときだけ。 */
export function abilityPlate(remaining: number | null | undefined): string | null {
  return remaining === null || remaining === undefined || remaining < 1 ? null : `特権 ${remaining}`;
}

/** 透視で見たカードの表記（カード単位で折り返すので、1枚ずつ返す）。 */
export function peekLabels(cards: readonly CardId[]): string[] {
  return cards.map((c) => cardShort(c));
}
