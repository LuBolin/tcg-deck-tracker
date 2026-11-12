import { splitTrailingSetNumber, type ListFormat, type ParsedLine } from '../../domain/listParse';
import type { Card, DeckLine } from '../../domain/types';
import { fetchJson, pool } from '../common';
import type { GameAdapter, ResolvedLine } from '../types';

/**
 * Pokemon TCG. Card data from TCGdex (https://tcgdex.dev), which needs no key and allows
 * browser requests. Lists use the Pokemon TCG Live / Limitless format: "4 Iono PAL 185".
 */
const API = 'https://api.tcgdex.net/v2/en';

interface TcgdexBrief { id: string; localId: string; name: string; image?: string }
interface TcgdexSet { id: string; name: string; abbreviation?: { official?: string }; cards: TcgdexBrief[] }
interface TcgdexCard {
  id: string;
  localId: string;
  name: string;
  category: 'Pokemon' | 'Trainer' | 'Energy';
  image?: string;
  hp?: number;
  attacks?: { name: string; damage?: string | number; cost?: string[]; effect?: string }[];
  abilities?: { name: string; effect?: string }[];
  effect?: string;
  set: { id: string; name: string };
  legal?: Record<string, boolean>;
  stage?: string;
  rarity?: string;
  trainerType?: string;
  energyType?: string;
  pricing?: { tcgplayer?: Record<string, { marketPrice?: number; midPrice?: number } | string> };
}

const PRICE_VARIANTS = ['normal', 'holofoil', 'reverse-holofoil', '1st-edition', 'unlimited'];

/** TCGplayer market price in USD for the first variant that has one. */
export function marketPrice(c: Pick<TcgdexCard, 'pricing'>): number | undefined {
  const tp = c.pricing?.tcgplayer;
  if (!tp) return undefined;
  const variants = [...PRICE_VARIANTS, ...Object.keys(tp)];
  for (const v of variants) {
    const entry = tp[v];
    if (entry && typeof entry === 'object') {
      const price = entry.marketPrice ?? entry.midPrice;
      if (typeof price === 'number' && price > 0) return price;
    }
  }
  return undefined;
}

/** Pokémon stage ("Basic", "Stage 1"), Trainer type ("Supporter") or Energy kind ("Basic Energy"). */
export function subtypeOf(c: Pick<TcgdexCard, 'category' | 'stage' | 'trainerType' | 'energyType'>): string | undefined {
  if (c.category === 'Pokemon') return c.stage?.replace(/^Stage(\d)$/, 'Stage $1');
  if (c.category === 'Trainer') return c.trainerType;
  return c.energyType === 'Normal' ? 'Basic Energy' : c.energyType === 'Special' ? 'Special Energy' : undefined;
}

/** A deck needs a Basic Pokémon to start a game. Only checked once every Pokémon's stage is known. */
export function needsBasic(lines: DeckLine[], cards: Map<string, Card>): string[] {
  const pokemon = lines.filter((l) => l.category === 'Pokémon');
  if (pokemon.length === 0 || pokemon.some((l) => !cards.get(l.cardId)?.subtype)) return [];
  return pokemon.some((l) => cards.get(l.cardId)?.subtype === 'Basic') ? [] : ['No Basic Pokémon: the deck cannot start a game'];
}

/** Formats this printing is legal in. Unlimited allows every card. */
const legalFormats = (c: Pick<TcgdexCard, 'legal'>) => [
  ...Object.entries(c.legal ?? {}).filter(([, ok]) => ok).map(([f]) => f.toLowerCase()),
  'unlimited',
];

const ENERGY_SYMBOLS: Record<string, string> = {
  G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting', D: 'Darkness', M: 'Metal', Y: 'Fairy',
};

/** "Basic {R} Energy" and "Basic Fire Energy" → "Fire Energy". */
export function normalizeEnergyName(name: string): string {
  return name
    .replace(/\{([A-Z])\}/g, (_, s: string) => ENERGY_SYMBOLS[s] ?? s)
    .replace(/^Basic\s+/i, '')
    .trim();
}

