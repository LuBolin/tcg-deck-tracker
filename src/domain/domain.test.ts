import { describe, expect, it } from 'vitest';
import { applyDeltas, emptyDeckDeltas, moveDeltas } from './collection';
import { applyDiff, diffLists, summarizeDiff } from './decklist';
import { parseList, splitArena, splitTrailingSetNumber } from './listParse';
import { slotStatuses, summarize } from './status';
import { BINDER, type Change, type CopyRow, type Deck, type DeckLine } from './types';
import { pendingParentChanges, deckTree } from './variants';
import { formatWantList, matchWant, parseWantList, tradeListKind, wantListGame } from './wantlist';

const line = (cardId: string, qty: number, section = 'main'): DeckLine => ({ cardId, name: cardId, qty, section });
const copy = (cardId: string, location: string, qty: number): CopyRow => ({ game: 'demo', cardId, location, qty });

describe('decklist', () => {
  it('diffs and summarizes a swap', () => {
    const d = diffLists([line('a', 4), line('c', 2)], [line('a', 2), line('b', 2), line('c', 2)]);
    expect(d.map((x) => [x.cardId, x.delta])).toEqual([
      ['a', -2],
      ['b', 2],
    ]);
    expect(summarizeDiff(d)).toBe('−2 a, +2 b');
  });

  it('applies a diff, removing cards that reach zero', () => {
    const diff = diffLists([line('a', 2)], [line('b', 1)]);
    expect(applyDiff([line('a', 2), line('z', 1)], diff, [line('b', 1)])).toEqual([line('z', 1), line('b', 1)]);
  });

  it('treats sections separately', () => {
    const d = diffLists([line('a', 2, 'main')], [line('a', 2, 'sideboard')]);
    expect(d.map((x) => [x.section, x.delta])).toEqual([
      ['main', -2],
      ['sideboard', 2],
    ]);
  });
});

describe('slot status', () => {
  it('fills from this deck, then binder, then other decks, then missing', () => {
    const copies = [copy('a', 'd1', 1), copy('a', BINDER, 1), copy('a', 'd2', 1)];
    const st = slotStatuses('d1', [line('a', 4)], copies).get('a')!;
    expect(st).toEqual({ cardId: 'a', needed: 4, inDeck: 1, inBinder: 1, inOtherDecks: [{ deckId: 'd2', qty: 1 }], missing: 1 });
  });

  it('counts main and sideboard copies together', () => {
    const st = slotStatuses('d1', [line('a', 2), line('a', 1, 'sideboard')], []).get('a')!;
    expect(st.needed).toBe(3);
    expect(st.missing).toBe(3);
  });

  it('reports copies a deck no longer uses as extra', () => {
    const s = summarize('d1', [line('a', 2)], [copy('a', 'd1', 3), copy('b', 'd1', 1)]);
    expect(s.extra).toEqual([
      { cardId: 'a', qty: 1 },
      { cardId: 'b', qty: 1 },
    ]);
    expect(s.missing).toBe(0);
  });
});

describe('collection', () => {
  it('moves copies and refuses to go below zero', () => {
    const rows = [copy('a', 'd1', 4)];
    expect(applyDeltas(rows, 'demo', moveDeltas('a', 'd1', 'd2', 2))).toEqual([copy('a', 'd1', 2), copy('a', 'd2', 2)]);
    expect(() => applyDeltas(rows, 'demo', moveDeltas('a', 'd1', 'd2', 5))).toThrow();
  });

  it('empties a deck into the binder', () => {
    const rows = [copy('a', 'd1', 2), copy('a', BINDER, 1)];
    expect(applyDeltas(rows, 'demo', emptyDeckDeltas(rows, 'd1'))).toEqual([copy('a', BINDER, 3)]);
  });
});

