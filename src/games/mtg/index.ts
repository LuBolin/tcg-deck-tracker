import { splitArena, type ListFormat, type ParsedLine } from '../../domain/listParse';
import type { Card, DeckLine } from '../../domain/types';
import { chunk, fetchJson, formatSections, rankByName } from '../common';
import type { GameAdapter, ResolvedLine } from '../types';

/**
 * Magic: The Gathering. Card data from Scryfall (https://scryfall.com/docs/api).
 * "Same in play" = Scryfall's oracle_id. Lists: MTG Arena ("4 Lightning Bolt (2X2) 117")
 * or plain text ("4 Lightning Bolt"), with a sideboard after a header or a blank line.
 */
const API = 'https://api.scryfall.com';

interface ScryCard {
  oracle_id?: string;
  name: string;
  layout: string;
  set: string;
  collector_number: string;
  type_line?: string;
  image_uris?: { small?: string };
  prices?: { usd?: string | null; usd_foil?: string | null };
  legalities?: Record<string, string>;
  cmc?: number;
  color_identity?: string[];
  card_faces?: { name: string; type_line?: string; oracle_id?: string; image_uris?: { small?: string } }[];
}

type Identifier = { set: string; collector_number: string } | { name: string };

/** Layouts whose Arena name is the front face only. */
const FRONT_NAME_LAYOUTS = new Set(['transform', 'modal_dfc', 'adventure', 'flip', 'meld', 'reversible_card']);
const TYPE_ORDER = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land'];

export function mainType(typeLine = ''): string {
  const front = typeLine.split('//')[0];
  return TYPE_ORDER.find((t) => front.includes(t)) ?? 'Other';
}

/** Commander: every card's color identity must fit inside the commanders' combined identity. */
export function outsideIdentity(lines: DeckLine[], cards: Map<string, Card>): string[] {
  const commanders = lines.filter((l) => l.section === 'commander');
  if (commanders.length === 0) return [];
  const allowed = new Set(commanders.flatMap((l) => cards.get(l.cardId)?.identity ?? []));
  if (commanders.some((l) => !cards.get(l.cardId)?.identity)) return []; // identity unknown: do not guess
  const bad = lines.filter((l) => l.section !== 'commander' && (cards.get(l.cardId)?.identity ?? []).some((c) => !allowed.has(c)));
  return bad.length ? [`Outside the commander's colors: ${bad.map((l) => l.name).join(', ')}`] : [];
}

export function toCard(c: ScryCard): Card | undefined {
  const oracleId = c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
  if (!oracleId) return undefined;
  const front = c.card_faces?.[0];
  return {
    game: 'mtg',
    id: oracleId,
    name: FRONT_NAME_LAYOUTS.has(c.layout) && front ? front.name : c.name,
    category: mainType(c.type_line ?? front?.type_line),
    set: c.set.toUpperCase(),
    number: c.collector_number,
    imageUrl: c.image_uris?.small ?? front?.image_uris?.small,
    price: Number(c.prices?.usd ?? c.prices?.usd_foil) || undefined,
    legal: c.legalities
      ? Object.entries(c.legalities).filter(([, v]) => v === 'legal' || v === 'restricted').map(([f]) => f)
      : undefined,
    cost: c.cmc,
    identity: c.color_identity,
  };
}


const lower = (s: string) => s.toLowerCase().trim();
const BASIC_LANDS = ['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes'];
/** Basic lands (snow ones too) are exempt from the copy limit. */
export const isBasicLand = (name: string) => BASIC_LANDS.includes(lower(name).replace(/^snow-covered /, ''));
/** Names a list may use for a card: the full name and its front face. */
const namesOf = (c: ScryCard) => [c.name, c.name.split(' // ')[0], ...(c.card_faces ?? []).map((f) => f.name)].map(lower);

const format: ListFormat = {
  header: (line) => {
    const l = line.toLowerCase().replace(/[:\s]+$/, '');
    if (l === 'commander') return 'commander';
    if (l === 'sideboard' || l === 'companion') return 'sideboard';
    if (l === 'deck' || l === 'main' || l === 'mainboard' || l === 'main deck') return 'main';
    if (l === 'about' || l.startsWith('name ') || l === 'maybeboard') return 'ignore';
    return undefined;
  },
  splitPrinting: (rest) => splitArena(rest) ?? { name: rest.replace(/\s+\*F\*$/, '') },
  blankLineStartsSideboard: true,
};

