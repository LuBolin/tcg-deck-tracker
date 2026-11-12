import type { ListFormat, ParsedLine } from '../domain/listParse';
import type { DeckRules } from '../domain/rules';
import type { Card, DeckLine, GameId } from '../domain/types';

/** Everything game-specific lives behind this interface. Add a game by adding an adapter. */
export interface GameAdapter {
  id: GameId;
  name: string;
  /** Where card data and prices come from, for credits and price notes. */
  source: { name: string; url: string; prices?: string };
  /** Deck sections in display order. The first one is the main deck. */
  sections: { id: string; label: string }[];
  /** Category order for grouping cards inside a section. */
  categories: string[];
  formats: string[];
  /** Construction rules (size, copy limit) for a format, or the game's default when none is set. */
  deckRules(format?: string): DeckRules;
  /** Cards in an opening hand, for draw odds. */
  openingHand: number;
  /** Example list shown in the import box. */
  sampleList: string;

  /** Rules for reading list text; used with parseList and parseWantList from the domain. */
  listFormat: ListFormat;
  /** Optional: turn a deck page URL into list text. Undefined = this URL is not supported. */
  importUrl?(url: string): Promise<string | undefined>;
  /** Optional rewrite of pasted text before parsing, for formats that are not "qty name" lines (.ydk). */
  preprocess?(text: string): string;
  /** Deck list text in the game's usual export format. */
  formatList(lines: DeckLine[]): string;
  /** More export formats beyond the plain list, for example a .ydk file. */
  exports?: { label: string; format(lines: DeckLine[]): string }[];
  /** One line, for example "4 Iono PAL 185". */
  formatLine(line: { qty: number; name: string; set?: string; number?: string }): string;

  /** Optional: the section a card must go in regardless of where it was added (Extra Deck, Leader). */
  sectionFor?(card: Card): string | undefined;
  /** Match parsed lines to cards. Unmatched lines come back without a card. */
  resolve(lines: ParsedLine[]): Promise<ResolvedLine[]>;
  search(query: string): Promise<Card[]>;
  /**
   * Optional deeper legality check for cards whose stored data says "not legal" or is unknown.
   * Without it, `Card.legal` is taken as is.
   */
  checkLegality?(cards: Card[], format: string): Promise<Map<string, boolean>>;
}

export interface ResolvedLine {
  line: ParsedLine;
  card?: Card;
}
