import type { Change, Deck, DeckLine } from './types';

/**
 * A deck and its history packed into a share link. Lines are stored as compact tuples:
 * [cardId, name, qty, section, set, number, category].
 */
export interface SharedDeck {
  v: 1;
  game: string;
  name: string;
  format?: string;
  purpose?: string;
  changes: { at: string; tags: string[]; note: string; result: string; lines: DeckLine[] }[];
}

type Tuple = [string, string, number, string, string?, string?, string?];
const toTuple = (l: DeckLine): Tuple => [l.cardId, l.name, l.qty, l.section, l.set, l.number, l.category];
const fromTuple = (t: Tuple): DeckLine => ({ cardId: t[0], name: t[1], qty: t[2], section: t[3], set: t[4] ?? undefined, number: t[5] ?? undefined, category: t[6] ?? undefined });

const LIMITS = { changes: 500, lines: 400, text: 2000 };

export function packDeck(deck: Deck, changes: Change[], withHistory: boolean): SharedDeck {
  const kept = withHistory ? changes : changes.slice(-1);
  return {
    v: 1,
    game: deck.game,
    name: deck.name,
    format: deck.format,
    purpose: deck.purpose,
    changes: kept.map((c) => ({ at: c.createdAt, tags: c.tags, note: c.note, result: c.result, lines: c.lines })),
  };
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const toBase64Url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (text: string) => {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** Compressed, URL-safe text for the link. */
export async function encodeShare(shared: SharedDeck): Promise<string> {
  const compact = { ...shared, changes: shared.changes.map((c) => ({ ...c, lines: c.lines.map(toTuple) })) };
  return toBase64Url(await pipe(new TextEncoder().encode(JSON.stringify(compact)), new CompressionStream('deflate-raw')));
}

/**
 * Read a share link. The link comes from anyone, so every field is checked;
 * anything unexpected is rejected rather than half-imported.
 */
export async function decodeShare(text: string): Promise<SharedDeck> {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(await pipe(fromBase64Url(text), new DecompressionStream('deflate-raw'))));
  } catch {
    throw new Error('This share link is damaged or incomplete.');
  }
  const bad = () => new Error('This share link is not a valid deck.');
  const str = (v: unknown, max = LIMITS.text) => typeof v === 'string' && v.length <= max;
  const o = raw as Record<string, unknown>;
  if (!o || o.v !== 1 || !str(o.game, 40) || !str(o.name, 200) || !Array.isArray(o.changes)) throw bad();
  if (o.changes.length === 0 || o.changes.length > LIMITS.changes) throw bad();
  if ((o.format !== undefined && !str(o.format, 40)) || (o.purpose !== undefined && !str(o.purpose))) throw bad();
  const changes = o.changes.map((c: Record<string, unknown>) => {
    if (!c || !str(c.at, 40) || !str(c.note) || !str(c.result, 200) || !Array.isArray(c.tags) || !Array.isArray(c.lines)) throw bad();
    if (c.lines.length > LIMITS.lines || !c.tags.every((t) => str(t, 60))) throw bad();
    const lines = (c.lines as unknown[]).map((t) => {
      const a = t as unknown[];
      const ok = Array.isArray(a) && str(a[0], 120) && str(a[1], 200) && Number.isInteger(a[2]) && (a[2] as number) > 0 && (a[2] as number) <= 999 && str(a[3], 30)
        && [a[4], a[5], a[6]].every((x) => x === undefined || x === null || str(x, 60));
      if (!ok) throw bad();
      return fromTuple(a as Tuple);
    });
    return { at: c.at as string, tags: c.tags as string[], note: c.note as string, result: c.result as string, lines };
  });
  return { v: 1, game: o.game as string, name: o.name as string, format: o.format as string | undefined, purpose: o.purpose as string | undefined, changes };
}
