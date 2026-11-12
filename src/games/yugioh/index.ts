import type { ListFormat, ParsedLine } from '../../domain/listParse';
import type { Card, DeckLine } from '../../domain/types';
import { chunk, fetchJson, formatSections, rankByName } from '../common';
import type { GameAdapter, ResolvedLine } from '../types';

/**
 * Yu-Gi-Oh! TCG. Card data from YGOPRODeck (https://ygoprodeck.com/api-guide/).
 * "Same in play" = the passcode (reprints share it). Lists: "3 Ash Blossom & Joyous Spring"
 * with Main/Extra/Side headers, or a .ydk file (one passcode per copy).
 */
const API = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';

interface YgoCard {
  id: number;
  name: string;
  type: string;
  frameType: string;
  card_images?: { image_url_small?: string }[];
  card_prices?: { tcgplayer_price?: string }[];
  card_sets?: { set_code: string }[];
  banlist_info?: { ban_tcg?: string };
}

const EXTRA_FRAMES = new Set(['fusion', 'synchro', 'xyz', 'link', 'fusion_pendulum', 'synchro_pendulum', 'xyz_pendulum']);
const BAN_LIMIT: Record<string, number> = { Forbidden: 0, Limited: 1, 'Semi-Limited': 2 };
/** Marks a .ydk passcode line after preprocessing, so resolve can look it up by id. */
const PASSCODE = '#';

export function category(c: Pick<YgoCard, 'type' | 'frameType'>): string {
  if (c.frameType === 'spell') return 'Spell';
  if (c.frameType === 'trap') return 'Trap';
  const f = c.frameType.replace('_pendulum', '');
  if (EXTRA_FRAMES.has(c.frameType)) return f[0].toUpperCase() + f.slice(1);
  return 'Monster';
}

export function toCard(c: YgoCard): Card {
  const ban = c.banlist_info?.ban_tcg;
  return {
    game: 'yugioh',
    id: String(c.id),
    name: c.name,
    category: category(c),
    set: c.card_sets?.[0]?.set_code,
    imageUrl: c.card_images?.[0]?.image_url_small,
    price: Number(c.card_prices?.[0]?.tcgplayer_price) || undefined,
    maxCopies: ban ? BAN_LIMIT[ban] : undefined,
  };
}

