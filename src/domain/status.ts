import { cardTotals } from './decklist';
import { BINDER, type CopyRow, type DeckLine } from './types';

/**
 * Where the copies for one card slot come from. Computed, never stored.
 * inDeck + inBinder + sum(inOtherDecks) + missing === needed.
 */
export interface SlotStatus {
  cardId: string;
  needed: number;
  /** Owned copies already in this deck. */
  inDeck: number;
  /** Owned copies in the binder that could fill the slot. */
  inBinder: number;
  /** Owned copies sitting in other decks. */
  inOtherDecks: { deckId: string; qty: number }[];
  /** Copies the player does not own. */
  missing: number;
  /** Always available (basic Energy): never missing, never moved. */
  unlimited?: boolean;
}

export interface DeckSummary {
  needed: number;
  inDeck: number;
  inBinder: number;
  inOtherDecks: number;
  missing: number;
  /** Copies located in this deck that the list no longer uses. */
  extra: { cardId: string; qty: number }[];
}

/** Cards the player has an endless supply of (basic Energy), unless they track them. */
export type Unlimited = (cardId: string) => boolean;

/**
 * Slot status per card for one deck. `copies` must be the rows of that deck's game.
 * Copies in `locked` decks are counted last, so decks in rotation are named first.
 * `unlimited` cards count as in the deck, whatever copies are stored.
 */
export function slotStatuses(deckId: string, lines: DeckLine[], copies: CopyRow[], locked: Set<string> = new Set(), unlimited?: Unlimited): Map<string, SlotStatus> {
  const byCard = new Map<string, CopyRow[]>();
  for (const c of copies) {
    if (c.qty <= 0) continue;
    const rows = byCard.get(c.cardId);
    if (rows) rows.push(c);
    else byCard.set(c.cardId, [c]);
  }

  const out = new Map<string, SlotStatus>();
  for (const [cardId, needed] of cardTotals(lines)) {
    if (unlimited?.(cardId)) {
      out.set(cardId, { cardId, needed, inDeck: needed, inBinder: 0, inOtherDecks: [], missing: 0, unlimited: true });
      continue;
    }
    const rows = byCard.get(cardId) ?? [];
    let remaining = needed;
    const take = (available: number) => {
      const n = Math.min(remaining, available);
      remaining -= n;
      return n;
    };
    const inDeck = take(rows.find((r) => r.location === deckId)?.qty ?? 0);
    const inBinder = take(rows.find((r) => r.location === BINDER)?.qty ?? 0);
    const inOtherDecks: SlotStatus['inOtherDecks'] = [];
    const others = rows.filter((r) => r.location !== deckId && r.location !== BINDER);
    for (const r of [...others.filter((o) => !locked.has(o.location)), ...others.filter((o) => locked.has(o.location))]) {
      const qty = take(r.qty);
      if (qty > 0) inOtherDecks.push({ deckId: r.location, qty });
    }
    out.set(cardId, { cardId, needed, inDeck, inBinder, inOtherDecks, missing: remaining });
  }
  return out;
}

export function summarize(deckId: string, lines: DeckLine[], copies: CopyRow[], unlimited?: Unlimited): DeckSummary {
  const statuses = slotStatuses(deckId, lines, copies, undefined, unlimited);
  const s: DeckSummary = { needed: 0, inDeck: 0, inBinder: 0, inOtherDecks: 0, missing: 0, extra: [] };
  for (const st of statuses.values()) {
    s.needed += st.needed;
    s.inDeck += st.inDeck;
    s.inBinder += st.inBinder;
    s.inOtherDecks += st.inOtherDecks.reduce((n, o) => n + o.qty, 0);
    s.missing += st.missing;
  }
  for (const c of copies) {
    if (c.location !== deckId || c.qty <= 0 || statuses.get(c.cardId)?.unlimited) continue;
    const extra = c.qty - (statuses.get(c.cardId)?.needed ?? 0);
    if (extra > 0) s.extra.push({ cardId: c.cardId, qty: extra });
  }
  return s;
}
