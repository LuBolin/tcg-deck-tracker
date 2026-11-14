import { describe, expect, it } from 'vitest';
import { cardTotals } from './decklist';
import { matchResult, matchStats, winRate } from './matches';
import { validateDeck } from './rules';
import { OPTIONS, type Change, type DeckLine } from './types';

const line = (cardId: string, qty: number, section = 'main'): DeckLine => ({ cardId, name: cardId, qty, section });
let seq = 0;
const change = (lines: DeckLine[], result = '', match?: Change['match']): Change =>
  ({ id: String(++seq), deckId: 'd', seq, createdAt: `2026-11-${String(seq).padStart(2, '0')}`, lines, tags: [], note: '', result, ...(match ? { match } : {}) });

describe('match log', () => {
  it('writes results that the old record parser counts', () => {
    expect(matchResult('win', ' Gardevoir ex ')).toBe('1-0 vs Gardevoir ex');
    expect(matchResult('loss')).toBe('0-1');
    expect(matchResult('tie', 'Lugia')).toBe('0-0-1 vs Lugia');
  });

  it('groups by opponent, turn order and the version played', () => {
    const v1 = [line('a', 4)];
    const v2 = [line('a', 3), line('b', 1)];
    const s = matchStats([
      change(v1),
      change(v1, matchResult('win', 'Gardevoir ex'), { opponent: 'Gardevoir ex', turn: 'first' }),
      change(v1, matchResult('loss', 'gardevoir EX'), { opponent: 'gardevoir EX', turn: 'second' }),
      change(v2),
      change(v2, '3-1 vs Lugia'), // older free-text result
      change([...v2, line('c', 2, OPTIONS)]), // tech options only: same version
      change([...v2, line('c', 2, OPTIONS)], matchResult('tie')),
    ]);
    expect([s.total.wins, s.total.losses, s.total.draws]).toEqual([4, 2, 1]);
    expect(s.byOpponent.map((o) => [o.opponent, o.record.wins, o.record.losses])).toEqual([['Lugia', 3, 1], ['Gardevoir ex', 1, 1], ['Not noted', 0, 0]]);
    expect([s.byTurn.first.wins, s.byTurn.second.losses]).toEqual([1, 1]);
    expect(s.versions).toBe(2);
    expect(s.byVersion.map((v) => [v.version, v.record.wins, v.record.losses, v.record.draws])).toEqual([[1, 1, 1, 0], [2, 3, 1, 1]]);
    expect(winRate(s.byVersion[1].record)).toBeCloseTo(3 / 5);
  });
});

describe('tech options', () => {
  it('are not needed copies and do not count toward copy limits', () => {
    const lines = [line('a', 4), line('a', 1, OPTIONS), line('b', 2, OPTIONS)];
    expect([...cardTotals(lines)]).toEqual([['a', 4]]);
    expect(validateDeck(lines, { copyLimit: 4, exact: false, sizeSections: ['main'], unlimited: () => false })).toEqual([]);
  });
});
