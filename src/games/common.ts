import type { DeckLine } from '../domain/types';
import type { GameAdapter } from './types';

/** Export text: one block per non-empty section, with an optional header line. */
export function formatSections(
  lines: DeckLine[],
  adapter: Pick<GameAdapter, 'sections' | 'formatLine'>,
  header: (section: { id: string; label: string }, count: number) => string | null,
): string {
  const blocks: string[] = [];
  for (const s of adapter.sections) {
    const inSection = lines.filter((l) => l.section === s.id);
    if (inSection.length === 0) continue;
    const count = inSection.reduce((n, l) => n + l.qty, 0);
    const h = header(s, count);
    blocks.push([...(h ? [h] : []), ...inSection.map((l) => adapter.formatLine(l))].join('\n'));
  }
  return blocks.join('\n\n');
}

/** Split an array into chunks of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...init?.headers } });
  if (!res.ok) throw new Error(`Request failed (${res.status}): ${url}`);
  return (await res.json()) as T;
}

/** Run at most `n` tasks at once. */
export async function pool<T, R>(items: T[], n: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await run(items[i]);
      }
    }),
  );
  return out;
}

/** Exact name first, then names that start with the query, then the rest (stable). */
export function rankByName<T extends { name: string }>(cards: T[], query: string): T[] {
  const lower = (s: string) => s.toLowerCase().trim();
  const q = lower(query);
  const rank = (c: T) => {
    const n = lower(c.name);
    return n === q || n.split(' // ')[0] === q ? 0 : n.startsWith(q) ? 1 : n.split(/[\s,]+/).some((w) => w.startsWith(q)) ? 2 : 3;
  };
  return cards.map((c, i) => ({ c, i, r: rank(c) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.c);
}
