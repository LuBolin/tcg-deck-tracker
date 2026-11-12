import { describe, expect, it } from 'vitest';
import { costCurve, deckValue, illegalCards } from './insights';
import { slotStatuses } from './status';
import { BINDER, type Card, type DeckLine } from './types';

const line = (cardId: string, qty: number, category?: string): DeckLine => ({ cardId, name: cardId, qty, section: 'main', category });
const card = (id: string, extra: Partial<Card>): Card => ({ game: 'demo', id, name: id, ...extra });

describe('insights', () => {
  const lines = [line('a', 4), line('b', 2), line('c', 1)];
  const cards = new Map([
    ['a', card('a', { price: 1.5, legal: ['standard'], cost: 1 })],
    ['b', card('b', { price: 10, legal: ['modern'], cost: 9 })],
    ['c', card('c', {})],
  ]);

  it('prices the deck and what is missing', () => {
    const statuses = slotStatuses('d', lines, [{ game: 'demo', cardId: 'a', location: BINDER, qty: 4 }]);
    expect(deckValue(lines, cards, statuses)).toEqual({ total: 26, toComplete: 20, unpriced: 1 });
  });

  it('reports only cards known to be illegal, and lets a deeper check override', () => {
    expect([...illegalCards(lines, cards, 'Standard')]).toEqual(['b']);
    expect([...illegalCards(lines, cards, 'Standard', new Map([['b', true]]))]).toEqual([]);
    expect([...illegalCards(lines, cards, undefined)]).toEqual([]);
  });

  it('builds a cost curve with a 7+ bucket', () => {
    const curve = costCurve([...lines, line('land', 20, 'Land')], new Map([...cards, ['land', card('land', { cost: 0 })]]), ['Land']);
    expect(curve.find((c) => c.cost === 1)?.qty).toBe(4);
    expect(curve.find((c) => c.cost === 7)?.qty).toBe(2);
    expect(curve.find((c) => c.cost === 0)?.qty).toBe(0);
  });
});

describe('match records', async () => {
  const { parseRecord, totalRecord, formatRecord } = await import('./insights');
  it('reads records from result text and adds them up', () => {
    expect(parseRecord('3-1 vs Gardevoir')).toEqual({ wins: 3, losses: 1, draws: 0, events: 1 });
    expect(parseRecord('Went 2 - 2 - 1 at locals')).toMatchObject({ wins: 2, losses: 2, draws: 1 });
    expect(parseRecord('Felt good')).toBeUndefined();
    const t = totalRecord(['3-1', 'top 8', '1-2-1']);
    expect([formatRecord(t), t.events]).toEqual(['4-3-1', 2]);
  });
});

describe('opening hand odds', async () => {
  const { chanceInHand } = await import('./insights');
  it('matches known values', () => {
    expect(chanceInHand(60, 4, 7)).toBeCloseTo(0.3995, 3); // 4-of in a 60-card deck, 7-card hand
    expect(chanceInHand(40, 3, 5)).toBeCloseTo(0.3376, 3); // 3-of in a 40-card deck, 5-card hand
    expect(chanceInHand(60, 0, 7)).toBe(0);
    expect(chanceInHand(10, 10, 7)).toBe(1);
  });
});
