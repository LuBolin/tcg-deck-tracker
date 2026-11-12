import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LocalRepository } from '../data/localRepository';
import { summarizeDiff } from '../domain/decklist';
import { summarize } from '../domain/status';
import { BINDER, type DeckLine } from '../domain/types';
import { pendingParentChanges } from '../domain/variants';
import { applyParentChange, createDeck, deleteDeck, duplicateDeck, gatherFrom, latestLines, movedCount, revertDeltas, makeVariant, moveCopies, pullFromBinder, saveChange } from './actions';

const line = (cardId: string, qty: number): DeckLine => ({ cardId, name: cardId, qty, section: 'main' });

describe('deck use cases on the local repository', () => {
  it('imports, varies, syncs from parent, and keeps copies safe on delete', async () => {
    const repo = new LocalRepository('test-flow');

    // Import a deck; the player owns 3 of 4 "a" and all "b".
    const main = await createDeck(repo, { game: 'demo', name: 'Main', lines: [line('a', 4), line('b', 2)], owned: new Map([['a', 3], ['b', 2]]) });
    let s = summarize(main.id, await latestLines(repo, main.id), await repo.listCopies('demo'));
    expect([s.needed, s.inDeck, s.missing]).toEqual([6, 5, 1]);

    // A variant shares the same physical copies: they show as "in another deck".
    const variant = await makeVariant(repo, main, 'Anti-aggro');
    s = summarize(variant.id, await latestLines(repo, variant.id), await repo.listCopies('demo'));
    expect([s.inDeck, s.inOtherDecks, s.missing]).toEqual([0, 5, 1]);

    // The parent changes; the variant sees one pending change and applies it.
    await saveChange(repo, main, [line('a', 3), line('c', 1), line('b', 2)], { tags: ['meta shift'], note: 'more c' });
    const pending = pendingParentChanges((await repo.getDeck(variant.id))!, await repo.listChanges(main.id));
    expect(pending.map((p) => summarizeDiff(p.diff))).toEqual(['−1 a, +1 c']);
    await applyParentChange(repo, variant, main.name, pending[0]);
    const v2 = (await repo.getDeck(variant.id))!;
    expect(pendingParentChanges(v2, await repo.listChanges(main.id))).toEqual([]);
    expect((await latestLines(repo, variant.id)).find((l) => l.cardId === 'c')?.qty).toBe(1);

    // Move copies into the variant, then delete it: they return to the binder.
    await moveCopies(repo, 'demo', 'b', main.id, variant.id, 2);
    await deleteDeck(repo, v2);
    const copies = await repo.listCopies('demo');
    expect(copies.find((c) => c.cardId === 'b' && c.location === BINDER)?.qty).toBe(2);
    expect(await repo.listChanges(variant.id)).toEqual([]);

    // Pull the binder copies back into Main.
    expect(await pullFromBinder(repo, main, await latestLines(repo, main.id))).toBe(1);

    // Data survives a reload from IndexedDB.
    const reloaded = new LocalRepository('test-flow');
    expect((await reloaded.listDecks()).map((d) => d.name)).toEqual(['Main']);
    expect((await reloaded.listCopies('demo')).find((c) => c.cardId === 'b')?.location).toBe(main.id);
  });

  it('rejects a move that would go below zero and changes nothing', async () => {
    const repo = new LocalRepository('test-negative');
    await repo.adjustCopies('demo', [{ cardId: 'a', location: BINDER, delta: 1 }]);
    await expect(moveCopies(repo, 'demo', 'a', BINDER, 'd1', 2)).rejects.toThrow();
    expect(await repo.listCopies('demo')).toEqual([{ game: 'demo', cardId: 'a', location: BINDER, qty: 1 }]);
  });

  it('gathers the cards of a deck from one other deck only', async () => {
    const repo = new LocalRepository('test-gather');
    const a = await createDeck(repo, { game: 'demo', name: 'A', lines: [line('x', 4), line('y', 2)], owned: new Map([['x', 4], ['y', 2]]) });
    const b = await createDeck(repo, { game: 'demo', name: 'B', lines: [line('x', 3), line('y', 1)] });
    await repo.adjustCopies('demo', [{ cardId: 'y', location: BINDER, delta: 1 }]);
    const deltas = await gatherFrom(repo, b, await latestLines(repo, b.id), a.id);
    expect(movedCount(deltas)).toBe(3); // y comes from the binder first
    const s = summarize(b.id, await latestLines(repo, b.id), await repo.listCopies('demo'));
    expect([s.inDeck, s.inBinder, s.missing]).toEqual([3, 1, 0]);
    await revertDeltas(repo, 'demo', deltas);
    expect(summarize(b.id, await latestLines(repo, b.id), await repo.listCopies('demo')).inDeck).toBe(0);
  });

  it('keeps writes from two tabs (two instances) instead of letting the last save win', async () => {
    const tabA = new LocalRepository('test-two-tabs');
    const tabB = new LocalRepository('test-two-tabs');
    await tabA.listDecks(); // tab A now holds a cached copy
    await tabB.adjustCopies('demo', [{ cardId: 'b', location: BINDER, delta: 2 }]);
    await tabA.adjustCopies('demo', [{ cardId: 'a', location: BINDER, delta: 1 }]); // must not overwrite tab B's copies
    const fresh = new LocalRepository('test-two-tabs');
    expect((await fresh.listCopies('demo')).map((c) => `${c.cardId}:${c.qty}`).sort()).toEqual(['a:1', 'b:2']);
    // A failed write (not enough copies) saves nothing.
    await expect(tabA.adjustCopies('demo', [{ cardId: 'a', location: BINDER, delta: -5 }])).rejects.toThrow();
    expect((await fresh.listCopies('demo')).length).toBe(2);
  });

  it('refuses to skip a parent change and refuses stale draft saves', async () => {
    const repo = new LocalRepository('test-guards');
    const parent = await createDeck(repo, { game: 'demo', name: 'P', lines: [line('a', 4)] });
    const variant = await makeVariant(repo, parent, 'V');
    await saveChange(repo, parent, [line('a', 4), line('x', 1)], { note: 'c2' });
    await saveChange(repo, parent, [line('a', 4), line('x', 1), line('y', 1)], { note: 'c3' });
    const pending = pendingParentChanges((await repo.getDeck(variant.id))!, await repo.listChanges(parent.id));
    expect(pending.map((p) => p.change.note)).toEqual(['c2', 'c3']);
    await expect(applyParentChange(repo, variant, 'P', pending[1])).rejects.toThrow(/older parent change/);
    await applyParentChange(repo, variant, 'P', pending[0]);
    const after = pendingParentChanges((await repo.getDeck(variant.id))!, await repo.listChanges(parent.id));
    expect(after.map((p) => p.change.note)).toEqual(['c3']);

    // A draft opened at change 1 must not overwrite change 2.
    const base = (await repo.listChanges(variant.id)).at(-2)!.seq;
    await expect(saveChange(repo, variant, [line('a', 1)], {}, { baseSeq: base })).rejects.toThrow(/changed after you started/);
    expect((await latestLines(repo, variant.id)).some((l) => l.cardId === 'x')).toBe(true);
  });

  it('keeps fields changed elsewhere when saving with an old deck object', async () => {
    const repo = new LocalRepository('test-stale-deck');
    const deck = await createDeck(repo, { game: 'demo', name: 'Old name', lines: [line('a', 1)] });
    await repo.putDeck({ ...deck, name: 'New name' }); // renamed in another tab
    await saveChange(repo, deck, [line('a', 2)], {}); // this tab still holds the old object
    expect((await repo.getDeck(deck.id))!.name).toBe('New name');
  });

  it('duplicates a deck without a parent link and without moving copies', async () => {
    const repo = new LocalRepository('test-duplicate');
    const deck = await createDeck(repo, { game: 'demo', name: 'D', lines: [line('a', 2)], owned: new Map([['a', 2]]) });
    const copy = await duplicateDeck(repo, deck, 'D copy');
    expect((await repo.getDeck(copy.id))!.parentDeckId).toBeUndefined();
    expect((await latestLines(repo, copy.id)).map((l) => [l.cardId, l.qty])).toEqual([['a', 2]]);
    expect((await repo.listCopies('demo')).map((c) => c.location)).toEqual([deck.id]);
  });
});


