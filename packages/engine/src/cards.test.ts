import { describe, expect, it } from 'vitest';
import { createDeck } from './cards.ts';

describe('createDeck', () => {
  it('54枚で、カード ID が重複しない', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(54);
    expect(new Set(deck.map((c) => c.id)).size).toBe(54);
    expect(deck.filter((c) => c.kind === 'joker')).toHaveLength(2);
  });
});
