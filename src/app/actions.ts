import { emptyDeckDeltas, moveDeltas } from '../domain/collection';
import { applyDiff, normalizeLines } from '../domain/decklist';
import { slotStatuses, summarize } from '../domain/status';
import { BINDER, type CopyDelta, type Deck, type DeckLine, type Location } from '../domain/types';
import type { SharedDeck } from '../domain/share';
import { pendingParentChanges, type PendingParentChange } from '../domain/variants';
import type { Repository } from '../data/repository';
import type { GameAdapter } from '../games/types';
import { stamp } from './cardData';
import { unlimitedFor } from './supply';

/** Use cases. Each one combines domain rules with repository calls. */

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

export interface ChangeInfo {
  tags?: string[];
  note?: string;
  result?: string;
  /** The parent change this one copies (applied parent changes). */
  sourceChangeId?: string;
}

export async function latestLines(repo: Repository, deckId: string): Promise<DeckLine[]> {
  const changes = await repo.listChanges(deckId);
  return changes.at(-1)?.lines ?? [];
}

/**
 * Create a deck from imported lines. `owned` says how many copies of each card the
 * player owns that are not in the app yet; those copies are put in the new deck.
 */
export async function createDeck(
  repo: Repository,
  input: { game: string; name: string; format?: string; lines: DeckLine[]; owned?: Map<string, number> },
): Promise<Deck> {
  const t = now();
  const deck: Deck = { id: uid(), game: input.game, name: input.name.trim() || 'Untitled deck', format: input.format, createdAt: t, updatedAt: t };
  await repo.putDeck(deck);
  await repo.addChange({ id: uid(), deckId: deck.id, seq: 1, createdAt: t, lines: normalizeLines(input.lines), tags: [], note: 'Imported', result: '' });
  const deltas: CopyDelta[] = [...(input.owned ?? [])]
    .filter(([, qty]) => qty > 0)
    .map(([cardId, qty]) => ({ cardId, location: deck.id, delta: qty }));
  if (deltas.length) await repo.adjustCopies(deck.game, deltas);
  return deck;
}

/**
 * Save a new version of the list. `baseSeq` is the change the edit started from: if the deck
 * changed since (another tab, an applied parent change), the save is refused so nothing is undone.
 * `patch` sets deck fields in the same save.
 */
export async function saveChange(
  repo: Repository,
  deck: Deck,
  lines: DeckLine[],
  info: ChangeInfo,
  opts: { baseSeq?: number; patch?: Partial<Deck> } = {},
): Promise<void> {
  const changes = await repo.listChanges(deck.id);
  const latest = changes.at(-1)?.seq ?? 0;
  if (opts.baseSeq !== undefined && opts.baseSeq !== latest) {
    throw new Error('This deck changed after you started editing (another tab, or a parent change was applied). Your edits are still here: note them, press Cancel, and edit again.');
  }
  const t = now();
  await repo.addChange({
    id: uid(),
    deckId: deck.id,
    seq: latest + 1,
    createdAt: t,
    lines: normalizeLines(lines),
    tags: info.tags ?? [],
    note: info.note?.trim() ?? '',
    result: info.result?.trim() ?? '',
    ...(info.sourceChangeId ? { sourceChangeId: info.sourceChangeId } : {}),
  });
  await updateDeck(repo, deck.id, { ...opts.patch, updatedAt: t });
}

/** Change some deck fields, starting from the stored deck so fields edited elsewhere are kept. */
export async function updateDeck(repo: Repository, deckId: string, patch: Partial<Deck>): Promise<void> {
  const current = await repo.getDeck(deckId);
  if (!current) throw new Error('This deck no longer exists.');
  await repo.putDeck({ ...current, ...patch, updatedAt: patch.updatedAt ?? now() });
}

/** Parent changes must be taken in order; refuse anything but the oldest pending one. */
async function assertOldestPending(repo: Repository, variant: Deck, p: PendingParentChange): Promise<Deck> {
  const fresh = (await repo.getDeck(variant.id)) ?? variant;
  const pending = fresh.parentDeckId ? pendingParentChanges(fresh, await repo.listChanges(fresh.parentDeckId)) : [];
  if (pending[0]?.change.id !== p.change.id) throw new Error('Apply or dismiss the older parent change first.');
  return fresh;
}

