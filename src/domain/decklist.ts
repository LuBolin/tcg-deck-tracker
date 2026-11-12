import type { DeckLine } from './types';

export interface LineDiff {
  cardId: string;
  name: string;
  section: string;
  before: number;
  after: number;
  delta: number;
}

const key = (l: { section: string; cardId: string }) => `${l.section}|${l.cardId}`;

/** Merge duplicate lines (same card, same section) and drop zero quantities. */
export function normalizeLines(lines: DeckLine[]): DeckLine[] {
  const merged = new Map<string, DeckLine>();
  for (const l of lines) {
    const k = key(l);
    const existing = merged.get(k);
    if (existing) existing.qty += l.qty;
    else merged.set(k, { ...l });
  }
  return [...merged.values()].filter((l) => l.qty > 0);
}

/** Card changes from list `a` to list `b`, per section. */
export function diffLists(a: DeckLine[], b: DeckLine[]): LineDiff[] {
  const before = new Map(normalizeLines(a).map((l) => [key(l), l]));
  const after = new Map(normalizeLines(b).map((l) => [key(l), l]));
  const out: LineDiff[] = [];
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const x = before.get(k);
    const y = after.get(k);
    const delta = (y?.qty ?? 0) - (x?.qty ?? 0);
    if (delta === 0) continue;
    const ref = (y ?? x)!;
    out.push({
      cardId: ref.cardId,
      name: ref.name,
      section: ref.section,
      before: x?.qty ?? 0,
      after: y?.qty ?? 0,
      delta,
    });
  }
  // Removals first, then additions, each by name.
  return out.sort((p, q) => Math.sign(p.delta) - Math.sign(q.delta) || p.name.localeCompare(q.name));
}

/**
 * Apply a diff to a list. Used when a variant takes a change from its parent.
 * `source` supplies line details for cards the list does not have yet.
 */
export function applyDiff(lines: DeckLine[], diff: LineDiff[], source: DeckLine[]): DeckLine[] {
  const result = new Map(normalizeLines(lines).map((l) => [key(l), l]));
  const details = new Map(source.map((l) => [key(l), l]));
  for (const d of diff) {
    const k = key(d);
    const existing = result.get(k);
    if (existing) {
      existing.qty += d.delta;
    } else if (d.delta > 0) {
      const base = details.get(k) ?? { cardId: d.cardId, name: d.name, section: d.section, qty: 0 };
      result.set(k, { ...base, qty: d.delta });
    }
  }
  return [...result.values()].filter((l) => l.qty > 0);
}

/** Physical copies a list needs per card, across all sections. */
export function cardTotals(lines: DeckLine[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const l of lines) totals.set(l.cardId, (totals.get(l.cardId) ?? 0) + l.qty);
  return totals;
}

export function countCards(lines: DeckLine[], section?: string): number {
  return lines.filter((l) => !section || l.section === section).reduce((n, l) => n + l.qty, 0);
}

/** Short text such as "−2 Card A, +2 Card B". */
export function summarizeDiff(diff: LineDiff[]): string {
  if (diff.length === 0) return 'No card changes';
  return diff.map((d) => `${d.delta > 0 ? '+' : '−'}${Math.abs(d.delta)} ${d.name}`).join(', ');
}
