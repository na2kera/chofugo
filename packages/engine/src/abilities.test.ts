// 超富豪モードの特権（decisions §5、§17、design-3 §2.8、§6.8）。
import { describe, expect, it } from 'vitest';
import {
  ALL_RULE_IDS,
  applyAction,
  awaiting,
  createMatch,
  eventsFor,
  legalPlays,
  viewFor,
  type AbilityId,
  type Action,
  type GameEvent,
  type MatchState,
  type RuleId,
  type SeatId,
} from './index.ts';
import { slotsForCount } from './abilities.ts';
import { deepClone } from './clone.ts';
import { Driver, cs, scene, type Setup } from './test/helpers.ts';

const SEATS: SeatId[] = [0, 1, 2, 3];

/** 席0が特権 chosen を持ち、席 turn が親の場面。 */
function sc(rules: RuleId[], hands: string[], chosen: AbilityId[], extra: Partial<Setup> = {}): Driver {
  return new Driver(scene({ rules, hands, turn: 0, abilities: { holder: 0, chosen }, ...extra }));
}

function fail(d: Driver, a: Action): string {
  const before = JSON.stringify(d.state);
  const r = d.try(a);
  expect(r.ok, JSON.stringify(a)).toBe(false);
  expect(JSON.stringify(d.state)).toBe(before); // 失敗した操作で状態（乱数も）を変えない
  return r.ok ? '' : r.error.code;
}

function use(d: Driver, ability: AbilityId, extra: Record<string, unknown> = {}): Action {
  const w = d.current();
  return { type: 'useAbility', seat: w.seat, awaitId: w.id, ability, ...extra } as Action;
}

/** いまのゲームが終わるまで CPU で進める。 */
function finishGame(d: Driver): void {
  for (let i = 0; i < 2000 && d.state.phase === 'play'; i++) d.auto('cpu');
  expect(d.state.phase).not.toBe('play');
}

// ---------- 枠 ----------