/** Copy a deck into a variant that remembers where it came from. Copies stay where they are. */
/** A variant of `parent`, made from its latest version or from an older one (`fromSeq`). */
export async function makeVariant(repo: Repository, parent: Deck, name: string, labels: string[] = [], fromSeq?: number): Promise<Deck> {
  const changes = await repo.listChanges(parent.id);
  const base = fromSeq === undefined ? changes.at(-1) : changes.find((c) => c.seq === fromSeq);
  if (fromSeq !== undefined && !base) throw new Error(`${parent.name} has no change ${fromSeq}`);
  const t = now();
  const variant: Deck = {
    id: uid(),
    game: parent.game,
    name: name.trim() || `${parent.name} variant`,
    format: parent.format,
    labels: labels.length ? labels : undefined,
    parentDeckId: parent.id,
    parentChangeId: base?.id,
    originChangeId: base?.id,
    createdAt: t,
    updatedAt: t,
  };
  await repo.putDeck(variant);
  await repo.addChange({ id: uid(), deckId: variant.id, seq: 1, createdAt: t, lines: base?.lines ?? [], tags: [], note: `Made from ${parent.name}${fromSeq !== undefined ? `, change ${fromSeq}` : ''}`, result: '' });
  return variant;
}

export async function applyParentChange(repo: Repository, variant: Deck, parentName: string, p: PendingParentChange): Promise<void> {
  const fresh = await assertOldestPending(repo, variant, p);
  const lines = applyDiff(await latestLines(repo, fresh.id), p.diff, p.change.lines);
  await saveChange(repo, fresh, lines, { tags: ['from parent'], note: `From ${parentName}, change ${p.change.seq}${p.change.note ? `: ${p.change.note}` : ''}`, sourceChangeId: p.change.id }, { patch: { parentChangeId: p.change.id } });
}

export async function dismissParentChange(repo: Repository, variant: Deck, p: PendingParentChange): Promise<void> {
  await assertOldestPending(repo, variant, p);
  await updateDeck(repo, variant.id, { parentChangeId: p.change.id });
}

/**
 * Delete a deck. The repository moves its copies to the binder in the same write, so no owned
 * card is lost. Its variants become standalone decks.
 */
export async function deleteDeck(repo: Repository, deck: Deck): Promise<void> {
  for (const d of await repo.listDecks()) {
    if (d.parentDeckId === deck.id) await updateDeck(repo, d.id, { parentDeckId: undefined, parentChangeId: undefined });
  }
  await repo.deleteDeck(deck.id);
}

export function moveCopies(repo: Repository, game: string, cardId: string, from: Location, to: Location, qty: number) {
  return repo.adjustCopies(game, moveDeltas(cardId, from, to, qty));
}

/**
 * Move copies of a card from the deck to the binder. With `updateList`, the deck's list also needs
 * that many fewer (one change); without it, the list still needs them and the card shows short (3/4).
 */
export async function takeOut(repo: Repository, deck: Deck, line: DeckLine, qty: number, updateList: boolean): Promise<CopyDelta[]> {
  const deltas = moveDeltas(line.cardId, deck.id, BINDER, qty);
  if (updateList) {
    const changes = await repo.listChanges(deck.id);
    const lines = (changes.at(-1)?.lines ?? []).map((l) => (l.cardId === line.cardId && l.section === line.section ? { ...l, qty: l.qty - qty } : l));
    // List first: if it fails (deck changed elsewhere), no copy has moved.
    await saveChange(repo, deck, lines.filter((l) => l.qty > 0), { tags: ['removed'], note: `Took out ${qty} ${line.name}` }, { baseSeq: changes.at(-1)?.seq ?? 0 });
  }
  if (deltas.length) await repo.adjustCopies(deck.game, deltas);
  return deltas;
}

/** Change how many copies of a line the list needs, for example down to the copies still in the deck. */
export async function setLineQty(repo: Repository, deck: Deck, line: DeckLine, qty: number): Promise<void> {
  const changes = await repo.listChanges(deck.id);
  const lines = (changes.at(-1)?.lines ?? []).map((l) => (l.cardId === line.cardId && l.section === line.section ? { ...l, qty } : l));
  await saveChange(repo, deck, lines.filter((l) => l.qty > 0), { tags: ['removed'], note: qty ? `Needs ${qty} ${line.name} now` : `Removed ${line.name}` }, { baseSeq: changes.at(-1)?.seq ?? 0 });
}

/** Show and export another printing of a card in this deck. Copies count the same whatever the printing. */
export async function setPrinting(repo: Repository, deck: Deck, line: DeckLine, p: { set?: string; number?: string; rarity?: string; imageUrl?: string }): Promise<void> {
  const changes = await repo.listChanges(deck.id);
  const lines = (changes.at(-1)?.lines ?? []).map((l) => (l.cardId === line.cardId ? { ...l, set: p.set, number: p.number, imageUrl: p.imageUrl } : l));
  const label = [p.set, p.number].filter(Boolean).join(' ');
  await saveChange(repo, deck, lines, { note: `${line.name}: printing ${label}${p.rarity ? ` (${p.rarity})` : ''}` }, { baseSeq: changes.at(-1)?.seq ?? 0 });
}