describe('taking cards out, archiving and locked decks', async () => {
  const { takeOut, setLineQty, archiveDeck } = await import('./actions');
  const { slotStatuses } = await import('../domain/status');

  it('takes out keeping the list (3/4), then trims the list; or removes in one step', async () => {
    const repo = new LocalRepository('test-takeout');
    const deck = await createDeck(repo, { game: 'demo', name: 'D', lines: [line('crustle', 4), line('b', 2)], owned: new Map([['crustle', 4], ['b', 2]]) });
    const crustle = (await latestLines(repo, deck.id))[0];

    await takeOut(repo, deck, crustle, 1, false);
    let st = slotStatuses(deck.id, await latestLines(repo, deck.id), await repo.listCopies('demo')).get('crustle')!;
    expect([st.needed, st.inDeck, st.inBinder]).toEqual([4, 3, 1]);

    await setLineQty(repo, deck, crustle, 3);
    st = slotStatuses(deck.id, await latestLines(repo, deck.id), await repo.listCopies('demo')).get('crustle')!;
    expect([st.needed, st.inDeck]).toEqual([3, 3]);

    const b = (await latestLines(repo, deck.id)).find((l) => l.cardId === 'b')!;
    await takeOut(repo, deck, b, 2, true);
    expect((await latestLines(repo, deck.id)).map((l) => l.cardId)).toEqual(['crustle']);
    expect((await repo.listChanges(deck.id)).at(-1)!.tags).toEqual(['removed']);
    expect((await repo.listCopies('demo')).find((c) => c.cardId === 'b')).toMatchObject({ location: BINDER, qty: 2 });
  });

  it('archives a deck into the binder, keeping its list', async () => {
    const repo = new LocalRepository('test-archive');
    const deck = await createDeck(repo, { game: 'demo', name: 'D', lines: [line('a', 2)], owned: new Map([['a', 2]]) });
    expect(movedCount(await archiveDeck(repo, deck))).toBe(2);
    expect((await repo.listCopies('demo')).map((c) => [c.location, c.qty])).toEqual([[BINDER, 2]]);
    expect(await latestLines(repo, deck.id)).toHaveLength(1);
  });

  it('names decks in rotation before locked decks', () => {
    const copies = [{ game: 'demo', cardId: 'a', location: 'locked', qty: 2 }, { game: 'demo', cardId: 'a', location: 'open', qty: 2 }];
    const st = slotStatuses('me', [line('a', 3)], copies, new Set(['locked'])).get('a')!;
    expect(st.inOtherDecks).toEqual([{ deckId: 'open', qty: 2 }, { deckId: 'locked', qty: 1 }]);
  });
});

describe('printing labels', () => {
  it('are set, cleared, kept in backups and accepted from older backups without them', async () => {
    const repo = new LocalRepository('test-prints');
    const p = { game: 'pokemon', cardId: 'pokemon:crustle:x', printId: 'sv10-186', qty: 1, rarity: 'Illustration rare', set: 'DRI', number: '186' };
    await repo.setPrint(p);
    await repo.setPrint({ ...p, printId: 'sv10-012', qty: 2, rarity: 'Rare' });
    await repo.setPrint({ ...p, qty: 0 });
    expect((await repo.listPrints('pokemon')).map((r) => [r.printId, r.qty])).toEqual([['sv10-012', 2]]);
    await expect(repo.setPrint({ ...p, qty: -1 })).rejects.toThrow();
    const backup = await repo.exportAll();
    expect(backup.prints).toHaveLength(1);
    await repo.importAll({ version: 1, decks: [], changes: [], copies: [], cards: [] });
    expect(await repo.listPrints('pokemon')).toEqual([]);
    await repo.importAll(backup);
    expect(await repo.listPrints('pokemon')).toHaveLength(1);
  });
});
