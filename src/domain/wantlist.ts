import { locationsOf } from './collection';
import { parseList, type ListFormat, type ParsedLine } from './listParse';
import { BINDER, type CopyRow, type Location } from './types';

export interface WantItem {
  qty: number;
  name: string;
  set?: string;
  number?: string;
  /** Offer price as typed, for example "$3.50". */
  price?: string;
}

export interface WantListOptions {
  contact?: string;
  appName: string;
  /** Named in the title so the reader's app can pick the right game. */
  gameName?: string;
  /** "buy" (default): a want-list. "sell": a list of spares for sale. */
  kind?: 'buy' | 'sell';
}

/** The game named in a list title ("Want to buy (Pokémon)", "Selling (Yu-Gi-Oh!)"), if any. */
export function wantListGame(text: string): string | undefined {
  return /(?:want to buy|selling)\s*\(([^)]+)\)/i.exec(text)?.[1].trim();
}

/** Whether pasted text is a selling list rather than a want-list. */
export const tradeListKind = (text: string): 'buy' | 'sell' => (/^\s*selling\b/im.test(text) ? 'sell' : 'buy');

const PRICE = /\s+@\s*(\S.*)$/;

/**
 * The amount in a typed price: the number next to a currency sign if there is one, else the
 * first number. A comma works as the decimal mark ("3,50 €" is 3.5).
 */
export function parsePrice(text: string): number | undefined {
  // Digits with optional thousands groups, then an optional 1-2 digit decimal part.
  const num = '(\\d{1,3}(?:[.,\\s]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';
  const m = new RegExp(`[$€£¥]\\s*${num}`).exec(text) ?? new RegExp(`${num}\\s*[$€£¥]`).exec(text) ?? new RegExp(num).exec(text);
  if (!m) return undefined;
  const raw = m[1];
  // The last separator followed by 1-2 digits is the decimal mark; every other separator groups thousands.
  const dec = /[.,](\d{1,2})$/.exec(raw);
  const whole = (dec ? raw.slice(0, dec.index) : raw).replace(/[.,\s]/g, '');
  return Number(dec ? `${whole}.${dec[1]}` : whole);
}

export function formatWantList(
  items: WantItem[],
  formatLine: (item: WantItem) => string,
  opts: WantListOptions,
): string {
  const title = opts.kind === 'sell' ? 'Selling' : 'Want to buy';
  const out = [opts.gameName ? `${title} (${opts.gameName})` : title];
  for (const it of items) out.push(formatLine(it) + (it.price ? ` @ ${it.price}` : ''));
  if (opts.contact) out.push(`Contact: ${opts.contact}`);
  out.push(`Made with ${opts.appName} · paste this list there to check ${opts.kind === 'sell' ? 'what your decks need' : 'your spares'}`);
  return out.join('\n');
}

/**
 * Read a want-list message. Lines that are not card lines (titles, contact, footer)
 * are skipped, so a message pasted from a chat works as is.
 */
export function parseWantList(text: string, format: ListFormat): { items: (WantItem & { line: ParsedLine })[] } {
  const prices = new Map<number, string>();
  const cleaned = text
    .split(/\r?\n/)
    .map((l, i) => {
      const m = PRICE.exec(l);
      if (!m) return l;
      prices.set(i + 1, m[1].trim());
      return l.slice(0, m.index);
    })
    .join('\n');
  const { lines } = parseList(cleaned, { ...format, blankLineStartsSideboard: false });
  return {
    items: lines.map((line) => ({
      qty: line.qty,
      name: line.name,
      set: line.set,
      number: line.number,
      price: prices.get(line.lineNo),
      line,
    })),
  };
}

export interface WantMatch {
  wanted: number;
  /** Copies in the binder, which no deck uses. */
  spare: number;
  inDecks: { location: Location; qty: number }[];
}

export function matchWant(cardId: string | undefined, wanted: number, copies: CopyRow[]): WantMatch {
  const locs = cardId ? locationsOf(copies, cardId) : [];
  return {
    wanted,
    spare: locs.find((l) => l.location === BINDER)?.qty ?? 0,
    inDecks: locs.filter((l) => l.location !== BINDER),
  };
}
