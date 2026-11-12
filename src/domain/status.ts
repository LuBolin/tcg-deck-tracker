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

/** Slot status per card for one deck. `copies` must be the rows of that deck's game. */
export function slotStatuses(deckId: string, lines: DeckLine[], copies: CopyRow[]): Map<string, SlotStatus> {
  const byCard = new Map<string, CopyRow[]>();
  for (const c of copies) {
    if (c.qty <= 0) continue;
    const rows = byCard.get(c.cardId);
    if (rows) rows.push(c);
    else byCard.set(c.cardId, [c]);
  }

  const out = new Map<string, SlotStatus>();
  for (const [cardId, needed] of cardTotals(lines)) {
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
    for (const r of rows) {
      if (r.location === deckId || r.location === BINDER) continue;
      const qty = take(r.qty);
      if (qty > 0) inOtherDecks.push({ deckId: r.location, qty });
    }
    out.set(cardId, { cardId, needed, inDeck, inBinder, inOtherDecks, missing: remaining });
  }
  return out;
}

export function summarize(deckId: string, lines: DeckLine[], copies: CopyRow[]): DeckSummary {
  const statuses = slotStatuses(deckId, lines, copies);
  const s: DeckSummary = { needed: 0, inDeck: 0, inBinder: 0, inOtherDecks: 0, missing: 0, extra: [] };
  for (const st of statuses.values()) {
    s.needed += st.needed;
    s.inDeck += st.inDeck;
    s.inBinder += st.inBinder;
    s.inOtherDecks += st.inOtherDecks.reduce((n, o) => n + o.qty, 0);
    s.missing += st.missing;
  }
  for (const c of copies) {
    if (c.location !== deckId || c.qty <= 0) continue;
    const extra = c.qty - (statuses.get(c.cardId)?.needed ?? 0);
    if (extra > 0) s.extra.push({ cardId: c.cardId, qty: extra });
  }
  return s;
}
