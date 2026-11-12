/** Game-neutral domain types. Nothing here knows about a specific TCG. */

export type GameId = string;

/** Where a physical copy is. Either the binder or a deck id. */
export type Location = string;
export const BINDER: Location = 'binder';

/**
 * A card as the game plays it. Printings that are the same in play share one id
 * (the game adapter decides what "same in play" means).
 */
export interface Card {
  game: GameId;
  id: string;
  name: string;
  /** Grouping label, for example "Trainer" or "Creature". */
  category?: string;
  /** Finer type inside the category, for example "Basic" (Pokémon stage) or "Supporter". */
  subtype?: string;
  /** Default printing, used for display and export. */
  set?: string;
  number?: string;
  imageUrl?: string;
  /** Market price in USD for the default printing, when the card source has one. */
  price?: number;
  /** Format names (lowercase) the card is legal in. Undefined = not known. */
  legal?: string[];
  /** Mana value or similar cost, for curve stats. */
  cost?: number;
  /** Per-card copy limit from a banlist (0 = forbidden). Undefined = the format's normal limit. */
  maxCopies?: number;
  /** Color identity letters (MTG: W U B R G), for Commander deck checks. */
  identity?: string[];
  /** A deck-wide limit group the card belongs to, for example "ACE SPEC" (Pokémon: 1 per deck). */
  limitGroup?: string;
  /** Rules text (abilities, attacks, effects), for role tags and text search. '' = no text. */
  text?: string;
  /** When the app last fetched this card's data (ISO time); prices and legality go stale. */
  fetchedAt?: string;
}

/** One line of a deck list. */
export interface DeckLine {
  cardId: string;
  /** Cached so a list renders without card data. */
  name: string;
  qty: number;
  /** Section id from the game adapter, for example "main" or "sideboard". */
  section: string;
  set?: string;
  number?: string;
  category?: string;
}

export interface Deck {
  id: string;
  game: GameId;
  name: string;
  format?: string;
  /** When to play this deck, for example "Use against aggro-heavy locals". */
  purpose?: string;
  /** Labels for when to play it or what it is, for example "vs aggro" or "budget" (like GitHub labels). */
  labels?: string[];
  /** Locked decks are put away: their copies are not offered for gathering and collapse into one chip elsewhere. */
  locked?: boolean;
  /** The deck this variant was made from. */
  parentDeckId?: string;
  /** The parent's change this variant is based on (moves forward when parent changes are applied or dismissed). */
  parentChangeId?: string;
  /** Signed-in players only: anyone can view the deck and its history, and followers see its changes. */
  isPublic?: boolean;
  /** The parent's change this variant was made from. Never moves, so the version graph can show where it started. */
  originChangeId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Every save of a deck. Holds a full snapshot of the list. */
export interface Change {
  id: string;
  deckId: string;
  /** 1-based, per deck. */
  seq: number;
  createdAt: string;
  lines: DeckLine[];
  tags: string[];
  note: string;
  /** Optional match result, for example "3-1 vs Deck X". */
  result: string;
  /** For a change taken from the parent deck: that parent change. */
  sourceChangeId?: string;
}

/** Count of physical copies of one card at one location. */
export interface CopyRow {
  game: GameId;
  cardId: string;
  location: Location;
  qty: number;
}

/**
 * Which printing some of the player's copies of a card are (a special art, a rarity). Labels only:
 * where copies are, and every deck check, uses CopyRow totals. The labels of a card add up to at most its copies.
 */
export interface PrintRow {
  game: GameId;
  cardId: string;
  /** The card source's id for this printing, for example TCGdex "sv10-186". */
  printId: string;
  qty: number;
  rarity?: string;
  set?: string;
  number?: string;
  imageUrl?: string;
}

export interface CopyDelta {
  cardId: string;
  location: Location;
  delta: number;
}

export const REASON_TAGS = [
  'vs aggro',
  'vs control',
  'budget',
  'meta shift',
  'testing',
  'new set',
] as const;
