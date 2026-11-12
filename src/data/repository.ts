import type { Card, Change, CopyDelta, CopyRow, Deck, GameId, PrintRow } from '../domain/types';

/**
 * Storage boundary. The app talks only to this interface.
 * Implementations: local IndexedDB (now) and Supabase (later, see supabase/migrations).
 */
export interface Repository {
  listDecks(): Promise<Deck[]>;
  getDeck(id: string): Promise<Deck | undefined>;
  putDeck(deck: Deck): Promise<void>;
  /** Deletes the deck and its changes, and moves copies located in it to the binder, all at once. */
  deleteDeck(id: string): Promise<void>;

  /** Ordered by seq, oldest first. */
  listChanges(deckId: string): Promise<Change[]>;
  addChange(change: Change): Promise<void>;

  listCopies(game: GameId): Promise<CopyRow[]>;
  /** Applied all-or-nothing. Rejects if any location would go below zero. */
  adjustCopies(game: GameId, deltas: CopyDelta[]): Promise<void>;

  /** Printing labels of owned copies. */
  listPrints(game: GameId): Promise<PrintRow[]>;
  /** Set how many owned copies are this printing; qty 0 removes the label. */
  setPrint(row: PrintRow): Promise<void>;

  getCards(game: GameId, ids: string[]): Promise<Card[]>;
  putCards(cards: Card[]): Promise<void>;

  /** Settings that follow the player (role names, basic-card tracking). Not part of backups. */
  getPrefs(): Promise<Prefs>;
  setPrefs(prefs: Prefs): Promise<void>;

  exportAll(): Promise<Backup>;
  /** Replaces all data. */
  importAll(backup: Backup): Promise<void>;
}

export type Prefs = Record<string, unknown>;

export interface Backup {
  version: 1;
  decks: Deck[];
  changes: Change[];
  copies: CopyRow[];
  cards: Card[];
  /** Missing in backups made before printings were tracked. */
  prints?: PrintRow[];
}
