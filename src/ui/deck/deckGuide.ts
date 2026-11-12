import { diffLists } from '../../domain/decklist';
import type { DeckLine } from '../../domain/types';

/** Plain-text deck guide: the list, then each change with its reason, newest first. */
export function deckGuide(name: string, list: string, changes: { seq: number; createdAt: string; lines: DeckLine[]; tags: string[]; note: string; result: string }[], parentName?: string): string {
  const out = [`${name}${parentName ? ` (variant of ${parentName})` : ''}`, '', list, '', 'Changes'];
  for (const c of [...changes].reverse()) {
    const prev = changes.find((x) => x.seq === c.seq - 1);
    const diff = prev ? diffLists(prev.lines, c.lines).map((d) => `${d.delta > 0 ? '+' : '-'}${Math.abs(d.delta)} ${d.name}`).join(', ') : 'first version';
    const why = [c.tags.join(', '), c.note].filter(Boolean).join(': ');
    out.push(`- ${new Date(c.createdAt).toLocaleDateString()}: ${diff || 'no card changes'}${why ? ` (${why})` : ''}${c.result ? ` [result: ${c.result}]` : ''}`);
  }
  return out.join('\n');
}