/** Send every copy in the deck back to the binder. The list and history stay, so the deck shows under Empty decks. */
export async function archiveDeck(repo: Repository, deck: Deck): Promise<CopyDelta[]> {
  const deltas = emptyDeckDeltas(await repo.listCopies(deck.game), deck.id);
  if (deltas.length) await repo.adjustCopies(deck.game, deltas);
  return deltas;
}

/** Add copies the player owns to a location, or remove them (negative qty). */
export function addCopies(repo: Repository, game: string, cardId: string, location: Location, qty: number) {
  return repo.adjustCopies(game, [{ cardId, location, delta: qty }]);
}

/** Move every binder copy this deck can use into the deck. */
export async function pullFromBinder(repo: Repository, deck: Deck, lines: DeckLine[]): Promise<number> {
  const statuses = slotStatuses(deck.id, lines, await repo.listCopies(deck.game), undefined, unlimitedFor(deck.game));
  const deltas = [...statuses.values()].flatMap((s) => moveDeltas(s.cardId, BINDER, deck.id, s.inBinder));
  if (deltas.length) await repo.adjustCopies(deck.game, deltas);
  return deltas.length / 2;
}

/** Move copies the deck no longer uses back to the binder. */
export async function returnExtras(repo: Repository, deck: Deck, lines: DeckLine[]): Promise<number> {
  const { extra } = summarize(deck.id, lines, await repo.listCopies(deck.game), unlimitedFor(deck.game));
  const deltas = extra.flatMap((e) => moveDeltas(e.cardId, deck.id, BINDER, e.qty));
  if (deltas.length) await repo.adjustCopies(deck.game, deltas);
  return extra.length;
}

/**
 * Look the deck's cards up again (prices, legality, images change over time) and cache them.
 * Returns how many cards were updated.
 */
export async function refreshCardData(repo: Repository, adapter: GameAdapter, lines: DeckLine[]): Promise<number> {
  const parsed = lines.map((l, i) => ({ lineNo: i + 1, raw: '', qty: l.qty, name: l.name, set: l.set, number: l.number, section: l.section }));
  const resolved = await adapter.resolve(parsed);
  // Keep the deck's own card ids: a printing lookup must not re-point a line to another card.
  const cards = resolved.flatMap((r, i) => (r.card && r.card.id === lines[i].cardId ? [r.card] : []));
  if (cards.length) await repo.putCards(stamp(cards));
  return cards.length;
}

/** Move every copy this deck can use from one place (the binder or another deck) into it. Returns the changes made. */
export async function gatherFrom(repo: Repository, deck: Deck, lines: DeckLine[], from: Location): Promise<CopyDelta[]> {
  const statuses = slotStatuses(deck.id, lines, await repo.listCopies(deck.game), undefined, unlimitedFor(deck.game));
  const deltas = [...statuses.values()].flatMap((s) => {
    const qty = from === BINDER ? s.inBinder : s.inOtherDecks.find((o) => o.deckId === from)?.qty ?? 0;
    return moveDeltas(s.cardId, from, deck.id, qty);
  });
  if (deltas.length) await repo.adjustCopies(deck.game, deltas);
  return deltas;
}

/** Undo copy changes. Fails without changing anything if the copies have moved since. */
export function revertDeltas(repo: Repository, game: string, deltas: CopyDelta[]) {
  return repo.adjustCopies(game, deltas.map((d) => ({ ...d, delta: -d.delta })));
}

export const movedCount = (deltas: CopyDelta[]) => deltas.reduce((n, d) => n + Math.max(0, d.delta), 0);

/** Save a deck someone shared, with its history and reasons. No copies are added: the cards show as missing or owned elsewhere. */
export async function importShared(repo: Repository, shared: SharedDeck): Promise<Deck> {
  const t = now();
  const deck: Deck = { id: uid(), game: shared.game, name: shared.name, format: shared.format, purpose: shared.purpose, createdAt: t, updatedAt: t };
  await repo.putDeck(deck);
  let seq = 0;
  for (const c of shared.changes) {
    const at = Number.isNaN(Date.parse(c.at)) ? t : new Date(c.at).toISOString();
    await repo.addChange({ id: uid(), deckId: deck.id, seq: ++seq, createdAt: at, lines: normalizeLines(c.lines), tags: c.tags, note: c.note, result: c.result });
  }
  return deck;
}

/** An independent copy of a deck's current list (no parent link, fresh history). Copies stay where they are. */
export async function duplicateDeck(repo: Repository, deck: Deck, name: string): Promise<Deck> {
  const lines = await latestLines(repo, deck.id);
  const copy = await createDeck(repo, { game: deck.game, name, format: deck.format, lines });
  await updateDeck(repo, copy.id, { purpose: deck.purpose, labels: deck.labels });
  return copy;
}