describe('list parsing', () => {
  const fmt = {
    header: (l: string) => (/^sideboard/i.test(l) ? 'sideboard' : /^(deck|pokémon|trainer|energy)/i.test(l) ? 'main' : /^total/i.test(l) ? 'ignore' : undefined),
    splitPrinting: (r: string) => splitArena(r) ?? splitTrailingSetNumber(r) ?? { name: r },
  };

  it('parses printed, plain and Arena lines with sections', () => {
    const r = parseList('Pokémon: 4\n4 Iono PAL 185\n3x Lightning Bolt\n2 Opt (XLN) 65 *F*\nSideboard\n1 Duress\nTotal Cards: 10\nnonsense', fmt);
    expect(r.lines.map((l) => [l.qty, l.name, l.set, l.number, l.section])).toEqual([
      [4, 'Iono', 'PAL', '185', 'main'],
      [3, 'Lightning Bolt', undefined, undefined, 'main'],
      [2, 'Opt', 'XLN', '65', 'main'],
      [1, 'Duress', undefined, undefined, 'sideboard'],
    ]);
    expect(r.errors).toEqual([{ lineNo: 8, raw: 'nonsense', section: 'sideboard' }]);
  });

  it('starts the sideboard after a blank line when the format says so', () => {
    const r = parseList('4 A\n\n2 B', { ...fmt, blankLineStartsSideboard: true });
    expect(r.lines.map((l) => l.section)).toEqual(['main', 'sideboard']);
  });
});

describe('want-lists', () => {
  const fmt = { header: () => undefined, splitPrinting: (r: string) => splitTrailingSetNumber(r) ?? { name: r } };

  it('round-trips through text', () => {
    const text = formatWantList(
      [{ qty: 2, name: 'Iono', set: 'PAL', number: '185', price: '$3.50' }, { qty: 1, name: 'Boss' }],
      (i) => [i.qty, i.name, i.set, i.number].filter(Boolean).join(' '),
      { contact: '@me', appName: 'App', gameName: 'Pokémon' },
    );
    expect(text).toContain('2 Iono PAL 185 @ $3.50');
    expect(wantListGame(text)).toBe('Pokémon');
    expect(tradeListKind(text)).toBe('buy');
    const sell = formatWantList([{ qty: 1, name: 'Iono', price: '$1' }], (i) => `${i.qty} ${i.name}`, { appName: 'App', gameName: 'Pokémon', kind: 'sell' });
    expect([sell.split('\n')[0], tradeListKind(sell), wantListGame(sell)]).toEqual(['Selling (Pokémon)', 'sell', 'Pokémon']);
    const { items } = parseWantList(text, fmt);
    expect(items.map((i) => [i.qty, i.name, i.set, i.price])).toEqual([
      [2, 'Iono', 'PAL', '$3.50'],
      [1, 'Boss', undefined, undefined],
    ]);
  });

  it('matches spare and in-deck copies', () => {
    const m = matchWant('a', 2, [copy('a', BINDER, 1), copy('a', 'd2', 3)]);
    expect(m).toEqual({ wanted: 2, spare: 1, inDecks: [{ location: 'd2', qty: 3 }] });
  });
});

describe('variants', () => {
  const deck = (id: string, parentDeckId?: string, parentChangeId?: string): Deck => ({
    id, game: 'demo', name: id, parentDeckId, parentChangeId, createdAt: '', updatedAt: '',
  });
  const change = (id: string, seq: number, lines: DeckLine[]): Change => ({
    id, deckId: 'p', seq, createdAt: '', lines, tags: [], note: '', result: '',
  });

  it('lists parent changes made after the variant was based', () => {
    const parent = [change('c1', 1, [line('a', 4)]), change('c2', 2, [line('a', 3), line('b', 1)]), change('c3', 3, [line('a', 3), line('b', 1)])];
    const pending = pendingParentChanges(deck('v', 'p', 'c1'), parent);
    expect(pending.map((p) => p.change.id)).toEqual(['c2']); // c3 changed no cards
    expect(summarizeDiff(pending[0].diff)).toBe('−1 a, +1 b');
  });

  it('builds variant trees', () => {
    const tree = deckTree([deck('b', 'a'), deck('a'), deck('c', 'b'), deck('orphan', 'gone')]);
    expect(tree.map((n) => n.deck.id)).toEqual(['a', 'orphan']);
    expect(tree[0].children[0].children[0].deck.id).toBe('c');
  });
});

