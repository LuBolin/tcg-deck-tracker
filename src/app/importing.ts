import { looksLikeCsv, parseCollectionCsv } from '../domain/csv';
import { parseList, type ParseError } from '../domain/listParse';
import type { DeckLine } from '../domain/types';
import { chunk } from '../games/common';
import type { GameAdapter, ResolvedLine } from '../games/types';
import { stamp } from './cardData';
import { repo } from './repo';

/** Parse list text (or a collection CSV) and match each line to a card. Matched cards are cached. */
export async function readList(
  adapter: GameAdapter,
  input: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ resolved: ResolvedLine[]; errors: ParseError[] }> {
  const text = adapter.preprocess ? adapter.preprocess(input) : input;
  const { lines, errors } = looksLikeCsv(text) ? parseCollectionCsv(text) : parseList(text, adapter.listFormat);
  // Resolve in chunks so long lists (collection CSVs) can report progress.
  const resolved: ResolvedLine[] = [];
  for (const part of chunk(lines, 40)) {
    resolved.push(...(await adapter.resolve(part)));
    onProgress?.(resolved.length, lines.length);
  }
  const cards = resolved.flatMap((r) => (r.card ? [r.card] : []));
  if (cards.length) await repo.putCards(stamp(cards));
  return { resolved, errors };
}

/** Matched lines as deck lines. Keeps the printing the player wrote, else the card's default. */
export function toDeckLines(resolved: ResolvedLine[]): DeckLine[] {
  return resolved.flatMap(({ line, card }) =>
    card
      ? [{
          cardId: card.id,
          name: card.name,
          qty: line.qty,
          section: line.section,
          set: line.set ?? card.set,
          // A number without its set code is meaningless (and breaks export), so keep them together.
          number: line.set ? line.number : card.set ? card.number : undefined,
          category: card.category,
        }]
      : [],
  );
}