const BASIC_ENERGY = new Set(Object.values(ENERGY_SYMBOLS).map((t) => `${t} Energy`.toLowerCase()));
export const isBasicEnergy = (name: string) => BASIC_ENERGY.has(normalizeEnergyName(name).toLowerCase());

const norm = (s: string) => normalizeEnergyName(s).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** FNV-1a, enough to tell apart two Pokemon with the same name but different stats. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/**
 * "Same in play" id. Trainers and Energy: the name. Pokemon: name plus HP, attacks and
 * abilities, so reprints match and same-name cards with different attacks do not.
 */
export function functionalId(c: Pick<TcgdexCard, 'name' | 'category' | 'hp' | 'attacks' | 'abilities'>): string {
  if (c.category !== 'Pokemon') return `${c.category.toLowerCase()}:${norm(c.name)}`;
  const play = JSON.stringify([
    c.hp ?? 0,
    (c.attacks ?? []).map((a) => [a.name, String(a.damage ?? ''), (a.cost ?? []).length]),
    (c.abilities ?? []).map((a) => a.name),
  ]);
  return `pokemon:${norm(c.name)}:${hash(play)}`;
}

const CATEGORY_LABEL: Record<TcgdexCard['category'], string> = { Pokemon: 'Pokémon', Trainer: 'Trainer', Energy: 'Energy' };

const format: ListFormat = {
  header: (line) => (/^(pok[eé]mon|trainers?|energy|total cards)\b\s*[:\-–]?\s*\d*\s*$/i.test(line) ? 'ignore' : undefined),
  splitPrinting: (rest) => splitTrailingSetNumber(rest) ?? { name: rest },
};