describe('review fixes', async () => {
  const { parseRecord } = await import('./insights');
  const { parsePrice } = await import('./wantlist');
  it('does not read dates as match records', () => {
    expect(parseRecord('League 2026-11-12, went 3-1')).toMatchObject({ wins: 3, losses: 1 });
    expect(parseRecord('2026-11-12')).toBeUndefined();
  });
  it('reads prices with a currency sign or a decimal comma', () => {
    expect(parsePrice('$3.50')).toBe(3.5);
    expect(parsePrice('3,50 €')).toBe(3.5);
    expect(parsePrice('2 for $5')).toBe(5);
    expect(parsePrice('offer')).toBeUndefined();
  });
  it('keeps blank lines as spacing when a list has a sideboard header', () => {
    const fmt = { header: (l: string) => (/^sideboard/i.test(l) ? 'sideboard' : /^deck$/i.test(l) ? 'main' : undefined), splitPrinting: (r: string) => ({ name: r }), blankLineStartsSideboard: true };
    const r = parseList('Deck\n4 Bolt\n\n4 Swiftspear\n\nSideboard\n2 Pyroblast', fmt);
    expect(r.lines.map((l) => [l.name, l.section])).toEqual([['Bolt', 'main'], ['Swiftspear', 'main'], ['Pyroblast', 'sideboard']]);
  });
});

describe('set codes', () => {
  it('accepts codes starting with a digit, never a bare number', () => {
    expect(splitTrailingSetNumber('Zekrom 30C 56')).toEqual({ name: 'Zekrom', set: '30C', number: '56' });
    expect(splitTrailingSetNumber('Iono PAL 185')).toEqual({ name: 'Iono', set: 'PAL', number: '185' });
    expect(splitTrailingSetNumber('Some Card 12 34')).toBeUndefined();
  });
});

describe('unlimited cards', () => {
  it('count as in the deck, never missing, never extra, whatever copies exist', () => {
    const free = (id: string) => id === 'energy';
    const copies = [copy('energy', BINDER, 2), copy('energy', 'd1', 9)];
    const st = slotStatuses('d1', [line('energy', 12), line('a', 1)], copies, undefined, free);
    expect(st.get('energy')).toMatchObject({ inDeck: 12, inBinder: 0, missing: 0, unlimited: true });
    expect(st.get('a')).toMatchObject({ missing: 1 });
    expect(summarize('d1', [line('energy', 4)], copies, free).extra).toEqual([]);
  });
});

describe('version graph', async () => {
  const { deckFamily, versionGraph } = await import('./variants');
  const deck = (id: string, parentDeckId?: string, originChangeId?: string, createdAt = '2026-01-01'): Deck => ({ id, game: 'demo', name: id, parentDeckId, originChangeId, createdAt, updatedAt: createdAt });
  const ch = (id: string, deckId: string, seq: number, at: string, extra: Partial<Change> = {}): Change => ({ id, deckId, seq, createdAt: at, lines: [], tags: [], note: '', result: '', ...extra });
  it('lays out lanes, rows and edges for a family', () => {
    const decks = [deck('main'), deck('budget', 'main', 'm1', '2026-01-03'), deck('aggro', 'budget', undefined, '2026-01-05'), deck('other')];
    const changes = new Map([
      ['main', [ch('m1', 'main', 1, '2026-01-01'), ch('m2', 'main', 2, '2026-01-02'), ch('m3', 'main', 3, '2026-01-06')]],
      ['budget', [ch('b1', 'budget', 1, '2026-01-03'), ch('b2', 'budget', 2, '2026-01-07', { tags: ['from parent'], sourceChangeId: 'm3' })]],
      ['aggro', [ch('a1', 'aggro', 1, '2026-01-05')]],
    ]);
    const family = deckFamily(decks, 'aggro');
    expect(family.map((d) => d.id)).toEqual(['main', 'budget', 'aggro']);
    const g = versionGraph(family, changes);
    expect(g.nodes.map((n) => `${n.change.id}@${n.lane}`)).toEqual(['m1@0', 'm2@0', 'b1@1', 'a1@2', 'm3@0', 'b2@1']);
    const e = (kind: string) => g.edges.filter((x) => x.kind === kind).map((x) => `${x.from.change.id}>${x.to.change.id}`);
    expect(e('variant')).toEqual(['m1>b1', 'b1>a1']); // budget from its stored origin (m1, not the later m2); aggro by time
    expect(e('applied')).toEqual(['m3>b2']);
    expect(e('next')).toEqual(['m1>m2', 'm2>m3', 'b1>b2']);
  });
});
