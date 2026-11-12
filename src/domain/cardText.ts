import type { Card } from './types';

/**
 * Card roles ("draw", "removal", "aoe") and fuzzy search over rules text, for every game.
 * Tags are computed from the card's text and type, never stored, so new rules apply to old cards.
 */

/** A role tag: it applies when any phrase matches the card's text, or `test` says so. */
export interface TagRule {
  tag: string;
  /** Short phrases, matched loosely: "draw card" matches "draws 2 cards" and "draw a card". */
  phrases?: string[];
  test?: (card: Card) => boolean;
  /** Phrases that rule the tag out, for look-alikes ("switch" vs switching the opponent's Pokémon). */
  not?: string[];
}

const STOP = new Set(['a', 'an', 'the', 'of', 'to', 'from', 'your', 'you', 'their', 'its', 'it', 'that', 'this', 'and', 'or', 'for', 'in', 'on', 'up', 'with', 'is', 'are', 'be', 'may', 'can', 'one', 'two', 'three', 'x']);

/** Crude English stemmer: enough that "draws", "drawing" and "drawn" meet "draw". */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/'s$/, '');
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  for (const end of ['ing', 'ed', 'es', 's', 'n']) {
    if (w.endsWith(end) && w.length - end.length >= 3 && !(end === 's' && w.endsWith('ss')) && !(end === 'n' && !w.endsWith('wn'))) {
      w = w.slice(0, -end.length);
      break;
    }
  }
  return w;
}

/** Stemmed words of a text, numbers and stop words dropped. */
export function terms(text: string): string[] {
  // NFD + strip accents so "Pokémon" reads as "pokemon".
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w)).map(stem);
}

/** At most one edit (insert, delete, change, swap) apart: catches typos like "dsicard". */
function nearlyEqual(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  // Two neighbouring letters swapped ("dsicard") counts as one edit too.
  const diff = [...a].flatMap((ch, i) => (ch !== b[i] ? [i] : []));
  if (a.length === b.length && diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]) return true;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const termMatches = (q: string, t: string) => q === t || (q.length >= 4 && t.startsWith(q)) || (q.length >= 5 && nearlyEqual(q, t));

/**
 * How well a query matches a text: 0 = no match. Every query term must appear; terms close
 * together score higher. `window` (in words) makes it a phrase match instead.
 */
export function textScore(query: string, text: string, window?: number): number {
  const q = terms(query);
  if (q.length === 0) return 0;
  const t = terms(text);
  const positions = q.map((qt) => t.flatMap((tt, i) => (termMatches(qt, tt) ? [i] : [])));
  if (positions.some((p) => p.length === 0)) return 0;
  // Smallest span holding one position of every term (few terms, short texts: brute force is fine).
  let best = Infinity;
  for (const start of positions[0]) {
    const span = positions.slice(1).reduce((s, ps) => Math.max(s, Math.min(...ps.map((p) => Math.abs(p - start)))), 0);
    best = Math.min(best, span);
  }
  if (window !== undefined && best > window) return 0;
  return 1 + 1 / (1 + Math.max(0, best - (q.length - 1)));
}

/** Role tags any game can use. Games add their own (adapter.tagRules). */
export const COMMON_TAG_RULES: TagRule[] = [
  { tag: 'draw', phrases: ['draw card', 'draws card', 'draw cards'] },
  { tag: 'search', phrases: ['search deck', 'search library', 'look top deck add hand', 'add hand from deck'] },
  { tag: 'removal', phrases: ['destroy target', 'exile target', 'knock out', 'banish chosen', 'banish target', 'return target owner hand', 'damage target creature', 'damage any target', 'destroy card opponent control'] },
  { tag: 'aoe', phrases: ['destroy all', 'banish all', 'exile all', 'each creature', 'all creatures', 'each opponent pokemon', 'all characters', 'damage each'] },
  { tag: 'heal', phrases: ['heal damage', 'gain life', 'remove damage counter', 'restore'] },
  // Making the opponent discard; discarding your own cards as a cost is not a role.
  { tag: 'discard', phrases: ['opponent discard', 'opponent discards', 'each opponent discard'] },
  { tag: 'recursion', phrases: ['from discard pile', 'from graveyard', 'from trash', 'return discard hand'] },
  { tag: 'protection', phrases: ['prevent all damage', 'hexproof', 'indestructible', 'cannot be destroyed', 'can not be destroyed', 'ward'] },
  { tag: 'counter', phrases: ['counter target', 'negate activation', 'negate effect'] },
  { tag: 'ramp', phrases: ['search land put battlefield', 'add mana', 'attach energy', 'put card into inkwell', 'add don'] },
];

/** The role tags of a card, in rule order, without duplicates. */
export function cardTags(card: Card, rules: TagRule[] = COMMON_TAG_RULES): string[] {
  const text = card.text ?? '';
  const out = new Set<string>();
  for (const r of rules) {
    if (out.has(r.tag)) continue;
    if (text && r.not?.some((p) => textScore(p, text, terms(p).length + 4) > 0)) continue;
    if (r.test?.(card) || (text && r.phrases?.some((p) => textScore(p, text, terms(p).length + 4) > 0))) out.add(r.tag);
  }
  return [...out];
}

/**
 * Search cards by name, tag or rules text. Name matches rank first, then exact tags,
 * then text matches by closeness.
 */
export function searchCards<T extends Card>(cards: T[], query: string, tagsOf: (c: T) => string[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return cards;
  const scored = cards.map((c) => {
    const name = c.name.toLowerCase().includes(q) || textScore(q, c.name) > 0 ? 10 : 0;
    const tag = tagsOf(c).some((t) => t.toLowerCase() === q) ? 5 : 0;
    const text = textScore(q, `${c.name} ${c.subtype ?? ''} ${c.category ?? ''} ${c.text ?? ''}`);
    return { c, score: name + tag + text };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).map((s) => s.c);
}

/** A card's types for filtering: category ("Trainer"), subtype ("Supporter", "Stage 1") and limit group ("ACE SPEC"). */
export const cardTypes = (card: Card): string[] => [...new Set([card.category, card.subtype, card.limitGroup].filter((t): t is string => !!t))];

/** Type filter options present in these cards: each category followed by its subtypes, then limit groups. */
export function typeOptions(cards: Card[], categoryOrder: string[]): string[] {
  const rank = (c?: string) => (c && categoryOrder.includes(c) ? categoryOrder.indexOf(c) : categoryOrder.length);
  const sorted = [...cards].sort((a, b) => rank(a.category) - rank(b.category) || (a.subtype ?? '').localeCompare(b.subtype ?? ''));
  const main = sorted.flatMap((c) => [c.category, c.subtype]);
  const groups = sorted.map((c) => c.limitGroup).sort();
  return [...new Set([...main, ...groups].filter((t): t is string => !!t))];
}

/** Common rules plus a game's own, for `cardTags`. */
export const tagRulesFor = (game?: { tagRules?: TagRule[] }) => [...COMMON_TAG_RULES, ...(game?.tagRules ?? [])];