export function createMtgAdapter(fetchFn: typeof fetchJson = fetchJson): GameAdapter {
  /** Scryfall's batch lookup: up to 75 identifiers per request. */
  const collection = async (ids: Identifier[]): Promise<ScryCard[]> => {
    const out: ScryCard[] = [];
    for (const part of chunk(ids, 75)) {
      const r = await fetchFn<{ data: ScryCard[] }>(`${API}/cards/collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: part }),
      });
      out.push(...r.data);
    }
    return out;
  };

  return {
    id: 'mtg',
    name: 'Magic: The Gathering',
    source: { name: 'Scryfall', url: 'https://scryfall.com', prices: 'Scryfall (TCGplayer)' },
    sections: [
      { id: 'commander', label: 'Commander' },
      { id: 'main', label: 'Main deck' },
      { id: 'sideboard', label: 'Sideboard' },
    ],
    categories: TYPE_ORDER,
    formats: ['Standard', 'Pioneer', 'Modern', 'Legacy', 'Vintage', 'Pauper', 'Commander'],
    openingHand: 7,
    deckRules: (format) =>
      format === 'Commander'
        ? { size: 100, exact: true, sizeSections: ['commander', 'main'], copyLimit: 1, unlimited: isBasicLand, extraCheck: outsideIdentity }
        : { size: 60, exact: false, sizeSections: ['main'], copyLimit: 4, unlimited: isBasicLand, sectionMax: { sideboard: 15 } },
    sampleList: 'Deck\n4 Lightning Bolt (2X2) 117\n4 Monastery Swiftspear\n20 Mountain\n\nSideboard\n2 Pyroblast',
    listFormat: format,

    formatLine: (l) => `${l.qty} ${l.name}${l.set && l.number ? ` (${l.set}) ${l.number}` : ''}`,
    formatList(lines: DeckLine[]) {
      const label: Record<string, string> = { commander: 'Commander', main: 'Deck', sideboard: 'Sideboard' };
      return formatSections(lines, this, (s) => label[s.id] ?? s.label);
    },

    async resolve(lines: ParsedLine[]): Promise<ResolvedLine[]> {
      const found = new Map<number, Card>();
      // Pass 1: exact printings. Arena set codes can differ from Scryfall's, so misses fall back to names.
      const printed = lines.filter((l) => l.set && l.number);
      if (printed.length) {
        const cards = await collection(printed.map((l) => ({ set: l.set!.toLowerCase(), collector_number: l.number! })));
        for (const l of printed) {
          // The printing must also match the name: a wrong set or number must not swap in another card.
          const c = cards.find((x) => x.set === l.set!.toLowerCase() && x.collector_number === l.number && namesOf(x).includes(lower(l.name)));
          const card = c && toCard(c);
          if (card) found.set(l.lineNo, card);
        }
      }
      // Pass 2: names.
      const rest = lines.filter((l) => !found.has(l.lineNo));
      if (rest.length) {
        const unique = [...new Set(rest.map((l) => l.name))];
        // Scryfall's batch lookup rejects "Fire // Ice" but finds the front face "Fire".
        const cards = await collection(unique.map((name) => ({ name: name.split(' // ')[0] })));
        for (const l of rest) {
          const c = cards.find((x) => namesOf(x).includes(lower(l.name)));
          const card = c && toCard(c);
          if (card) found.set(l.lineNo, { ...card, set: undefined, number: undefined });
        }
      }
      return lines.map((line) => ({ line, card: found.get(line.lineNo) }));
    },

    async search(query) {
      const q = query.trim();
      if (!q) return [];
      try {
        const r = await fetchFn<{ data: ScryCard[] }>(`${API}/cards/search?q=${encodeURIComponent(q)}&unique=cards&order=name`);
        return rankByName(r.data.flatMap((c) => toCard(c) ?? []), q).slice(0, 24);
      } catch (e) {
        if (e instanceof Error && e.message.includes('(404)')) return []; // Scryfall answers 404 for "no cards found"
        throw e;
      }
    },
  };
}

export const mtgAdapter = createMtgAdapter();
