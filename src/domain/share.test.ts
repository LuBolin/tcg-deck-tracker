import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, packDeck } from './share';
import type { Change, Deck } from './types';

const deck: Deck = { id: 'd', game: 'pokemon', name: 'Charizard ex', format: 'Standard', purpose: 'vs aggro', createdAt: '', updatedAt: '' };
const line = (cardId: string, qty: number) => ({ cardId, name: cardId.toUpperCase(), qty, section: 'main', set: 'PAL', number: '1' });
const changes: Change[] = [
  { id: 'c1', deckId: 'd', seq: 1, createdAt: '2026-11-01T00:00:00Z', lines: [line('a', 4)], tags: [], note: 'Imported', result: '' },
  { id: 'c2', deckId: 'd', seq: 2, createdAt: '2026-11-02T00:00:00Z', lines: [line('a', 3), line('b', 1)], tags: ['vs aggro'], note: 'more b', result: '3-1' },
];

describe('share links', () => {
  it('round-trips a deck with its history, compactly', async () => {
    const text = await encodeShare(packDeck(deck, changes, true));
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/); // safe in a URL
    const back = await decodeShare(text);
    expect(back).toMatchObject({ game: 'pokemon', name: 'Charizard ex', purpose: 'vs aggro' });
    expect(back.changes.map((c) => [c.note, c.tags, c.lines.length])).toEqual([['Imported', [], 1], ['more b', ['vs aggro'], 2]]);
    expect(back.changes[1].lines[1]).toEqual({ cardId: 'b', name: 'B', qty: 1, section: 'main', set: 'PAL', number: '1', category: undefined });
  });

  it('can leave the history out', async () => {
    const back = await decodeShare(await encodeShare(packDeck(deck, changes, false)));
    expect(back.changes.map((c) => c.note)).toEqual(['more b']);
  });

  it('rejects damaged or malicious links', async () => {
    await expect(decodeShare('not-a-link')).rejects.toThrow(/damaged/);
    const evil = await encodeShare({ v: 1, game: 'pokemon', name: 'x', changes: [{ at: '', tags: [], note: '', result: '', lines: [{ cardId: 'a', name: 'A', qty: -5, section: 'main' }] }] });
    await expect(decodeShare(evil)).rejects.toThrow(/not a valid deck/);
  });
});
