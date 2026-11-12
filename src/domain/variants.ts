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

export interface GraphNode {
  change: Change;
  deck: Deck;
  /** Column: 0 for the family's original deck, then one per variant. */
  lane: number;
  /** Row in time order across the whole family, oldest first. */
  row: number;
}

export interface GraphEdge {
  from: GraphNode;
  to: GraphNode;
  /** next: the deck's following change · variant: a variant made from this change · applied: a parent change taken by a variant. */
  kind: 'next' | 'variant' | 'applied';
}

/** The family a deck belongs to: its topmost ancestor and every descendant, in lane order (parent before children). */
export function deckFamily(decks: Deck[], deckId: string): Deck[] {
  const byId = new Map(decks.map((d) => [d.id, d]));
  let root = byId.get(deckId);
  const seen = new Set<string>();
  while (root?.parentDeckId && byId.has(root.parentDeckId) && !seen.has(root.id)) {
    seen.add(root.id);
    root = byId.get(root.parentDeckId);
  }
  if (!root) return [];
  const out: Deck[] = [];
  const visit = (d: Deck) => {
    if (out.includes(d)) return;
    out.push(d);
    decks.filter((c) => c.parentDeckId === d.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach(visit);
  };
  visit(root);
  return out;
}

/**
 * Lay out a deck family's changes for drawing: one lane per deck, one row per change in time order,
 * and edges for each deck's sequence, where variants were made from, and parent changes they applied.
 */
export function versionGraph(family: Deck[], changes: Map<string, Change[]>): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const lane = new Map(family.map((d, i) => [d.id, i]));
  const all = family.flatMap((deck) => (changes.get(deck.id) ?? []).map((change) => ({ change, deck })));
  all.sort((a, b) => a.change.createdAt.localeCompare(b.change.createdAt) || lane.get(a.deck.id)! - lane.get(b.deck.id)! || a.change.seq - b.change.seq);
  const nodes: GraphNode[] = all.map((x, row) => ({ ...x, lane: lane.get(x.deck.id)!, row }));
  const byChange = new Map(nodes.map((n) => [n.change.id, n]));
  const edges: GraphEdge[] = [];
  for (const deck of family) {
    const own = nodes.filter((n) => n.deck.id === deck.id).sort((a, b) => a.change.seq - b.change.seq);
    own.slice(1).forEach((n, i) => edges.push({ from: own[i], to: n, kind: 'next' }));
    const parentNodes = nodes.filter((n) => n.deck.id === deck.parentDeckId).sort((a, b) => a.change.seq - b.change.seq);
    const first = own[0];
    if (first && parentNodes.length) {
      // Older variants have no origin: the last parent change before the variant's first one.
      const origin = (deck.originChangeId && byChange.get(deck.originChangeId))
        || [...parentNodes].reverse().find((p) => p.change.createdAt <= first.change.createdAt) || parentNodes[0];
      edges.push({ from: origin, to: first, kind: 'variant' });
    }
    for (const n of own) {
      if (!n.change.tags.includes('from parent')) continue;
      // Older applied changes only name the parent change in their note ("From X, change 3").
      const seq = Number(/change (\d+)/.exec(n.change.note)?.[1]);
      const source = (n.change.sourceChangeId && byChange.get(n.change.sourceChangeId)) || parentNodes.find((p) => p.change.seq === seq);
      if (source) edges.push({ from: source, to: n, kind: 'applied' });
    }
  }
  return { nodes, edges };
}
