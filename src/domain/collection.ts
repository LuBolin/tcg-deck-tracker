import { BINDER, type CopyDelta, type CopyRow, type Location } from './types';

/** Copies of one card per location, largest first. */
export function locationsOf(copies: CopyRow[], cardId: string): { location: Location; qty: number }[] {
  return copies
    .filter((c) => c.cardId === cardId && c.qty > 0)
    .map(({ location, qty }) => ({ location, qty }))
    .sort((a, b) => b.qty - a.qty);
}

export function ownedTotal(copies: CopyRow[], cardId: string): number {
  return copies.reduce((n, c) => (c.cardId === cardId ? n + c.qty : n), 0);
}

export function moveDeltas(cardId: string, from: Location, to: Location, qty: number): CopyDelta[] {
  if (qty <= 0 || from === to) return [];
  return [
    { cardId, location: from, delta: -qty },
    { cardId, location: to, delta: qty },
  ];
}

/** Move every copy located in a deck back to the binder (used before deleting a deck). */
export function emptyDeckDeltas(copies: CopyRow[], deckId: string): CopyDelta[] {
  return copies
    .filter((c) => c.location === deckId && c.qty > 0)
    .flatMap((c) => moveDeltas(c.cardId, deckId, BINDER, c.qty));
}

/**
 * Apply deltas to rows. Throws if any location would go below zero, so a bad move
 * never destroys copies.
 */
export function applyDeltas(rows: CopyRow[], game: string, deltas: CopyDelta[]): CopyRow[] {
  const map = new Map(rows.map((r) => [`${r.cardId}|${r.location}`, { ...r }]));
  for (const d of deltas) {
    const k = `${d.cardId}|${d.location}`;
    const row = map.get(k) ?? { game, cardId: d.cardId, location: d.location, qty: 0 };
    row.qty += d.delta;
    if (row.qty < 0) throw new Error(`Not enough copies of ${d.cardId} at ${d.location}`);
    map.set(k, row);
  }
  return [...map.values()].filter((r) => r.qty > 0);
}