describe('特権の枠（§5.1、design-3 §2.2）', () => {
  it('閾値の境界: 14枚 → 1、15 → 2、24 → 2、25 → 3', () => {
    expect([0, 14, 15, 24, 25, 39].map(slotsForCount)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('初めての1位は1個。都落ちした前の大富豪には付かない', () => {
    const d = new Driver(
      scene({ rules: ['dethrone'], hands: ['S5', 'H6 H7', 'D8', 'C9 C10'], turn: 0, prevRanks: [2, 1, 3, 4], abilitiesConfig: true }),
    );
    d.play(0, 'S5');
    expect(d.places()).toEqual([1, 4, null, null]);
    d.play(2, 'D8');
    expect(d.state.phase).toBe('gameResult');
    expect(d.state.abilityGrant).toEqual({ seat: 0, slots: 1 });
  });

  it('特権なしの試合では枠を決めない', () => {
    const d = new Driver(scene({ rules: [], hands: ['S5', 'H6 H7', 'D8', 'C9 C10'], turn: 0, prevRanks: [1, 2, 3, 4] }));
    finishGame(d);
    expect(d.state.abilityGrant).toBeNull();
  });

  // 相手3人の残り手札の合計ごとの枠（連覇）
  const streak = (others: [string, string, string]) =>
    new Driver(scene({ rules: [], hands: ['S3', ...others], turn: 0, prevRanks: [1, 2, 3, 4], abilitiesConfig: true }));
  for (const [total, slots, hands] of [
    [14, 1, ['H4 H5 H6 H7 H8', 'D4 D5 D6 D7 D8', 'C4 C5 C6 C7']],
    [15, 2, ['H4 H5 H6 H7 H8', 'D4 D5 D6 D7 D8', 'C4 C5 C6 C7 C8']],
    [24, 2, ['H4 H5 H6 H7 H8 H9 H10 HJ', 'D4 D5 D6 D7 D8 D9 D10 DJ', 'C4 C5 C6 C7 C8 C9 C10 CJ']],
    [25, 3, ['H4 H5 H6 H7 H8 H9 H10 HJ HQ', 'D4 D5 D6 D7 D8 D9 D10 DJ', 'C4 C5 C6 C7 C8 C9 C10 CJ']],
  ] as const) {
    it(`連覇: 相手の残りが ${total} 枚なら ${slots} 個`, () => {
      const d = streak([...hands] as [string, string, string]);
      d.play(0, 'S3');
      expect(d.game.firstPlaceHandCounts).toEqual([0, ...hands.map((h) => h.split(' ').length)]);
      finishGame(d);
      expect(d.state.abilityGrant).toEqual({ seat: 0, slots });
    });
  }

  it('連覇の枚数は、7渡しのあとの枚数で数える', () => {
    // 席0が7を出して最後の1枚を渡して上がる。渡す前の相手の合計は14、渡したあとは15
    const d = new Driver(
      scene({
        rules: ['give_on_7'],
        hands: ['S7 S3', 'H4 H5 H6 H8 H9', 'D4 D5 D6 D8 D9', 'C4 C5 C6 C8'],
        turn: 0,
        prevRanks: [1, 2, 3, 4],
        abilitiesConfig: true,
      }),
    );
    d.play(0, 'S7');
    d.choose(0, 'S3');
    expect(d.game.firstPlaceHandCounts).toEqual([0, 6, 5, 4]);
    finishGame(d);
    expect(d.state.abilityGrant).toEqual({ seat: 0, slots: 2 });
  });

  it('持ち主が都落ちしたら、残りの個数は0', () => {
    const d = sc(['dethrone'], ['S9 S10', 'H3', 'D4 D5', 'C6 C7'], ['ban', 'revolution'], { turn: 1, prevRanks: [1, 2, 3, 4] });
    expect(viewFor(d.state, 2).game?.abilities).toEqual({ holder: 0, slots: 3, remaining: 2, selecting: false });
    d.play(1, 'H3');
    expect(d.places()?.[0]).toBe(4);
    expect(viewFor(d.state, 2).game?.abilities?.remaining).toBe(0);
  });
});

// ---------- 選択 ----------

/** 特権ありの試合を、2ゲーム目の特権の選択まで CPU で進める。 */
function toAbilityPhase(seed: [number, number, number, number] = [5, 6, 7, 8]): { s: MatchState; events: GameEvent[] } {
  const created = createMatch({ matchId: 'm', rules: [...ALL_RULE_IDS], gameCount: 5, abilities: true }, seed);
  if (!created.ok) throw new Error(created.error.message);
  let s = created.state;
  let events = created.events;
  for (let i = 0; i < 3000 && s.phase !== 'ability'; i++) {
    const a: Action = s.phase === 'gameResult' ? { type: 'nextGame' } : { type: 'auto', awaitId: awaiting(s)[0]!.id, policy: 'cpu' };
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(r.error.message);
    s = r.state;
    events = r.events;
  }
  expect(s.phase).toBe('ability');
  return { s, events };
}

describe('特権の選択（design-3 §2.3）', () => {
  it('交換のあとに選択のフェーズに入る。待ちが外から見え、途中の内容は同じ番号の待ちのまま保存される', () => {
    const { s, events } = toAbilityPhase();
    const g = s.game!;
    const holder = g.abilities!.holder;
    expect(s.prevRanks![holder]).toBe(1);
    expect(events.map((e) => e.type).slice(-2)).toEqual(['exchangeDone', 'abilitySelectStart']);
    expect(events.at(-1)).toMatchObject({ seat: holder, slots: 1 });
    const ws = awaiting(s);
    expect(ws).toEqual([{ id: ws[0]!.id, seat: holder, kind: 'abilitySelect', timer: 'ability' }]);
    expect(viewFor(s, holder).mine).toEqual({ awaitId: ws[0]!.id, kind: 'abilitySelect', slots: 1, draft: [] });
    const other = SEATS.find((x) => x !== holder)!;
    expect(viewFor(s, other).mine).toBeNull();
    expect(viewFor(s, other).awaiting).toEqual(ws);
    expect(viewFor(s, other).game?.abilities).toEqual({ holder, slots: 1, remaining: 1, selecting: true });
    expect(viewFor(s, other).game?.myAbilities).toBeNull();
    expect(legalPlays(s, holder)).toEqual([]);

    // 途中の保存: 出来事なし、待ちは同じ番号
    const r = applyAction(s, { type: 'selectAbilities', seat: holder, awaitId: ws[0]!.id, abilities: ['ban'], confirm: false });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.events).toEqual([]);
    expect(awaiting(r.state)).toEqual(ws);
    expect(viewFor(r.state, holder).mine).toMatchObject({ draft: ['ban'] });
    expect(viewFor(r.state, other).game?.myAbilities).toBeNull();
    // 時間切れ: 途中の内容で確定し、対戦が始まる
    const t = applyAction(r.state, { type: 'auto', awaitId: ws[0]!.id, policy: 'timeout' });
    if (!t.ok) throw new Error(t.error.message);
    expect(t.events[0]).toMatchObject({ type: 'abilitiesChosen', seat: holder, count: 1, abilities: ['ban'] });
    expect(t.state.phase).toBe('play');
    expect(awaiting(t.state)[0]).toMatchObject({ kind: 'turn', seat: t.state.game!.starter });
    expect(eventsFor(t.events, holder)[0]).toMatchObject({ abilities: ['ban'] });
    expect(eventsFor(t.events, other)[0]).toMatchObject({ type: 'abilitiesChosen', count: 1, abilities: null });
    expect(viewFor(t.state, holder).game?.myAbilities).toEqual({ chosen: ['ban'], used: [], draft: ['ban'] });
    expect(viewFor(t.state, other).game?.abilities).toEqual({ holder, slots: 1, remaining: 1, selecting: false });
  });

  it('時間切れで途中の内容がなければ、特権なしで確定する。CPU は選んで確定する', () => {
    const { s } = toAbilityPhase();
    const id = awaiting(s)[0]!.id;
    const t = applyAction(s, { type: 'auto', awaitId: id, policy: 'timeout' });
    if (!t.ok) throw new Error();
    expect(t.state.game!.abilities!.chosen).toEqual([]);
    expect(viewFor(t.state, 0).game?.abilities?.remaining).toBe(0);
    const c = applyAction(s, { type: 'auto', awaitId: id, policy: 'cpu' });
    if (!c.ok) throw new Error();
    expect(c.state.phase).toBe('play');
    expect(c.state.game!.abilities!.chosen).toHaveLength(1);
  });

  it('枠より多い・重複・知らない種類は invalidAbility。形の誤りは malformed。どれも状態を変えない', () => {
    const { s } = toAbilityPhase();
    const holder = s.game!.abilities!.holder;
    const id = awaiting(s)[0]!.id;
    const d = new Driver(s);
    const sel = (abilities: unknown, confirm: unknown = true) =>
      fail(d, { type: 'selectAbilities', seat: holder, awaitId: id, abilities, confirm } as unknown as Action);
    expect(sel(['ban', 'skip'])).toBe('invalidAbility');
    d.state.game!.abilities!.slots = 3;
    expect(sel(['ban', 'ban'])).toBe('invalidAbility');
    expect(sel(['ban', 'nope'])).toBe('invalidAbility');
    expect(sel(['ban', 'skip', 'peek', 'steal'])).toBe('invalidAbility');
    expect(sel('ban')).toBe('malformed');
    expect(sel(new Array(1))).toBe('malformed');
    expect(sel(['ban'], 'yes')).toBe('malformed');
    const other = SEATS.find((x) => x !== holder)!;
    expect(fail(d, { type: 'selectAbilities', seat: other, awaitId: id, abilities: [], confirm: true })).toBe('notYourAwait');
    expect(fail(d, { type: 'selectAbilities', seat: holder, awaitId: id + 99, abilities: [], confirm: true })).toBe('staleAwait');
    expect(fail(d, { type: 'play', seat: holder, awaitId: id, cards: [s.game!.hands[holder]![0]!] })).toBe('wrongAwaitKind');
    // 枠の数ちょうど・少なくても確定できる。並びは ALL_ABILITY_IDS の順
    d.apply({ type: 'selectAbilities', seat: holder, awaitId: id, abilities: ['skip', 'peek'], confirm: true });
    expect(d.game.abilities!.chosen).toEqual(['peek', 'skip']);
  });

  it('CPU は透視を選ばず、枠の数だけ選ぶ', () => {
    const { s } = toAbilityPhase();
    const id = awaiting(s)[0]!.id;
    for (let i = 0; i < 40; i++) {
      const t = deepClone(s);
      t.rng = [i + 1, 7, i * 31 + 3, 99];
      t.game!.abilities!.slots = (i % 3) + 1;
      const r = applyAction(t, { type: 'auto', awaitId: id, policy: 'cpu' });
      if (!r.ok) throw new Error();
      const chosen = r.state.game!.abilities!.chosen!;
      expect(chosen).toHaveLength((i % 3) + 1);
      expect(chosen).not.toContain('peek');
      expect(new Set(chosen).size).toBe(chosen.length);
    }
  });

  it('1ゲーム目には特権がない', () => {
    const created = createMatch({ matchId: 'm', rules: [...ALL_RULE_IDS], gameCount: 5, abilities: true }, [1, 2, 3, 4]);
    if (!created.ok) throw new Error();
    expect(created.state.phase).toBe('play');
    expect(created.state.game!.abilities).toBeNull();
    expect(created.state.config.abilities).toBe(true);
  });
});

// ---------- 使う操作の共通の決まり ----------

describe('特権を使う操作（design-3 §2.4、§6.1）', () => {
  it('同じ手番に続けて使える。使うたびに待ちの番号を付け直し、continues に元の番号を入れる。古い番号は拒否する', () => {
    const d = sc([], ['S5 S6 S9', 'H3 H4', 'D3 D4', 'C3 C4'], ['ban', 'revolution']);
    const w0 = d.current();
    expect(w0.continues).toBeUndefined();
    d.use(0, 'ban', { rank: 9 });
    const w1 = d.current();
    expect(w1).toEqual({ id: w0.id + 1, seat: 0, kind: 'turn', timer: 'turn', continues: w0.id });
    expect(fail(d, { type: 'play', seat: 0, awaitId: w0.id, cards: cs('S5') })).toBe('staleAwait');
    d.use(0, 'revolution');
    const w2 = d.current();
    expect(w2.continues).toBe(w1.id);
    // 1種類1回
    expect(fail(d, use(d, 'ban', { rank: 5 }))).toBe('invalidAbility');
    expect(fail(d, use(d, 'revolution'))).toBe('invalidAbility');
    // 手番を終えたことにしない
    expect(d.game.turnCount).toEqual([0, 0, 0, 0]);
    d.play(0, 'S5');
    expect(d.game.turnCount).toEqual([1, 0, 0, 0]);
    expect(viewFor(d.state, 1).game?.abilities?.remaining).toBe(0);
  });

  it('持っていない・選んでいない・スキップ・知らない種類は invalidAbility。手番でない・返しの一周・7渡しの選択の間は使えない', () => {
    const d = sc(['give_on_7', 'spade3_beats_joker'], ['S7 S5 S6 X0', 'H3 H4', 'S3 D4', 'C3 C4'], ['ban', 'skip']);
    expect(fail(d, use(d, 'revolution'))).toBe('invalidAbility');
    expect(fail(d, use(d, 'skip'))).toBe('invalidAbility');
    expect(fail(d, use(d, 'nope' as AbilityId))).toBe('invalidAbility');
    expect(fail(d, use(d, 5 as unknown as AbilityId))).toBe('malformed');
    // 持ち主でない人
    const e = sc([], ['S5', 'H3 H4', 'D3 D4', 'C3 C4'], ['ban'], { turn: 1 });
    expect(fail(e, use(e, 'ban', { rank: 4 }))).toBe('invalidAbility');
    // 手番でない
    d.play(0, 'S5');
    expect(fail(d, { type: 'useAbility', seat: 0, awaitId: d.current().id, ability: 'ban', rank: 9 })).toBe('notYourAwait');
    // 7渡しの選択の間
    const f = sc(['give_on_7'], ['S7 S5 S6', 'H3 H4', 'D3 D4', 'C3 C4'], ['ban']);
    f.play(0, 'S7');
    expect(f.current().kind).toBe('choice');
    expect(fail(f, use(f, 'ban', { rank: 9 }))).toBe('wrongAwaitKind');
    // 返しの一周の間（席0が返す側）
    const g = sc(['spade3_beats_joker'], ['S3 S5 S6', 'X0 H4', 'D3 D4', 'C3 C4'], ['ban'], { turn: 1 });
    g.play(1, 'X0');
    g.respond(2, null);
    g.respond(3, null);
    expect(g.current()).toMatchObject({ seat: 0, kind: 'respond' });
    expect(fail(g, use(g, 'ban', { rank: 9 }))).toBe('wrongAwaitKind');
  });
});

// ---------- 透視 ----------

describe('透視（§5.3、§17.2、§17.3）', () => {
  it('3枚未満なら全部見る。見たカードは本人と対象だけに見える', () => {
    const d = sc([], ['S5 S6', 'H3 H4', 'D3 D4 D5 D6', 'C3 C4'], ['peek']);
    const ev = d.use(0, 'peek', { target: 1 });
    expect(ev).toEqual([expect.objectContaining({ type: 'ability', seat: 0, ability: 'peek', target: 1, cards: cs('H3 H4') })]);
    for (const v of [0, 1] as SeatId[]) expect(eventsFor(ev, v)[0]).toMatchObject({ cards: cs('H3 H4') });
    for (const v of [2, 3] as SeatId[]) {
      const e = eventsFor(ev, v)[0]!;
      expect(e).toEqual({ seq: ev[0]!.seq, gameNo: ev[0]!.gameNo, type: 'ability', seat: 0, ability: 'peek', target: 1 });
      expect(viewFor(d.state, v).game?.peek).toBeNull();
      expect(viewFor(d.state, v).game?.peekedMine).toBeNull();
    }
    expect(viewFor(d.state, 0).game?.peek).toEqual({ target: 1, cards: cs('H3 H4') });
    expect(viewFor(d.state, 1).game?.peekedMine).toEqual(cs('H3 H4'));
  });

  it('3枚以上なら乱数で3枚。見たカードが出されたら消える', () => {
    const d = sc([], ['S5 S6', 'H3 H4 H5 H6 H7', 'D3 D4', 'C3 C4'], ['peek']);
    d.use(0, 'peek', { target: 1 });
    const seen = d.game.peek!.cards;
    expect(seen).toHaveLength(3);
    expect(seen.every((x) => cs('H3 H4 H5 H6 H7').includes(x))).toBe(true);
    d.play(0, 'S5');
    const card = seen[seen.length - 1]!;
    d.apply({ type: 'play', seat: 1, awaitId: d.current().id, cards: [card] });
    expect(viewFor(d.state, 0).game?.peek?.cards).toEqual(seen.filter((x) => x !== card));
    expect(viewFor(d.state, 1).game?.peekedMine).toEqual(seen.filter((x) => x !== card));
  });

  it('見たカードが対象の手札を離れたら、あとで戻っても再び表示しない（design-3 §6.8）', () => {
    // 席0が席1を透視（H5 を見る）→ 強奪で H5 を取る → 7渡しで H5 を席1に返す
    const d = sc(['give_on_7'], ['S9 S7 S4', 'H5', 'D10 DJ', 'C10 CJ'], ['peek', 'steal']);
    d.use(0, 'peek', { target: 1 });
    expect(d.game.peek).toEqual({ target: 1, cards: cs('H5') });
    d.use(0, 'steal', { target: 1, card: 'S9' });
    expect(d.game.hands[1]).toEqual(cs('S9'));
    expect(d.game.peek!.cards).toEqual([]);
    d.play(0, 'S7');
    d.choose(0, 'H5');
    expect(d.game.hands[1]).toEqual(cs('H5 S9'));
    expect(viewFor(d.state, 0).game?.peek).toEqual({ target: 1, cards: [] });
    expect(viewFor(d.state, 1).game?.peekedMine).toEqual([]);
  });

  it('対象: 自分・上がった人・手札0枚は選べない（abilityNotUsable）。形の誤りは malformed', () => {
    const d = sc([], ['S5 S6', '', 'D3 D4', 'C3 C4'], ['peek']);
    d.game.topOrder = [1];
    d.game.placeReasons[1] = 'finish';
    expect(fail(d, use(d, 'peek', { target: 0 }))).toBe('abilityNotUsable');
    expect(fail(d, use(d, 'peek', { target: 1 }))).toBe('abilityNotUsable');
    expect(fail(d, use(d, 'peek', { target: 7 }))).toBe('malformed');
    expect(fail(d, use(d, 'peek'))).toBe('malformed');
    expect(viewFor(d.state, 0).mine).toMatchObject({ abilities: [{ id: 'peek', usable: true, targets: [2, 3] }] });
  });
});

// ---------- 強奪 ----------

describe('強奪（§5.4、§17.1、§17.2）', () => {
  it('自分の1枚と相手のランダムな1枚を交換する。中身は当事者だけに見える', () => {
    const d = sc([], ['S5 S6', 'H3', 'D3 D4', 'C3 C4'], ['steal']);
    const ev = d.use(0, 'steal', { target: 1, card: 'S6' });
    expect(ev).toEqual([expect.objectContaining({ type: 'ability', ability: 'steal', target: 1, given: 'spade-6', taken: 'heart-3' })]);
    expect(d.game.hands[0]).toEqual(cs('H3 S5'));
    expect(d.game.hands[1]).toEqual(cs('S6'));
    for (const v of [0, 1] as SeatId[]) expect(eventsFor(ev, v)[0]).toMatchObject({ given: 'spade-6', taken: 'heart-3' });
    for (const v of [2, 3] as SeatId[]) {
      const text = JSON.stringify(eventsFor(ev, v));
      expect(text).not.toContain('spade-6');
      expect(text).not.toContain('heart-3');
      expect(eventsFor(ev, v)[0]).toMatchObject({ type: 'ability', ability: 'steal', seat: 0, target: 1 });
      expect(JSON.stringify(viewFor(d.state, v))).not.toContain('heart-3');
    }
  });

  it('義務のカードは渡せない。手札にないカードは cardNotInHand。上がった相手は選べない', () => {
    const d = sc(['diamond3_start'], ['D3 S5', 'H3 H4', 'S3 D4', 'C3 C4'], ['steal'], { openingCard: 'diamond-3' });
    expect(fail(d, use(d, 'steal', { target: 1, card: 'diamond-3' }))).toBe('abilityNotUsable');
    expect(fail(d, use(d, 'steal', { target: 1, card: 'heart-3' }))).toBe('cardNotInHand');
    expect(fail(d, use(d, 'steal', { target: 1 }))).toBe('malformed');
    expect(viewFor(d.state, 0).mine).toMatchObject({ abilities: [{ id: 'steal', usable: true, targets: [1, 2, 3], cards: cs('S5') }] });
    d.game.topOrder = [2];
    d.game.hands[2] = [];
    expect(fail(d, use(d, 'steal', { target: 2, card: 'spade-5' }))).toBe('abilityNotUsable');
    d.use(0, 'steal', { target: 3, card: 'S5' });
    expect(d.game.hands[0]).toHaveLength(2);
    expect(d.game.hands[0]).toContain('diamond-3');
  });
});

// ---------- 強制流し ----------

describe('強制流し（§5.5）', () => {
  it('場が空なら使えない', () => {
    const d = sc([], ['S5', 'H3', 'D3', 'C3'], ['forceFlush']);
    expect(fail(d, use(d, 'forceFlush'))).toBe('abilityNotUsable');
    expect(viewFor(d.state, 0).mine).toMatchObject({ abilities: [{ id: 'forceFlush', usable: false }] });
  });

  it('縛り・J バック・独裁・パス状態を解除し、持ち主が親になる。新しい待ちには continues を付けない', () => {
    const d = sc(['suit_lock', 'temp_reverse_on_j'], ['S3 S4 S5', 'HJ H2 C2', 'D6 D7', 'H10 C9 C8'], ['ban', 'forceFlush'], {
      turn: 1,
    });
    d.play(1, 'HJ');
    d.pass(2);
    d.play(3, 'H10');
    expect(d.game.tempReverse).toBe(true);
    expect(d.game.suitLock).toEqual(['heart']);
    d.use(0, 'ban', { rank: 5 });
    expect(d.game.ban).toBe(5);
    const before = d.current();
    const ev = d.use(0, 'forceFlush');
    expect(ev.map((e) => e.type)).toEqual(['ability', 'tempReverse', 'fieldCleared']);
    expect(ev.at(-1)).toMatchObject({ reason: 'forceFlush', leader: 0 });
    const g = d.game;
    expect([g.field, g.lastPlayer, g.tempReverse, g.suitLock, g.ban]).toEqual([[], null, false, null, null]);
    expect(g.passed).toEqual([false, false, false, false]);
    expect(g.discard).toEqual(expect.arrayContaining(cs('HJ H10')));
    const w = d.current();
    expect(w).toEqual({ id: before.id + 1, seat: 0, kind: 'turn', timer: 'turn' });
    expect('continues' in w).toBe(false);
  });

  it('革命は残り、9リバースは解除される', () => {
    const d = sc(['reverse_order_on_9'], ['S3 S4', 'H9 H5', 'D6 D7', 'C8 C9'], ['forceFlush'], { turn: 1, revolution: true });
    d.play(1, 'H9');
    expect(d.current().seat).toBe(0);
    d.use(0, 'forceFlush');
    expect(d.game.revolution).toBe(true);
    expect(d.game.orderReversed).toBe(false);
    expect(d.game.direction).toBe(1);
    expect(d.current()).toMatchObject({ seat: 0 });
  });
});

// ---------- 独裁 ----------

describe('独裁（§5.6、§14.7、§14.8、§17.5）', () => {
  it('組・ジョーカーを混ぜた組が出せない。ジョーカーの1枚出しは出せる。出せない理由は ban', () => {
    const d = sc([], ['S9 H9 X0 S5', 'H3', 'D3', 'C3'], ['ban']);
    d.use(0, 'ban', { rank: 9 });
    expect(viewFor(d.state, 1).game?.ban).toBe(9);
    const plays = legalPlays(d.state, 0).map((p) => p.cards.join(' '));
    expect(plays.some((p) => p.includes('-9'))).toBe(false);
    expect(plays).toContain('joker-0');
    const w = d.current();
    const r = d.try({ type: 'play', seat: 0, awaitId: w.id, cards: cs('S9 X0') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'illegalPlay', violation: 'ban' });
  });

  it('階段は範囲に封じた数字を含むと出せない', () => {
    const d = sc(['runs'], ['S8 S9 S10 SJ SQ', 'H3', 'D3', 'C3'], ['ban']);
    d.use(0, 'ban', { rank: 9 });
    const runs = legalPlays(d.state, 0).filter((p) => p.shape === 'run').map((p) => p.cards.join(' '));
    expect(runs).toEqual([cs('S10 SJ SQ').join(' ')]);
  });

  it('激縛り中に、封じた数字の代わりとしてジョーカーを出せない', () => {
    const d = sc(['sequence_lock'], ['X0 H8 S3', 'H3', 'H6 D4', 'H7 C4'], ['ban'], { turn: 2 });
    d.play(2, 'H6');
    d.play(3, 'H7');
    expect(d.game.seqLock).toMatchObject({ rank: 7 });
    expect(legalPlays(d.state, 0).map((p) => p.cards)).toEqual([cs('H8'), cs('X0')]);
    d.use(0, 'ban', { rank: 8 });
    expect(legalPlays(d.state, 0)).toEqual([]);
    expect(viewFor(d.state, 0).mine).toMatchObject({ canPass: true });
  });

  it('3を封じると、スペ3返しの一周は行わず、すぐ場が流れてジョーカーを出した人が親', () => {
    const d = sc(['spade3_beats_joker'], ['X0 S5', 'S3 H4', 'D3 D4', 'C3 C4'], ['ban']);
    d.use(0, 'ban', { rank: 3 });
    const ev = d.play(0, 'X0');
    expect(ev.map((e) => e.type)).toEqual(['play', 'fieldCleared']);
    expect(ev[1]).toMatchObject({ reason: 'jokerUnbeatable', leader: 0 });
    expect(d.current()).toMatchObject({ seat: 0, kind: 'turn' });
    expect(d.game.ban).toBeNull();
  });

  it('4を封じると、4止めの一周は行わず8切りで流れる', () => {
    const d = sc(['flush_on_8', 'block_flush_with_4'], ['S5 S6', 'H8 H9', 'D4 C4 D9', 'C3 C9'], ['ban']);
    d.use(0, 'ban', { rank: 4 });
    d.play(0, 'S5');
    const ev = d.play(1, 'H8');
    expect(ev.map((e) => e.type)).toEqual(['play', 'fieldCleared']);
    expect(ev[1]).toMatchObject({ reason: 'flush_on_8', leader: 1 });
    expect(d.game.ban).toBeNull();
  });

  it('封じた数字が別（5）なら、これまでどおり返しの一周を行う', () => {
    const d = sc(['spade3_beats_joker'], ['X0 S6', 'S3 H4', 'D3 D4', 'C3 C4'], ['ban']);
    d.use(0, 'ban', { rank: 5 });
    expect(d.play(0, 'X0').map((e) => e.type)).toEqual(['play', 'returnRoundStart']);
    expect(legalPlays(d.state, 1).map((p) => p.cards)).toEqual([cs('S3')]);
    const f = sc(['flush_on_8', 'block_flush_with_4'], ['S5 S6', 'H8 H9', 'D4 C4 D9', 'C3 C9'], ['ban']);
    f.use(0, 'ban', { rank: 5 });
    f.play(0, 'S6');
    expect(f.play(1, 'H8').at(-1)).toMatchObject({ type: 'returnRoundStart', rule: 'block_flush_with_4' });
    expect(legalPlays(f.state, 2).map((p) => p.cards)).toEqual([cs('D4 C4')]);
  });

  it('砂嵐も封じた数字なら出せない', () => {
    const e = sc(['triple3_trump'], ['S3 H3 D3 S5', 'H4', 'D4', 'CA C4'], ['ban'], { turn: 3 });
    e.play(3, 'CA');
    expect(legalPlays(e.state, 0).map((p) => p.cards)).toEqual([cs('S3 H3 D3')]);
    e.use(0, 'ban', { rank: 3 });
    expect(legalPlays(e.state, 0)).toEqual([]);
    const r = e.try({ type: 'play', seat: 0, awaitId: e.current().id, cards: cs('S3 H3 D3') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.violation).toBe('ban');
  });

  it('場が流れたら解除。親が出せる手を持たないときはパスでき、場が流れた扱いで解除される', () => {
    const d = sc([], ['S9 H9', 'H3 H4', 'D3 D4', 'C3 C4'], ['ban']);
    d.use(0, 'ban', { rank: 9 });
    expect(viewFor(d.state, 0).mine).toMatchObject({ kind: 'turn', leader: true, plays: [], canPass: true });
    const ev = d.pass(0);
    expect(ev.map((e) => e.type)).toEqual(['pass', 'fieldCleared']);
    expect(ev[1]).toMatchObject({ reason: 'leaderPassed', leader: 1 });
    expect(d.game.ban).toBeNull();

    const f = sc([], ['S5 S6', 'H3 H4', 'D3 D4', 'C3 C4'], ['ban']);
    f.use(0, 'ban', { rank: 4 });
    f.play(0, 'S5');
    f.pass(1);
    f.pass(2);
    expect(f.game.ban).toBe(4);
    f.pass(3);
    expect(f.game.ban).toBeNull();
    expect(viewFor(f.state, 2).game?.ban).toBeNull();
  });

  it('義務のカード（ダイヤの3）の数字は指定できない。数字の形の誤りは malformed', () => {
    const d = sc(['diamond3_start'], ['D3 S5', 'H3', 'S3', 'C3'], ['ban'], { openingCard: 'diamond-3' });
    expect(fail(d, use(d, 'ban', { rank: 3 }))).toBe('abilityNotUsable');
    expect(fail(d, use(d, 'ban', { rank: 16 }))).toBe('malformed');
    expect(fail(d, use(d, 'ban'))).toBe('malformed');
    const u = viewFor(d.state, 0).mine;
    if (u === null || u.kind !== 'turn') throw new Error();
    expect(u.abilities[0]!.ranks).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    d.use(0, 'ban', { rank: 15 });
    expect(d.events.at(-1)).toMatchObject({ type: 'ability', ability: 'ban', rank: 15 });
  });
});

// ---------- 革命 ----------

describe('革命（特権、§5.7）', () => {
  it('場の途中で使うと、その瞬間から逆になる。革命中に使うと戻る', () => {
    const d = sc([], ['S5 SK', 'H3', 'D3', 'H10 C3'], ['revolution'], { turn: 3 });
    d.play(3, 'H10');
    expect(legalPlays(d.state, 0).map((p) => p.cards)).toEqual([cs('SK')]);
    const ev = d.use(0, 'revolution');
    expect(ev.map((e) => e.type)).toEqual(['ability', 'revolution']);
    expect(ev[1]).toMatchObject({ active: true });
    expect(d.game.revolutionBy).toBe(0);
    expect(legalPlays(d.state, 0).map((p) => p.cards)).toEqual([cs('S5')]);

    const e = sc([], ['S5 SK', 'H3', 'D3', 'C3'], ['revolution'], { revolution: true });
    const ev2 = e.use(0, 'revolution');
    expect(ev2[1]).toMatchObject({ type: 'revolution', active: false });
    expect(e.game.revolution).toBe(false);
  });

  it('4枚組の革命は、出した人を revolutionBy に書く', () => {
    const d = new Driver(scene({ rules: ['revolution'], hands: ['S3', 'H5 S5 D5 C5 H6', 'D3', 'C3'], turn: 1 }));
    d.play(1, 'H5 S5 D5 C5');
    expect(d.game.revolutionBy).toBe(1);
  });
});

// ---------- スキップ ----------

describe('スキップ（§5.8、§17.5、design-3 §6.4）', () => {
  it('次の人を飛ばす。飛ばされた人はパス扱いにならない', () => {
    const d = sc([], ['S5 S6', 'H3 H7', 'D6 D8', 'C3 C9'], ['skip']);
    const w = d.current();
    expect(viewFor(d.state, 0).mine).toMatchObject({ skipAvailable: true, abilities: [] });
    expect(legalPlays(d.state, 0).every((p) => p.canSkip === true)).toBe(true);
    const ev = d.apply({ type: 'play', seat: 0, awaitId: w.id, cards: cs('S5'), withSkip: true });
    expect(ev.map((e) => e.type)).toEqual(['play', 'ability', 'skipped']);
    expect(ev[1]).toMatchObject({ seat: 0, ability: 'skip' });
    expect(ev[2]).toMatchObject({ by: 0, seats: [1] });
    expect(d.current().seat).toBe(2);
    expect(d.game.passed).toEqual([false, false, false, false]);
    expect(d.game.abilities!.used).toEqual(['skip']);
    d.play(2, 'D6');
    d.pass(3);
    d.pass(0);
    expect(d.current().seat).toBe(1); // 飛ばされた人には、同じ場でも手番が来る
    expect(fail(d, { type: 'play', seat: 1, awaitId: d.current().id, cards: cs('H7'), withSkip: true })).toBe('cannotSkip');
  });

  it('K スキップと合算する', () => {
    const d = sc(['skip_on_k'], ['SK S6', 'H3 H7', 'D6 D8', 'C3 C9'], ['skip']);
    d.play(0, 'SK', { withSkip: true });
    expect(d.events.at(-1)).toMatchObject({ type: 'skipped', seats: [1, 2] });
    expect(d.current().seat).toBe(3);
  });

  it('場を流すかもしれない手・上がる手には付けられない（cannotSkip）', () => {
    const tryPlay = (rules: RuleId[], hand: string, cards: string) => {
      const d = sc(rules, [hand, 'H3 H7', 'D6 D8', 'C3 C9'], ['skip']);
      const lp = legalPlays(d.state, 0).find((p) => p.cards.join(' ') === cs(cards).join(' '));
      return { code: fail(d, { type: 'play', seat: 0, awaitId: d.current().id, cards: cs(cards), withSkip: true }), lp };
    };
    expect(tryPlay(['flush_on_8'], 'S8 S5', 'S8')).toMatchObject({ code: 'cannotSkip', lp: { foul: false } });
    expect(tryPlay(['flush_on_8'], 'S8 S5', 'S8').lp?.canSkip).toBeUndefined();
    expect(tryPlay(['triple3_trump'], 'S3 H3 D3 S5', 'S3 H3 D3').code).toBe('cannotSkip');
    expect(tryPlay([], 'X0 S5', 'X0').code).toBe('cannotSkip');
    expect(tryPlay([], 'X0 X1 S5', 'X0 X1').code).toBe('cannotSkip');
    expect(tryPlay([], 'S5', 'S5').code).toBe('cannotSkip');
    // 8切りが OFF なら8には付けられる
    const d = sc([], ['S8 S5', 'H3 H7', 'D6 D8', 'C3 C9'], ['skip']);
    d.play(0, 'S8', { withSkip: true });
    expect(d.current().seat).toBe(2);
    // 形の誤り
    const e = sc([], ['S8 S5', 'H3 H7', 'D6 D8', 'C3 C9'], ['skip']);
    expect(fail(e, { type: 'play', seat: 0, awaitId: e.current().id, cards: cs('S8'), withSkip: 'yes' as unknown as boolean })).toBe(
      'malformed',
    );
  });

  it('2人だけ残っているとき: 相手を飛ばして自分に戻り、場が流れて自分が親になる', () => {
    const d = sc([], ['S5 S6', '', 'D6 D8', ''], ['skip']);
    d.game.topOrder = [1, 3];
    d.game.placeReasons[1] = 'finish';
    d.game.placeReasons[3] = 'finish';
    const ev = d.play(0, 'S5', { withSkip: true });
    expect(ev.map((e) => e.type)).toEqual(['play', 'ability', 'skipped', 'fieldCleared']);
    expect(ev[2]).toMatchObject({ seats: [2] });
    expect(ev[3]).toMatchObject({ reason: 'allPassed', leader: 0 });
    expect(d.current().seat).toBe(0);
  });

  it('9リバース中は逆回りで次の人を飛ばす', () => {
    const d = sc(['reverse_order_on_9'], ['S5 S6', 'H3 H7', 'D6 D8', 'C3 C9'], ['skip'], { orderReversed: true });
    d.play(0, 'S5', { withSkip: true });
    expect(d.events.at(-1)).toMatchObject({ type: 'skipped', seats: [3] });
    expect(d.current().seat).toBe(2);
  });

  it('7渡しで最後のカードを渡して上がる手にも付けられ、効果も起きる（design-3 §6.4）', () => {
    const d = sc(['give_on_7'], ['S7 H3', 'H4 H8', 'D6 D8', 'C3 C9'], ['skip']);
    expect(legalPlays(d.state, 0).find((p) => p.cards[0] === 'spade-7')?.canSkip).toBe(true);
    d.play(0, 'S7', { withSkip: true });
    d.choose(0, 'H3');
    expect(d.places()?.[0]).toBe(1);
    expect(d.events.at(-1)).toMatchObject({ type: 'skipped', by: 0, seats: [1] });
    expect(d.current().seat).toBe(2);
  });

  it('持ち主でない人・スキップを選んでいない人の手には canSkip が付かない', () => {
    const d = sc([], ['S5 S6', 'H3 H7', 'D6 D8', 'C3 C9'], ['ban'], { turn: 1 });
    expect(legalPlays(d.state, 1).some((p) => 'canSkip' in p)).toBe(false);
    expect(viewFor(d.state, 1).mine).toMatchObject({ skipAvailable: false, abilities: [] });
    const e = sc([], ['S5 S6', 'H3 H7', 'D6 D8', 'C3 C9'], ['ban']);
    expect(legalPlays(e.state, 0).some((p) => 'canSkip' in p)).toBe(false);
    expect(fail(e, { type: 'play', seat: 0, awaitId: e.current().id, cards: cs('S5'), withSkip: true })).toBe('cannotSkip');
  });
});

// ---------- CPU ----------

describe('CPU の特権（§5.9、§17.5、design-3 §2.5）', () => {
  const cpu = (d: Driver) => d.auto('cpu');

  it('強奪: いちばん弱いカード（義務のカードを除く）を、乱数で選んだ相手と交換する', () => {
    const d = sc([], ['SA S4 X0 H9', 'H3', 'D3', 'C3'], ['steal']);
    const ev = cpu(d);
    expect(ev[0]).toMatchObject({ type: 'ability', ability: 'steal', given: 'spade-4' });
    expect([1, 2, 3]).toContain((ev[0] as { target: number }).target);
    // 逆のときは A がいちばん弱い…ではなく、逆の向きでいちばん弱いのは2。ここでは A
    const e = sc([], ['SA S4 X0 H9', 'H3', 'D3', 'C3'], ['steal'], { revolution: true });
    expect(cpu(e)[0]).toMatchObject({ given: 'spade-14' });
    const f = sc(['diamond3_start'], ['D3 S4', 'H3', 'S3', 'C3'], ['steal'], { openingCard: 'diamond-3' });
    expect(cpu(f)[0]).toMatchObject({ given: 'spade-4' });
  });

  it('革命: (a) 最初の手番で手札の半分以上が8より弱い (b) 他人に起こされた革命を戻す', () => {
    const a = sc([], ['S3 S4 S5 SK', 'H3', 'D3', 'C3'], ['revolution']);
    expect(cpu(a).map((e) => e.type)).toEqual(['ability', 'revolution']);
    const no = sc([], ['S3 SK SA S2', 'H3', 'D3', 'C3'], ['revolution']);
    expect(cpu(no)[0]).toMatchObject({ type: 'play' });
    const later = sc([], ['S3 S4 S5 SK', 'H3', 'D3', 'C3'], ['revolution']);
    later.game.turnCount[0] = 1;
    expect(cpu(later)[0]).toMatchObject({ type: 'play' });
    const back = sc([], ['S3 SK SA S2', 'H3', 'D3', 'C3'], ['revolution'], { revolution: true });
    back.game.revolutionBy = 2;
    expect(cpu(back)[1]).toMatchObject({ type: 'revolution', active: false });
    const mine = sc([], ['S3 SK SA S2', 'H3', 'D3', 'C3'], ['revolution'], { revolution: true });
    mine.game.revolutionBy = 0;
    expect(cpu(mine)[0]).toMatchObject({ type: 'play' });
  });

  it('独裁: 親のとき、その時点の向きでいちばん強い数字を封じる。指定できないときは使わない', () => {
    const d = sc([], ['S3 S4', 'H3', 'D3', 'C3'], ['ban']);
    expect(cpu(d)[0]).toMatchObject({ ability: 'ban', rank: 15 });
    const r = sc([], ['S3 S4', 'H3', 'D3', 'C3'], ['ban'], { revolution: true });
    expect(cpu(r)[0]).toMatchObject({ ability: 'ban', rank: 3 });
    const o = sc(['diamond3_start'], ['D3 S4', 'H3', 'S3', 'C3'], ['ban'], { revolution: true, openingCard: 'diamond-3' });
    expect(cpu(o)[0]).toMatchObject({ type: 'play' });
    const f = sc([], ['S3 S4', 'H3', 'D3', 'C5 C6'], ['ban'], { turn: 3 });
    f.play(3, 'C5');
    expect(cpu(f)[0]).toMatchObject({ type: 'pass' });
  });

  it('強制流し: 場にカードが出ていて、出せる手が1つもないとき', () => {
    const d = sc([], ['S3 S4', 'H3', 'D3', 'C2 C6'], ['forceFlush'], { turn: 3 });
    d.play(3, 'C2');
    const ev = cpu(d);
    expect(ev[0]).toMatchObject({ ability: 'forceFlush' });
    expect(d.current()).toMatchObject({ seat: 0 });
    const e = sc([], ['S3 SA', 'H3', 'D3', 'CK C6'], ['forceFlush'], { turn: 3 });
    e.play(3, 'CK');
    expect(cpu(e)[0]).toMatchObject({ type: 'play' });
  });

  it('スキップ: 出す前の手札が3枚以下で、その手に付けられるとき', () => {
    const d = sc([], ['S5 S6 S7', 'H3 H4', 'D3 D4', 'C3 C4'], ['skip']);
    expect(cpu(d).map((e) => e.type)).toEqual(['play', 'ability', 'skipped']);
    const e = sc([], ['S5 S6 S7 S9', 'H3 H4', 'D3 D4', 'C3 C4'], ['skip']);
    expect(cpu(e).map((x) => x.type)).toEqual(['play']);
  });

  it('透視は使わない。時間切れでは特権を使わない。上から順に1回の auto で1つ', () => {
    const p = sc([], ['S3 S4', 'H3', 'D3', 'C3'], ['peek']);
    expect(cpu(p)[0]).toMatchObject({ type: 'play' });
    const t = sc([], ['S3 S4 S5 SK', 'H3', 'D3', 'C3'], ['steal', 'revolution', 'ban', 'skip']);
    expect(t.auto('timeout')[0]).toMatchObject({ type: 'play' });
    const d = sc([], ['S3 S4 S5 SK', 'H3', 'D3', 'C3'], ['steal', 'ban', 'revolution']);
    expect(cpu(d)[0]).toMatchObject({ ability: 'steal' });
    expect(cpu(d)[0]).toMatchObject({ ability: 'revolution' });
    expect(cpu(d)[0]).toMatchObject({ ability: 'ban' });
    expect(cpu(d)[0]).toMatchObject({ type: 'play' });
  });
});

// ---------- 見える情報 ----------

describe('見える情報（design-3 §2.6、§6.8）', () => {
  it('公開される個数と使用済みの履歴が同じなら、未使用の種類と途中の内容を変えても、第三者の view と出せる手は同じ', () => {
    const base = (chosen: AbilityId[], draft: AbilityId[]) => {
      const s = scene({
        rules: [...ALL_RULE_IDS],
        hands: ['S5 S6 S7', 'H3 H8 HK', 'D4 D9', 'C6 C10'],
        turn: 1,
        abilities: { holder: 0, chosen, used: ['ban'] },
      });
      s.game!.abilities!.draft = draft;
      return s;
    };
    const a = base(['steal', 'ban', 'skip'], ['steal', 'ban', 'skip']);
    const b = base(['peek', 'ban', 'revolution'], ['peek']);
    for (const v of [1, 2, 3] as SeatId[]) {
      expect(viewFor(b, v)).toStrictEqual(viewFor(a, v));
      expect(legalPlays(b, v)).toStrictEqual(legalPlays(a, v));
    }
    expect(viewFor(a, 1).game?.abilities).toEqual({ holder: 0, slots: 3, remaining: 2, selecting: false });
    expect(viewFor(a, 0).game?.myAbilities).toEqual({ chosen: ['steal', 'ban', 'skip'], used: ['ban'], draft: ['steal', 'ban', 'skip'] });
    // 席1が出したあと、持ち主（席0）の手番になっても、第三者からは同じ
    const play: Action = { type: 'play', seat: 1, awaitId: 100, cards: cs('H3') };
    const pa = applyAction(a, play);
    const pb = applyAction(b, play);
    if (!pa.ok || !pb.ok) throw new Error();
    expect(awaiting(pa.state)[0]).toMatchObject({ seat: 2 });
    for (const v of [1, 2, 3] as SeatId[]) {
      expect(eventsFor(pb.events, v)).toStrictEqual(eventsFor(pa.events, v));
      expect(viewFor(pb.state, v)).toStrictEqual(viewFor(pa.state, v));
      expect(legalPlays(pb.state, v)).toStrictEqual(legalPlays(pa.state, v));
    }
  });

  it('持ち主の手番でも、使える特権・スキップ・canSkip は本人の view にだけ出る', () => {
    const s = scene({
      rules: [],
      hands: ['S5 S6 S7', 'H3 H8 HK', 'D4 D9', 'C6 C10'],
      turn: 0,
      abilities: { holder: 0, chosen: ['steal', 'ban', 'skip'] },
    });
    const m = viewFor(s, 0).mine;
    if (m === null || m.kind !== 'turn') throw new Error();
    expect(m.skipAvailable).toBe(true);
    expect(m.abilities.map((u) => u.id)).toEqual(['steal', 'ban']);
    expect(m.plays.some((p) => p.canSkip === true)).toBe(true);
    for (const v of [1, 2, 3] as SeatId[]) {
      const text = JSON.stringify(viewFor(s, v)) + JSON.stringify(legalPlays(s, v));
      for (const word of ['steal', 'skip', 'canSkip', 'skipAvailable', 'usable']) expect(text).not.toContain(word);
    }
  });

  it('abilitiesChosen・透視・強奪の出来事を、4席それぞれで確かめる', () => {
    const { s } = toAbilityPhase();
    const holder = s.game!.abilities!.holder;
    const r = applyAction(s, { type: 'selectAbilities', seat: holder, awaitId: awaiting(s)[0]!.id, abilities: ['steal'], confirm: true });
    if (!r.ok) throw new Error();
    for (const v of SEATS) {
      const e = eventsFor(r.events, v)[0]!;
      expect(e).toMatchObject({ type: 'abilitiesChosen', seat: holder, count: 1, abilities: v === holder ? ['steal'] : null });
      if (v !== holder) expect(JSON.stringify(eventsFor(r.events, v))).not.toContain('steal');
    }
    const d = sc([], ['S5 S6', 'H3 H4 H5', 'D3 D4', 'C3 C4'], ['peek', 'steal']);
    const ev = [...d.use(0, 'peek', { target: 1 }), ...d.use(0, 'steal', { target: 2, card: 'S6' })];
    for (const v of SEATS) {
      const [p, t] = eventsFor(ev, v);
      expect(p).toMatchObject({ type: 'ability', ability: 'peek', seat: 0, target: 1 });
      expect(t).toMatchObject({ type: 'ability', ability: 'steal', seat: 0, target: 2 });
      expect('cards' in p!).toBe(v === 0 || v === 1);
      expect('given' in t! && 'taken' in t!).toBe(v === 0 || v === 2);
    }
  });
});

describe('ability のフェーズ（design-3 §6.5）', () => {
  it('awaiting() に選択の待ちが出て、auto（timeout・cpu）で抜けられる。JSON の往復でも同じ', () => {
    const { s } = toAbilityPhase([9, 8, 7, 6]);
    const ws = awaiting(s);
    expect(ws).toHaveLength(1);
    expect(ws[0]!.kind).toBe('abilitySelect');
    expect(viewFor(s, ws[0]!.seat).awaiting).toEqual(ws);
    for (const policy of ['timeout', 'cpu'] as const) {
      const r1 = applyAction(s, { type: 'auto', awaitId: ws[0]!.id, policy });
      const r2 = applyAction(JSON.parse(JSON.stringify(s)) as MatchState, { type: 'auto', awaitId: ws[0]!.id, policy });
      expect(r2).toStrictEqual(r1);
      if (!r1.ok) throw new Error();
      expect(r1.state.phase).toBe('play');
    }
    // 対戦の操作はこのフェーズでは受け付けない
    expect(applyAction(s, { type: 'nextGame' }).ok).toBe(false);
  });

  it('設定: abilities が真なら都落ちが必須。boolean でなければ malformed', () => {
    const r = createMatch({ matchId: 'm', rules: ['flush_on_8'], gameCount: 5, abilities: true }, [1, 2, 3, 4]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'missingRequirement', rule: 'dethrone' });
    const m = createMatch({ matchId: 'm', rules: ['dethrone'], gameCount: 5, abilities: 'yes' } as never, [1, 2, 3, 4]);
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.error.code).toBe('malformed');
    const ok = createMatch({ matchId: 'm', rules: ['dethrone'], gameCount: 5, abilities: true }, [1, 2, 3, 4]);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.state.version).toBe(3);
    const off = createMatch({ matchId: 'm', rules: ['flush_on_8'], gameCount: 5 }, [1, 2, 3, 4]);
    if (!off.ok) throw new Error();
    expect(off.state.config.abilities).toBe(false);
    expect(off.state.abilityGrant).toBeNull();
  });
});