export function createPokemonAdapter(fetchFn: typeof fetchJson = fetchJson): GameAdapter {
  const setByCode = new Map<string, Promise<TcgdexSet | undefined>>();
  const setById = new Map<string, Promise<TcgdexSet>>();
  const cardById = new Map<string, Promise<TcgdexCard>>();

  /** Cache a request by key; a failed request is forgotten so the next call tries again. */
  const memo = <T,>(cache: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> => {
    let p = cache.get(key);
    if (!p) {
      p = make();
      cache.set(key, p);
      p.catch(() => cache.delete(key));
    }
    return p;
  };
  const getSetById = (id: string) => memo(setById, id, () => fetchFn<TcgdexSet>(`${API}/sets/${encodeURIComponent(id)}`));
  const getSetByCode = (code: string) =>
    memo(setByCode, code.toUpperCase(), () =>
      fetchFn<{ id: string }[]>(`${API}/sets?abbreviation.official=${encodeURIComponent(code.toUpperCase())}`).then((r) =>
        r[0] ? getSetById(r[0].id) : undefined,
      ),
    );
  const getCard = (id: string) => memo(cardById, id, () => fetchFn<TcgdexCard>(`${API}/cards/${encodeURIComponent(id)}`));

  const toCard = async (c: TcgdexCard): Promise<Card> => {
    const set = await getSetById(c.set.id).catch(() => undefined);
    return {
      game: 'pokemon',
      id: functionalId(c),
      name: c.category === 'Energy' ? normalizeEnergyName(c.name) : c.name,
      category: CATEGORY_LABEL[c.category],
      set: set?.abbreviation?.official,
      number: String(Number(c.localId)) === 'NaN' ? c.localId : String(Number(c.localId)),
      imageUrl: c.image ? `${c.image}/low.webp` : undefined,
      price: marketPrice(c),
      subtype: subtypeOf(c),
      limitGroup: /ace spec/i.test(c.rarity ?? '') ? 'ACE SPEC' : /^Radiant /.test(c.name) ? 'Radiant' : undefined,
      legal: legalFormats(c),
      text: [
        ...(c.abilities ?? []).map((a) => `${a.name}: ${a.effect ?? ''}`),
        ...(c.attacks ?? []).map((a) => `${a.name}${a.damage ? ` (${a.damage})` : ''}: ${a.effect ?? ''}`),
        c.effect ?? '',
      ].filter((t) => t.trim()).join('\n'),
    };
  };

  /** Full details of every printing with this name (TCG Pocket excluded). */
  const printings = async (name: string, limit = 12): Promise<TcgdexCard[]> => {
    const briefs = (await byName(name)).slice(0, limit);
    const cards = await pool(briefs, 6, (b) => getCard(b.id).catch(() => undefined));
    return cards.filter((c): c is TcgdexCard => !!c);
  };

  /** For a name-only line, prefer a current printing: Standard-legal, then Expanded-legal, then any with a set code; with art first. */
  const bestPrinting = async (name: string): Promise<TcgdexCard | undefined> => {
    const all = await printings(name, 8);
    const withCode = await pool(all, 6, async (c) => ({ c, code: (await getSetById(c.set.id).catch(() => undefined))?.abbreviation?.official }));
    const rank = (x: { c: TcgdexCard; code?: string }) => (x.c.legal?.standard ? 0 : x.c.legal?.expanded ? 1 : x.code ? 2 : 3);
    const score = (x: { c: TcgdexCard; code?: string }) => rank(x) * 2 + (x.c.image ? 0 : 1);
    return withCode.sort((a, b) => score(a) - score(b))[0]?.c;
  };

  /** Search by exact name, skipping TCG Pocket cards (a different game). */
  /** Set id → release position. TCGdex lists sets oldest first; its card results come in no useful order. */
  let setOrder: Promise<Map<string, number>> | undefined;
  const getSetOrder = () =>
    (setOrder ??= fetchFn<{ id: string }[]>(`${API}/sets`)
      .then((sets) => new Map(sets.map((s, i) => [s.id, i])))
      .catch(() => {
        setOrder = undefined; // try again next time
        return new Map<string, number>();
      }));

  /** Every printing with this name, newest set first (TCG Pocket cards are a different game). */
  const byName = async (name: string): Promise<TcgdexBrief[]> => {
    const [list, order] = await Promise.all([fetchFn<TcgdexBrief[]>(`${API}/cards?name=eq:${encodeURIComponent(name)}`), getSetOrder()]);
    const released = (b: TcgdexBrief) => order.get(b.id.slice(0, b.id.lastIndexOf('-'))) ?? -1;
    return list.filter((b) => !b.image?.includes('/tcgp/')).sort((a, b) => released(b) - released(a));
  };

  const resolveOne = async (line: ParsedLine): Promise<ResolvedLine> => {
    try {
      if (line.set && line.number) {
        try {
          const set = await getSetByCode(line.set);
          // Same name required: a wrong set code or number must not swap in another card.
          const brief = set?.cards.find(
            (b) => (b.localId === line.number || Number(b.localId) === Number(line.number)) && norm(b.name) === norm(line.name),
          );
          if (brief) return { line, card: await toCard(await getCard(brief.id)) };
        } catch {
          // The printing lookup failed (network); the name lookup below can still find the card.
        }
      }
      const best = await bestPrinting(normalizeEnergyName(line.name));
      return best ? { line, card: await toCard(best) } : { line };
    } catch {
      return { line };
    }
  };

  return {
    id: 'pokemon',
    tagRules: [
      { tag: 'supporter', test: (c) => c.subtype === 'Supporter' },
      { tag: 'item', test: (c) => c.subtype === 'Item' },
      { tag: 'tool', test: (c) => c.subtype === 'Tool' },
      { tag: 'stadium', test: (c) => c.subtype === 'Stadium' },
      { tag: 'gust', phrases: ["switch opponent benched pokemon active", "opponent benched pokemon switch active"] },
      { tag: 'switch', phrases: ['switch active pokemon benched pokemon'], not: ['opponent benched pokemon'] },
      { tag: 'energy accel', phrases: ['attach energy from deck', 'attach energy from discard', 'search deck energy attach'] },
      { tag: 'disruption', phrases: ['opponent shuffle hand', 'opponent discard', 'each player shuffle hand'] },
    ],
    name: 'Pokémon',
    source: { name: 'TCGdex', url: 'https://tcgdex.dev', prices: 'TCGplayer market price via TCGdex' },
    sections: [{ id: 'main', label: 'Deck' }],
    categories: ['Pokémon', 'Trainer', 'Energy'],
    formats: ['Standard', 'Expanded', 'Unlimited'],
    openingHand: 7,
    // Exactly 60 cards, at most 4 of a name; basic Energy is unlimited.
    deckRules: () => ({ size: 60, exact: true, sizeSections: ['main'], copyLimit: 4, unlimited: isBasicEnergy, groupLimits: { 'ACE SPEC': 1, Radiant: 1 }, extraCheck: needsBasic }),
    sampleList: 'Pokémon: 4\n4 Charmander MEW 4\nTrainer: 4\n4 Iono PAL 185\nEnergy: 4\n4 Basic {R} Energy SVE 2',
    listFormat: format,

    formatLine: (l) => [String(l.qty), l.name, l.set, l.number].filter(Boolean).join(' '),
    formatList(lines: DeckLine[]) {
      const groups = ['Pokémon', 'Trainer', 'Energy'].map((cat) => lines.filter((l) => (l.category ?? 'Trainer') === cat));
      return groups
        .map((g, i) => (g.length ? [`${['Pokémon', 'Trainer', 'Energy'][i]}: ${g.reduce((n, l) => n + l.qty, 0)}`, ...g.map((l) => this.formatLine(l))].join('\n') : ''))
        .filter(Boolean)
        .join('\n\n');
    },

    resolve: (lines) => pool(lines, 6, resolveOne),

    /** play.limitlesstcg.com player decklists (online tournaments); its API allows browser requests. */
    async importUrl(url) {
      const m = /play\.limitlesstcg\.com\/tournament\/([a-z0-9]+)\/player\/([^/?#]+)/i.exec(url);
      if (!m) return undefined;
      type Entry = { count: number; name: string; set?: string; number?: string };
      const standings = await fetchFn<{ player: string; decklist?: Record<string, Entry[]> }[]>(
        `https://play.limitlesstcg.com/api/tournaments/${encodeURIComponent(m[1])}/standings`,
      );
      const who = decodeURIComponent(m[2]).toLowerCase();
      const deck = standings.find((s) => s.player.toLowerCase() === who)?.decklist;
      if (!deck) throw new Error('That player has no public decklist in this tournament.');
      return ['pokemon', 'trainer', 'energy']
        .flatMap((k) => (deck[k] ?? []).map((c) => [c.count, c.name, c.set, c.number].filter(Boolean).join(' ')))
        .join('\n');
    },

    /**
     * A card is legal if any printing with the same text is legal, so check every
     * printing of cards whose stored printing is not.
     */
    async checkLegality(cards, format) {
      const f = format.toLowerCase();
      const out = new Map<string, boolean>();
      await pool(cards, 3, async (card) => {
        if (card.legal?.includes(f)) return out.set(card.id, true);
        const same = (await printings(card.name, 24).catch(() => [])).filter((c) => functionalId(c) === card.id);
        out.set(card.id, same.some((c) => legalFormats(c).includes(f)));
      });
      return out;
    },

    async search(query) {
      const q = query.trim();
      if (!q) return [];
      const list = await fetchFn<TcgdexBrief[]>(`${API}/cards?name=like:${encodeURIComponent(q)}&pagination:itemsPerPage=16`);
      const briefs = list.filter((b) => !b.image?.includes('/tcgp/')).slice(0, 12);
      const cards = await pool(briefs, 8, async (b) => toCard(await getCard(b.id)).catch(() => undefined));
      return cards.filter((c): c is Card => !!c);
    },
  };
}

export const pokemonAdapter = createPokemonAdapter();
