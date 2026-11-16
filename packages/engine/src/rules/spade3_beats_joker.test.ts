import { describe, expect, it } from 'vitest';
import { viewFor } from '../index.ts';
import { Driver, scene } from '../test/helpers.ts';

describe('スペ3返し（decisions §6.5、§6.2、§14.3、§14.7）', () => {
  const rules = ['spade3_beats_joker'] as const;

  it('ジョーカーの1枚出しで返しの一周に入り、スペードの3で返すと場が流れて返した人が親になる', () => {
    const d = new Driver(scene({ rules: [...rules], hands: ['X0 S4', 'H5 H6', 'S3 D7', 'C3 CK'], turn: 0 }));
    d.play(0, 'X0');
    expect(d.events.find((e) => e.type === 'returnRoundStart')).toMatchObject({ source: 0, participants: [1, 2, 3] });
    // 返せるカードを持っていなくても、順番に聞かれる
    d.respond(1, null);
    d.respond(2, 'S3');
    expect(d.game.field).toEqual([]);
    expect(d.current()).toMatchObject({ seat: 2, kind: 'turn' });
    expect(d.events.find((e) => e.type === 'fieldCleared')).toMatchObject({ reason: 'spade3_beats_joker', leader: 2 });
  });

  it('全員がスキップしたら、ジョーカーを出した人が場を取って親になる', () => {
    const d = new Driver(scene({ rules: [...rules], hands: ['X0 S4', 'H5 H6', 'S3 D7', 'C3 CK'], turn: 0 }));
    d.play(0, 'X0');
    d.respond(1, null);
    d.respond(2, null);
    d.respond(3, null);
    expect(d.game.field).toEqual([]);
    expect(d.current()).toMatchObject({ seat: 0, kind: 'turn' });
    expect(d.events.find((e) => e.type === 'fieldCleared')).toMatchObject({ reason: 'returnFailed', leader: 0 });
  });

  it('その場でパスした人も返しの一周に参加できる', () => {
    const d = new Driver(scene({ rules: [...rules], hands: ['H4 X0 S9', 'S3 H5 H6', 'D5 D7', 'C6 CK'], turn: 0 }));
    d.play(0, 'H4');
    d.pass(1);
    d.play(2, 'D5');
    d.play(3, 'C6');
    d.play(0, 'X0');
    expect(d.current()).toMatchObject({ seat: 1, kind: 'respond' });
    d.respond(1, 'S3');
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
  });

  it('スペードの3がすでに捨て札にあるときは一周を省き、すぐ場を流す（§2.5）', () => {
    const d = new Driver(scene({ rules: [...rules], discard: 'S3', hands: ['X0 S4', 'H5 H6', 'D7 D8', 'C3 CK'], turn: 0 }));
    d.play(0, 'X0');
    expect(d.types()).not.toContain('returnRoundStart');
    expect(d.events.find((e) => e.type === 'fieldCleared')).toMatchObject({ reason: 'jokerUnbeatable', leader: 0 });
    expect(d.current()).toMatchObject({ seat: 0, kind: 'turn' });
  });

  it('OFF ならジョーカーの1枚出しですぐ場が流れる（§2.5）', () => {
    const d = new Driver(scene({ rules: [], hands: ['X0 S4', 'H5 H6', 'S3 D7', 'C3 CK'], turn: 0 }));
    d.play(0, 'X0');
    expect(d.types()).not.toContain('returnRoundStart');
    expect(d.current()).toMatchObject({ seat: 0, kind: 'turn' });
  });

  it('マーク縛り中でもスペードの3で返せる（§14.7）', () => {
    const d = new Driver(
      scene({ rules: ['spade3_beats_joker', 'suit_lock'], hands: ['H4 X0 S9', 'H5 H6', 'S3 D7 H7', 'C6 CK'], turn: 0 }),
    );
    d.play(0, 'H4');
    d.play(1, 'H5');
    expect(d.game.suitLock).toEqual(['heart']);
    d.play(2, 'H7');
    d.pass(3);
    d.play(0, 'X0');
    d.respond(1, null);
    const mine = viewFor(d.state, 2).mine;
    expect(mine?.kind).toBe('respond');
    if (mine?.kind === 'respond') expect(mine.plays.map((p) => p.cards)).toEqual([['spade-3']]);
    d.respond(2, 'S3');
    expect(d.game.suitLock).toBeNull();
  });

  it('スペードの3以外では返せない（ジョーカーも代わりにならない）', () => {
    const d = new Driver(scene({ rules: [...rules], hands: ['X0 S4', 'X1 H5', 'S3 D7', 'C3 CK'], turn: 0 }));
    d.play(0, 'X0');
    const w = d.current();
    for (const cards of [['joker-1'], ['heart-5']]) {
      const r = d.try({ type: 'respond', seat: 1, awaitId: w.id, cards });
      expect(r.ok).toBe(false);
    }
    // 他人のカードは持っていない扱い
    const r = d.try({ type: 'respond', seat: 1, awaitId: w.id, cards: ['spade-3'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('cardNotInHand');
  });

  it('スペードの3で上がっても反則にならない', () => {
    const d = new Driver(scene({ rules: ['spade3_beats_joker', 'forbidden_finish'], hands: ['X0 S4', 'H5 H6', 'S3', 'C3 CK'], turn: 0 }));
    d.play(0, 'X0');
    d.respond(1, null);
    d.respond(2, 'S3');
    expect(d.events.find((e) => e.type === 'placed')).toMatchObject({ seat: 2, place: 1, reason: 'finish' });
    // 親は上がった2の次の3
    expect(d.current()).toMatchObject({ seat: 3, kind: 'turn' });
  });

  it('ジョーカー2枚の組では返しの一周に入らない', () => {
    const d = new Driver(scene({ rules: [...rules], hands: ['X0 X1 S4', 'H5 H6', 'S3 D7', 'C3 CK'], turn: 0 }));
    d.play(0, 'X0 X1');
    expect(d.types()).not.toContain('returnRoundStart');
    expect(d.current()).toMatchObject({ seat: 1, kind: 'turn' });
  });
});