/** .ydk files ("#main", passcodes, "#extra", "!side") become counted lines: "3 #14558127". */
export function ydkToList(text: string): string {
  if (!/^\s*#main\s*$/im.test(text)) return text;
  const out: string[] = [];
  let header = 'Main Deck';
  let counts = new Map<string, number>();
  const flush = () => {
    if (counts.size) out.push(header, ...[...counts].map(([id, n]) => `${n} ${PASSCODE}${id}`), '');
    counts = new Map();
  };
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (/^#main/i.test(l)) { flush(); header = 'Main Deck'; }
    else if (/^#extra/i.test(l)) { flush(); header = 'Extra Deck'; }
    else if (/^!side/i.test(l)) { flush(); header = 'Side Deck'; }
    else if (/^\d+$/.test(l)) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  flush();
  return out.join('\n');
}

/** .ydk for simulators such as EDOPro: one passcode per copy, by section. */
export function toYdk(lines: DeckLine[]): string {
  const ids = (section: string) => lines.filter((l) => l.section === section).flatMap((l) => Array(l.qty).fill(l.cardId));
  return ['#created by TCG Deck Tracker', '#main', ...ids('main'), '#extra', ...ids('extra'), '!side', ...ids('sideboard')].join('\n');
}

const format: ListFormat = {
  header: (line) => {
    const l = line.toLowerCase().replace(/[:\s\d-]+$/, '').trim();
    if (l === 'main deck' || l === 'main' || l === 'monster' || l === 'monsters' || l === 'spells' || l === 'spell' || l === 'traps' || l === 'trap') return 'main';
    if (l === 'extra deck' || l === 'extra') return 'extra';
    if (l === 'side deck' || l === 'side' || l === 'sideboard') return 'sideboard';
    if (l.startsWith('#created') || l === 'total' || l.startsWith('deck list')) return 'ignore';
    return undefined;
  },
  splitPrinting: (rest) => ({ name: rest.trim() }),
};

export function createYugiohAdapter(fetchFn: typeof fetchJson = fetchJson): GameAdapter {
  /** YGOPRODeck answers 400 when none of the names exist; treat that as "no cards". */
  const query = async (params: string): Promise<YgoCard[]> => {
    try {
      return (await fetchFn<{ data: YgoCard[] }>(`${API}?${params}`)).data;
    } catch (e) {
      if (e instanceof Error && /\((400|404)\)/.test(e.message)) return [];
      throw e;
    }
  };

  return {
    id: 'yugioh',
    name: 'Yu-Gi-Oh!',
    source: { name: 'YGOPRODeck', url: 'https://ygoprodeck.com', prices: 'TCGplayer price via YGOPRODeck' },
    sections: [
      { id: 'main', label: 'Main Deck' },
      { id: 'extra', label: 'Extra Deck' },
      { id: 'sideboard', label: 'Side Deck' },
    ],
    categories: ['Monster', 'Spell', 'Trap', 'Fusion', 'Synchro', 'Xyz', 'Link'],
    formats: ['Advanced'],
    openingHand: 5,
    sampleList: 'Main Deck\n3 Ash Blossom & Joyous Spring\n3 Pot of Prosperity\n\nExtra Deck\n1 Accesscode Talker\n\nSide Deck\n2 Droll & Lock Bird',
    listFormat: format,
    preprocess: ydkToList,
    // Main 40-60, Extra and Side up to 15, 3 per name, lower for banlisted cards.
    deckRules: () => ({ size: 40, exact: false, maxSize: 60, sizeSections: ['main'], copyLimit: 3, unlimited: () => false, sectionMax: { extra: 15, sideboard: 15 } }),

    sectionFor: (card) => (['Fusion', 'Synchro', 'Xyz', 'Link'].includes(card.category ?? '') ? 'extra' : undefined),
    formatLine: (l) => `${l.qty} ${l.name}`,
    exports: [{ label: '.ydk file', format: toYdk }],
    formatList(lines: DeckLine[]) {
      return formatSections(lines, this, (s) => s.label);
    },

    async resolve(lines: ParsedLine[]): Promise<ResolvedLine[]> {
      const byId = lines.filter((l) => l.name.startsWith(PASSCODE)).map((l) => l.name.slice(1));
      const byName = [...new Set(lines.filter((l) => !l.name.startsWith(PASSCODE)).map((l) => l.name))];
      const cards: YgoCard[] = [];
      for (const ids of chunk([...new Set(byId)], 40)) cards.push(...(await query(`id=${ids.join(',')}`)));
      for (const names of chunk(byName, 20)) cards.push(...(await query(`name=${names.map(encodeURIComponent).join('|')}`)));
      return lines.map((line) => {
        const c = line.name.startsWith(PASSCODE)
          ? cards.find((x) => String(x.id) === line.name.slice(1))
          : cards.find((x) => x.name.toLowerCase() === line.name.toLowerCase());
        if (!c) return { line };
        const card = toCard(c);
        // Extra Deck monsters belong in the Extra Deck even when a list has no headers.
        const section = line.section === 'main' && EXTRA_FRAMES.has(c.frameType) ? 'extra' : line.section;
        return { line: { ...line, section, name: c.name }, card };
      });
    },

    async search(q) {
      const term = q.trim();
      if (!term) return [];
      const found = await query(`fname=${encodeURIComponent(term)}&num=40&offset=0`);
      return rankByName(found.map(toCard), term).slice(0, 24);
    },
  };
}

export const yugiohAdapter = createYugiohAdapter();