describe('外から来た不正な値（文字列にできない値）', () => {
  const evil = { toString: null } as unknown;
  const evil2 = { toString: 0 } as unknown;
  it('selectAbilities・useAbility・play などに入れても例外を投げず、状態と乱数を変えない', () => {
    const { s } = toAbilityPhase();
    const holder = s.game!.abilities!.holder;
    const id = awaiting(s)[0]!.id;
    const check = (st: MatchState, a: unknown) => {
      const before = JSON.stringify(st);
      let r: ReturnType<typeof applyAction> | undefined;
      expect(() => (r = applyAction(st, a as Action))).not.toThrow();
      expect(r!.ok).toBe(false);
      expect(JSON.stringify(st)).toBe(before);
    };
    for (const v of [evil, evil2]) {
      check(s, { type: 'selectAbilities', seat: holder, awaitId: id, abilities: [v], confirm: true });
      check(s, { type: 'selectAbilities', seat: holder, awaitId: id, abilities: ['ban', v], confirm: false });
    }
    const d = sc(['spade3_beats_joker', 'give_on_7'], ['X0 S7 S5 S6', 'S3 H4', 'D3 D4', 'C3 C4'], ['peek', 'steal', 'ban']);
    const w = d.current().id;
    for (const v of [evil, evil2]) {
      check(d.state, { type: 'useAbility', seat: 0, awaitId: w, ability: v });
      check(d.state, { type: 'useAbility', seat: 0, awaitId: w, ability: 'peek', target: v });
      check(d.state, { type: 'useAbility', seat: 0, awaitId: w, ability: 'steal', target: 1, card: v });
      check(d.state, { type: 'useAbility', seat: 0, awaitId: w, ability: 'ban', rank: v });
      check(d.state, { type: 'play', seat: 0, awaitId: w, cards: [v] });
      check(d.state, { type: 'play', seat: 0, awaitId: v, cards: ['joker-0'] });
      check(d.state, { type: 'play', seat: v, awaitId: w, cards: ['joker-0'] });
    }
    d.play(0, 'X0');
    const r = d.current();
    for (const v of [evil, evil2]) check(d.state, { type: 'respond', seat: r.seat, awaitId: r.id, cards: [v] });
    const e = sc(['give_on_7'], ['S7 S5 S6', 'H3 H4', 'D3 D4', 'C3 C4'], []);
    e.play(0, 'S7');
    for (const v of [evil, evil2]) check(e.state, { type: 'choose', seat: 0, awaitId: e.current().id, cards: [v] });
    // 交換
    const created = createMatch({ matchId: 'm', rules: [...ALL_RULE_IDS], gameCount: 5, abilities: true }, [5, 6, 7, 8]);
    if (!created.ok) throw new Error();
    let x = created.state;
    for (let i = 0; i < 3000 && x.phase !== 'exchange'; i++) {
      const a: Action = x.phase === 'gameResult' ? { type: 'nextGame' } : { type: 'auto', awaitId: awaiting(x)[0]!.id, policy: 'cpu' };
      const rr = applyAction(x, a);
      if (!rr.ok) throw new Error();
      x = rr.state;
    }
    const ew = awaiting(x)[0]!;
    for (const v of [evil, evil2]) check(x, { type: 'exchangeGive', seat: ew.seat, awaitId: ew.id, cards: [v, v] });
  });
});
