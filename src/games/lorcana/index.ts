import type { ListFormat, ParsedLine } from '../../domain/listParse';
import type { Card, DeckLine } from '../../domain/types';
import { fetchJson, formatSections, pool, rankByName } from '../common';
import type { GameAdapter, ResolvedLine } from '../types';

/**
 * Disney Lorcana. Card data from Lorcast (https://lorcast.com/docs/api).
 * "Same in play" = name plus version ("Elsa - Spirit of Winter"); reprints and enchanted
 * printings share it. Lists: "4 Elsa - Spirit of Winter" (Dreamborn, Inktable, Pixelborn).
 */
const API = 'https://api.lorcast.com/v0';

interface LorcastCard {
  name: string;
  version?: string | null;
  type: string[];
  cost?: number;
  ink?: string | null;
  inks?: string[] | null;
  collector_number: string;
  set: { code: string; name: string };
  prices?: { usd?: number | null; usd_foil?: number | null };
  legalities?: Record<string, string>;
  image_uris?: { digital?: { small?: string; normal?: string } };
}

export const fullName = (c: Pick<LorcastCard, 'name' | 'version'>) => (c.version ? `${c.name} - ${c.version}` : c.name);
const key = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** A Lorcana deck may use at most two inks. Cards without ink data are ignored. */
export function tooManyInks(lines: DeckLine[], cards: Map<string, Card>): string[] {
  const inks = [...new Set(lines.flatMap((l) => cards.get(l.cardId)?.identity ?? []))].sort();
  return inks.length > 2 ? [`Uses ${inks.length} inks (${inks.join(', ')}); a deck can have at most 2`] : [];
}

export function toCard(c: LorcastCard): Card {
  return {
    game: 'lorcana',
    id: key(fullName(c)),
    name: fullName(c),
    category: c.type.includes('Song') ? 'Song' : c.type[0],
    set: c.set.code,
    number: c.collector_number,
    imageUrl: c.image_uris?.digital?.small,
    price: c.prices?.usd ?? c.prices?.usd_foil ?? undefined,
    legal: c.legalities ? Object.entries(c.legalities).filter(([, v]) => v === 'legal').map(([f]) => f) : undefined,
    cost: c.cost,
    identity: c.inks ?? (c.ink ? [c.ink] : undefined),
  };
}

const format: ListFormat = {
  header: (line) => (/^(characters?|actions?|songs?|items?|locations?|deck|total)\b/i.test(line) ? 'ignore' : undefined),
  splitPrinting: (rest) => ({ name: rest.trim() }),
};

export function createLorcanaAdapter(fetchFn: typeof fetchJson = fetchJson): GameAdapter {
  const search = async (q: string): Promise<LorcastCard[]> =>
    (await fetchFn<{ results: LorcastCard[] }>(`${API}/cards/search?q=${encodeURIComponent(q)}`)).results;

  return {
    id: 'lorcana',
    name: 'Disney Lorcana',
    source: { name: 'Lorcast', url: 'https://lorcast.com', prices: 'Lorcast (TCGplayer)' },
    sections: [{ id: 'main', label: 'Deck' }],
    categories: ['Character', 'Action', 'Song', 'Item', 'Location'],
    formats: ['Core', 'Infinity'],
    openingHand: 7,
    sampleList: '4 Elsa - Spirit of Winter\n4 Be Prepared\n4 Dinglehopper',
    listFormat: format,
    // At least 60 cards, 4 per full name (different versions are different cards).
    deckRules: () => ({ size: 60, exact: false, sizeSections: ['main'], copyLimit: 4, unlimited: () => false, extraCheck: tooManyInks }),

    formatLine: (l) => `${l.qty} ${l.name}`,
    formatList(lines) {
      return formatSections(lines, this, () => null);
    },

    async resolve(lines: ParsedLine[]): Promise<ResolvedLine[]> {
      const names = [...new Set(lines.map((l) => l.name))];
      // Search by the words of the name (Lorcast does not match "Name - Version" quoted), then match exactly.
      const found = await pool(names, 2, async (name) => {
        const results = await search(name.replace(/\s+-\s+/, ' ')).catch(() => []);
        return results.find((c) => key(fullName(c)) === key(name));
      });
      const byName = new Map(names.map((n, i) => [n, found[i]]));
      return lines.map((line) => {
        const c = byName.get(line.name);
        return c ? { line, card: toCard(c) } : { line };
      });
    },

    async search(q) {
      const term = q.trim();
      if (!term) return [];
      return rankByName((await search(term)).map(toCard), term).slice(0, 24);
    },
  };
}

export const lorcanaAdapter = createLorcanaAdapter();
