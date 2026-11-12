import { cardTotals } from './decklist';
import type { SlotStatus } from './status';
import type { Card, DeckLine } from './types';

export interface DeckValue {
  /** Price of every card in the list. */
  total: number;
  /** Price of the copies the player does not own. */
  toComplete: number;
  /** Cards with no known price, so the totals are lower bounds. */
  unpriced: number;
}

export function deckValue(lines: DeckLine[], cards: Map<string, Card>, statuses: Map<string, SlotStatus>): DeckValue {
  const v: DeckValue = { total: 0, toComplete: 0, unpriced: 0 };
  for (const [cardId, qty] of cardTotals(lines)) {
    const price = cards.get(cardId)?.price;
    if (price === undefined) {
      v.unpriced += 1;
      continue;
    }
    v.total += price * qty;
    v.toComplete += price * (statuses.get(cardId)?.missing ?? 0);
  }
  return v;
}

/**
 * Cards known to be not legal in a format. Unknown legality is not reported.
 * `confirmed` (from a deeper adapter check) overrides the stored data.
 */
export function illegalCards(lines: DeckLine[], cards: Map<string, Card>, format: string | undefined, confirmed?: Map<string, boolean>): Set<string> {
  const out = new Set<string>();
  if (!format) return out;
  const f = format.toLowerCase();
  for (const cardId of cardTotals(lines).keys()) {
    const checked = confirmed?.get(cardId);
    const stored = cards.get(cardId)?.legal;
    const legal = checked ?? (stored ? stored.includes(f) : undefined);
    if (legal === false) out.add(cardId);
  }
  return out;
}

/** Copies per cost (mana value), main deck only, skipping cards without a cost or in `skipCategories`. */
export function costCurve(lines: DeckLine[], cards: Map<string, Card>, skipCategories: string[] = []): { cost: number; qty: number }[] {
  const byCost = new Map<number, number>();
  for (const l of lines) {
    if (l.section !== 'main' || (l.category && skipCategories.includes(l.category))) continue;
    const cost = cards.get(l.cardId)?.cost;
    if (cost === undefined) continue;
    const bucket = Math.min(Math.floor(cost), 7); // 7 means "7 or more"
    byCost.set(bucket, (byCost.get(bucket) ?? 0) + l.qty);
  }
  if (byCost.size === 0) return [];
  return Array.from({ length: 8 }, (_, cost) => ({ cost, qty: byCost.get(cost) ?? 0 }));
}

export const formatUsd = (n: number) => `$${n.toFixed(2)}`;

export interface MatchRecord { wins: number; losses: number; draws: number; events: number }

/** Win-loss from result text such as "3-1 vs Gardevoir" or "2-2-1". Text without a record counts for nothing. */
export function parseRecord(result: string): MatchRecord | undefined {
  const m = /(?<![\d-])(\d{1,2})\s*-\s*(\d{1,2})(?:\s*-\s*(\d{1,2}))?(?![\d-])/.exec(result);
  return m ? { wins: Number(m[1]), losses: Number(m[2]), draws: Number(m[3] ?? 0), events: 1 } : undefined;
}

export function totalRecord(results: string[]): MatchRecord {
  const total: MatchRecord = { wins: 0, losses: 0, draws: 0, events: 0 };
  for (const r of results) {
    const p = parseRecord(r);
    if (!p) continue;
    total.wins += p.wins;
    total.losses += p.losses;
    total.draws += p.draws;
    total.events += 1;
  }
  return total;
}

export const formatRecord = (r: MatchRecord) => `${r.wins}-${r.losses}${r.draws ? `-${r.draws}` : ''}`;

/** The priciest non-basic card with art: usually the card the deck is built around. */
export function coverArt(lines: DeckLine[], cards: Map<string, Card>): string | undefined {
  return lines
    .map((l) => cards.get(l.cardId))
    .filter((c): c is Card => !!c?.imageUrl && c.category !== 'Energy' && c.category !== 'Land')
    .sort((a, b) => (b.price ?? 0) - (a.price ?? 0))[0]?.imageUrl;
}

/**
 * Chance of drawing at least one of `copies` cards in a `hand`-card draw from a `deck`-card deck
 * (hypergeometric: 1 - P(none)).
 */
export function chanceInHand(deck: number, copies: number, hand: number): number {
  if (copies <= 0 || deck <= 0) return 0;
  if (copies >= deck || hand >= deck) return 1;
  let none = 1;
  for (let i = 0; i < hand; i++) none *= (deck - copies - i) / (deck - i);
  return 1 - Math.max(0, none);
}
