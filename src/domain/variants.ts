import { diffLists, type LineDiff } from './decklist';
import type { Change, Deck } from './types';

export interface PendingParentChange {
  change: Change;
  /** What this parent change did, compared with the parent's previous change. */
  diff: LineDiff[];
}

/**
 * Parent changes made after the point the variant is based on, oldest first.
 * The variant applies or dismisses them one at a time, in order.
 */
export function pendingParentChanges(variant: Deck, parentChanges: Change[]): PendingParentChange[] {
  const sorted = [...parentChanges].sort((a, b) => a.seq - b.seq);
  const baseSeq = sorted.find((c) => c.id === variant.parentChangeId)?.seq ?? 0;
  const out: PendingParentChange[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    if (c.seq <= baseSeq) continue;
    const prev = sorted[i - 1]?.lines ?? [];
    const diff = diffLists(prev, c.lines);
    if (diff.length > 0) out.push({ change: c, diff });
  }
  return out;
}

export interface DeckNode {
  deck: Deck;
  children: DeckNode[];
}

/** Arrange decks into variant trees. Decks whose parent is missing become roots. */
export function deckTree(decks: Deck[]): DeckNode[] {
  const nodes = new Map(decks.map((d) => [d.id, { deck: d, children: [] as DeckNode[] }]));
  const roots: DeckNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.deck.parentDeckId ? nodes.get(node.deck.parentDeckId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const byName = (a: DeckNode, b: DeckNode) => a.deck.name.localeCompare(b.deck.name);
  const sortAll = (list: DeckNode[]) => {
    list.sort(byName);
    list.forEach((n) => sortAll(n.children));
  };
  sortAll(roots);
  return roots;
}
