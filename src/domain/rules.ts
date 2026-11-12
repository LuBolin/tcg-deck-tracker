import type { Card, DeckLine } from './types';

/** Construction rules for one format. Games supply these through their adapter. */
export interface DeckRules {
  /** Required main-deck size. */
  size?: number;
  /** true: exactly `size`; false: at least `size`. */
  exact: boolean;
  /** Largest main deck allowed, when the format has a range (Yu-Gi-Oh!: 40 to 60). */
  maxSize?: number;
  /** Sections that count toward the size. */
  sizeSections: string[];
  /** Most copies of one card across all sections. */
  copyLimit?: number;
  /** What counts as "one card" for the limit: its name (default; most games) or its card id (One Piece counts by card number). */
  copyKey?: 'name' | 'card';
  /** Cards exempt from the copy limit (basic energy, basic lands). */
  unlimited: (name: string) => boolean;
  /** Most cards allowed per other section, for example { sideboard: 15, extra: 15 }. */
  sectionMax?: Record<string, number>;
  /** Most cards per limit group across the deck, for example { 'ACE SPEC': 1 }. Needs card data. */
  groupLimits?: Record<string, number>;
  /** Game-specific checks that need card data (MTG Commander color identity). Returns problem messages. */
  extraCheck?: (lines: DeckLine[], cards: Map<string, Card>) => string[];
}

export type DeckIssue =
  | { kind: 'size'; count: number; size: number; exact: boolean; max?: boolean }
  | { kind: 'copies'; name: string; qty: number; limit: number }
  | { kind: 'section'; section: string; count: number; max: number }
  | { kind: 'group'; group: string; count: number; max: number }
  | { kind: 'other'; message: string };

const sum = (lines: DeckLine[]) => lines.reduce((n, l) => n + l.qty, 0);

export function deckCount(lines: DeckLine[], rules: DeckRules): number {
  return sum(lines.filter((l) => rules.sizeSections.includes(l.section)));
}

/**
 * Rule problems in a list. Copies are counted by name, as tournament rules do.
 * `cards` supplies per-card limits (a banlist), which can only lower the format's limit.
 */
export function validateDeck(lines: DeckLine[], rules: DeckRules, cards?: Map<string, Card>): DeckIssue[] {
  const issues: DeckIssue[] = [];
  const count = deckCount(lines, rules);
  if (rules.size !== undefined && (rules.exact ? count !== rules.size : count < rules.size)) {
    issues.push({ kind: 'size', count, size: rules.size, exact: rules.exact });
  } else if (rules.maxSize !== undefined && count > rules.maxSize) {
    issues.push({ kind: 'size', count, size: rules.maxSize, exact: false, max: true });
  }
  const byName = new Map<string, { name: string; qty: number; limit?: number }>();
  for (const l of lines) {
    const key = rules.copyKey === 'card' ? l.cardId : l.name.toLowerCase();
    const e = byName.get(key) ?? { name: l.name, qty: 0 };
    e.qty += l.qty;
    const cardLimit = cards?.get(l.cardId)?.maxCopies;
    if (cardLimit !== undefined) e.limit = Math.min(e.limit ?? cardLimit, cardLimit);
    byName.set(key, e);
  }
  for (const { name, qty, limit: cardLimit } of byName.values()) {
    const limit = cardLimit !== undefined ? Math.min(cardLimit, rules.copyLimit ?? cardLimit) : rules.copyLimit;
    if (limit !== undefined && qty > limit && !rules.unlimited(name)) issues.push({ kind: 'copies', name, qty, limit });
  }
  for (const [group, max] of Object.entries(rules.groupLimits ?? {})) {
    const n = sum(lines.filter((l) => cards?.get(l.cardId)?.limitGroup === group));
    if (n > max) issues.push({ kind: 'group', group, count: n, max });
  }
  if (rules.extraCheck && cards) for (const message of rules.extraCheck(lines, cards)) issues.push({ kind: 'other', message });
  for (const [section, max] of Object.entries(rules.sectionMax ?? {})) {
    const n = sum(lines.filter((l) => l.section === section));
    if (n > max) issues.push({ kind: 'section', section, count: n, max });
  }
  return issues;
}

export function describeIssue(i: DeckIssue): string {
  switch (i.kind) {
    case 'size':
      return i.max ? `Deck has ${i.count} cards; the most allowed is ${i.size}`
        : i.exact ? `Deck has ${i.count} cards; it needs exactly ${i.size}` : `Deck has ${i.count} cards; it needs at least ${i.size}`;
    case 'copies':
      return i.limit === 0 ? `${i.name} is forbidden` : `${i.qty} copies of ${i.name}; the limit is ${i.limit}`;
    case 'group':
      return `${i.count} ${i.group} cards; the limit is ${i.max} per deck`;
    case 'other':
      return i.message;
    case 'section':
      return `${i.section[0].toUpperCase()}${i.section.slice(1)} has ${i.count} cards; the limit is ${i.max}`;
  }
}

/** "60" (exact), "60+" (minimum) or "40–60" (range), for the deck counter. */
export function sizeLabel(rules: DeckRules): string {
  if (rules.size === undefined) return '';
  if (rules.maxSize !== undefined) return `${rules.size}–${rules.maxSize}`;
  return rules.exact ? `${rules.size}` : `${rules.size}+`;
}
