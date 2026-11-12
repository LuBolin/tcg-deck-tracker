import type { ListFormat, ParsedLine } from '../../domain/listParse';
import type { Card, DeckLine } from '../../domain/types';
import { fetchJson, formatSections, pool, rankByName } from '../common';
import type { GameAdapter, ResolvedLine } from '../types';

/**
 * One Piece Card Game. Card data from OPTCG API (https://optcgapi.com).
 * "Same in play" = the card number (OP01-016); parallel and SP art share it.
 * Lists: "4xOP01-016" (OPTCGSim, most deck sites), optionally followed by the name.
 */
const API = 'https://optcgapi.com/api';
const CARD_ID = /^([A-Z]{1,4}\d{0,2}-\d{3})\b\s*(.*)$/;

interface OpCard {
  card_name: string;
  card_set_id: string;
  card_type: string;
  card_text?: string | null;
  card_color?: string;
  card_cost?: string | null;
  market_price?: number | null;
  card_image?: string;
}

/** "Roronoa Zoro (025) (Parallel)" → "Roronoa Zoro". */
export const baseName = (name: string) => name.replace(/\s*\([^)]*\)/g, '').trim();
const isAltArt = (c: OpCard) => /\((parallel|sp|manga|alternate|reprint)/i.test(c.card_name);

/** Every card must share at least one color with the Leader. Unknown colors are not flagged. */
export function offColor(lines: DeckLine[], cards: Map<string, Card>): string[] {
  const leader = lines.find((l) => l.section === 'leader');
  const colors = leader && cards.get(leader.cardId)?.identity;
  if (!colors) return [];
  const bad = lines.filter((l) => l.section !== 'leader' && cards.get(l.cardId)?.identity && !cards.get(l.cardId)!.identity!.some((c) => colors.includes(c)));
  return bad.length ? [`Not the Leader's color (${colors.join('/')}): ${bad.map((l) => l.name).join(', ')}`] : [];
}

export function toCard(c: OpCard): Card {
  return {
    game: 'onepiece',
    id: c.card_set_id,
    name: baseName(c.card_name),
    category: c.card_type,
    set: c.card_set_id,
    imageUrl: c.card_image,
    price: c.market_price ?? undefined,
    cost: Number.isFinite(Number(c.card_cost)) && c.card_cost !== null && c.card_cost !== '' ? Number(c.card_cost) : undefined,
    identity: c.card_color ? c.card_color.split(/\s+/) : undefined,
    text: (c.card_text ?? '').replace(/\s*This card has been officially errata'd\.?/i, '').trim(),
  };
}

/** "4xOP01-016" → "4 OP01-016" so the generic parser reads it. */
export const normalizeList = (text: string) => text.replace(/^(\s*\d+)\s*[xX]\s*(?=[A-Z]{1,4}\d{0,2}-\d{3})/gm, '$1 ');

const format: ListFormat = {
  header: (line) => {
    const l = line.toLowerCase().replace(/[:\s\d]+$/, '').trim();
    if (l === 'leader') return 'leader';
    if (l === 'deck' || l === 'main' || l === 'main deck' || l === 'characters' || l === 'events' || l === 'stages') return 'main';
    return undefined;
  },
  splitPrinting: (rest) => {
    const m = CARD_ID.exec(rest);
    return m ? { name: m[2] || m[1], set: m[1] } : { name: rest };
  },
};

export function createOnePieceAdapter(fetchFn: typeof fetchJson = fetchJson): GameAdapter {
  const cache = new Map<string, Promise<OpCard | undefined>>();
  /** Base printing of a card number. Starter decks and promos live under other paths. */
  const byId = (id: string) => {
    if (!cache.has(id)) {
      const path = id.startsWith('ST') ? 'decks' : id.startsWith('P-') ? 'promos' : 'sets';
      cache.set(id, fetchFn<OpCard[]>(`${API}/${path}/card/${encodeURIComponent(id)}/`)
        .then((list) => list.find((c) => !isAltArt(c)) ?? list[0])
        .catch(() => {
          cache.delete(id); // a failed request is retried next time, not remembered
          return undefined;
        }));
    }
    return cache.get(id)!;
  };
  const searchName = async (name: string): Promise<OpCard[]> =>
    fetchFn<OpCard[]>(`${API}/sets/filtered/?card_name=${encodeURIComponent(name)}`).catch(() => []);

  return {
    id: 'onepiece',
    tagRules: [{ tag: 'blocker', phrases: ['blocker'] }, { tag: 'rush', phrases: ['rush'] }],
    name: 'One Piece',
    source: { name: 'OPTCG API', url: 'https://optcgapi.com', prices: 'TCGplayer market price via OPTCG API' },
    sections: [
      { id: 'leader', label: 'Leader' },
      { id: 'main', label: 'Deck' },
    ],
    categories: ['Leader', 'Character', 'Event', 'Stage'],
    formats: ['Standard'],
    openingHand: 5,
    sampleList: '1xOP01-001\n4xOP01-016\n4xOP01-025',
    listFormat: format,
    preprocess: normalizeList,
    // One Leader plus exactly 50 cards; at most 4 of each card number.
    deckRules: () => ({ size: 50, exact: true, sizeSections: ['main'], copyLimit: 4, copyKey: 'card', unlimited: () => false, sectionMax: { leader: 1 }, extraCheck: offColor }),

    sectionFor: (card) => (card.category === 'Leader' ? 'leader' : undefined),
    formatLine: (l) => `${l.qty}x${l.set ?? l.name}`,
    formatList(lines: DeckLine[]) {
      return formatSections(lines, this, () => null).replace(/\n\n/g, '\n');
    },

    async resolve(lines: ParsedLine[]): Promise<ResolvedLine[]> {
      return pool(lines, 4, async (line) => {
        let c = line.set ? await byId(line.set) : undefined;
        if (!c) {
          const want = baseName(line.name).toLowerCase();
          c = (await searchName(baseName(line.name))).find((x) => !isAltArt(x) && baseName(x.card_name).toLowerCase() === want);
        }
        if (!c) return { line };
        // A Leader belongs in the Leader section even when the list has no headers.
        const section = c.card_type === 'Leader' ? 'leader' : line.section;
        return { line: { ...line, section }, card: toCard(c) };
      });
    },

    async search(q) {
      const term = q.trim();
      if (!term) return [];
      const found = (await searchName(term)).filter((c) => !isAltArt(c));
      return rankByName(found.map(toCard), term).slice(0, 24);
    },
  };
}

export const onePieceAdapter = createOnePieceAdapter();
