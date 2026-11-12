import { applyDeltas, emptyDeckDeltas } from '../domain/collection';
import type { Card, Change, CopyRow, Deck, PrintRow } from '../domain/types';
import type { Backup, Prefs, Repository } from './repository';

const DB_NAME = 'tcg-deck-tracker';
const STORE = 'kv';
const KEY = 'state';
const PREFS = 'prefs';

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = run(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = () => reject(tx.error);
  });
}

const empty = (): Backup => ({ version: 1, decks: [], changes: [], copies: [], cards: [], prints: [] });
const clone = <T>(v: T): T => structuredClone(v);

/**
 * Local-only repository for development before Supabase is set up.
 * shortcut: stores all data as one IndexedDB object. Fine for one player's decks;
 * the Supabase repository replaces it.
 *
 * Safe with several tabs: every write reads, changes and saves the stored object in one
 * readwrite transaction (IndexedDB runs these one at a time), and tells other instances to
 * drop their cached copy.
 */
export class LocalRepository implements Repository {
  private state?: Promise<Backup>;
  private db?: Promise<IDBDatabase>;
  private readonly dbName: string;
  private readonly channel?: BroadcastChannel;

  constructor(dbName = DB_NAME) {
    this.dbName = dbName;
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`repo:${dbName}`);
      this.channel.onmessage = () => { this.state = undefined; };
    }
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= openDb(this.dbName);
    return this.db;
  }

  private load(): Promise<Backup> {
    this.state ??= this.open().then(async (db) => (await idb<Backup | undefined>(db, 'readonly', (s) => s.get(KEY))) ?? empty());
    return this.state;
  }

  /** Read the stored data, change it and save it, all in one transaction. A throwing change saves nothing. */
  private async write(mutate: (s: Backup) => void): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let next: Backup;
      let failure: unknown;
      const req = store.get(KEY);
      req.onsuccess = () => {
        next = (req.result as Backup | undefined) ?? empty();
        try {
          mutate(next);
          store.put(next, KEY);
        } catch (e) {
          failure = e;
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        this.state = Promise.resolve(next);
        this.channel?.postMessage('changed');
        resolve();
      };
      tx.onabort = () => reject(failure ?? tx.error);
      tx.onerror = () => { if (!failure) reject(tx.error); };
    });
  }

  async listDecks() {
    return clone((await this.load()).decks);
  }
  async getDeck(id: string) {
    return clone((await this.load()).decks.find((d) => d.id === id));
  }
  putDeck(deck: Deck) {
    return this.write((s) => {
      s.decks = [...s.decks.filter((d) => d.id !== deck.id), clone(deck)];
    });
  }
  /** Copies located in the deck go back to the binder in the same transaction (like the SQL trigger). */
  deleteDeck(id: string) {
    return this.write((s) => {
      const deck = s.decks.find((d) => d.id === id);
      if (deck) {
        const deltas = emptyDeckDeltas(s.copies.filter((c) => c.game === deck.game), id);
        const updated = applyDeltas(s.copies.filter((c) => c.game === deck.game), deck.game, deltas);
        s.copies = [...s.copies.filter((c) => c.game !== deck.game), ...updated];
      }
      s.decks = s.decks.filter((d) => d.id !== id);
      s.changes = s.changes.filter((c) => c.deckId !== id);
    });
  }

  async listChanges(deckId: string) {
    const all = (await this.load()).changes.filter((c) => c.deckId === deckId);
    return clone(all.sort((a, b) => a.seq - b.seq));
  }
  addChange(change: Change) {
    return this.write((s) => {
      if (s.changes.some((c) => c.deckId === change.deckId && c.seq === change.seq)) {
        throw new Error(`Change ${change.seq} already exists for this deck`);
      }
      s.changes.push(clone(change));
    });
  }

  async listCopies(game: string) {
    return clone((await this.load()).copies.filter((c) => c.game === game));
  }
  adjustCopies(game: string, deltas: { cardId: string; location: string; delta: number }[]) {
    return this.write((s) => {
      const mine = s.copies.filter((c) => c.game === game);
      const updated: CopyRow[] = applyDeltas(mine, game, deltas); // throws before anything changes
      s.copies = [...s.copies.filter((c) => c.game !== game), ...updated];
    });
  }

  async listPrints(game: string) {
    return clone(((await this.load()).prints ?? []).filter((p) => p.game === game));
  }
  setPrint(row: PrintRow) {
    if (!Number.isInteger(row.qty) || row.qty < 0) return Promise.reject(new Error('A printing count must be a whole number, 0 or more'));
    return this.write((s) => {
      const same = (p: PrintRow) => p.game === row.game && p.cardId === row.cardId && p.printId === row.printId;
      s.prints = [...(s.prints ?? []).filter((p) => !same(p)), ...(row.qty > 0 ? [clone(row)] : [])];
    });
  }

  async getCards(game: string, ids: string[]) {
    const want = new Set(ids);
    return clone((await this.load()).cards.filter((c) => c.game === game && want.has(c.id)));
  }
  putCards(cards: Card[]) {
    return this.write((s) => {
      const k = (c: Card) => `${c.game}|${c.id}`;
      const incoming = new Map(cards.map((c) => [k(c), clone(c)]));
      s.cards = [...s.cards.filter((c) => !incoming.has(k(c))), ...incoming.values()];
    });
  }

  async getPrefs() {
    const db = await this.open();
    return (await idb<Prefs | undefined>(db, 'readonly', (s) => s.get(PREFS))) ?? {};
  }
  async setPrefs(prefs: Prefs) {
    const db = await this.open();
    await idb(db, 'readwrite', (s) => s.put(clone(prefs), PREFS));
  }

  async exportAll() {
    return clone(await this.load());
  }
  importAll(backup: Backup) {
    const lists = [backup?.decks, backup?.changes, backup?.copies, backup?.cards, backup?.prints ?? []];
    if (backup?.version !== 1 || !lists.every(Array.isArray)) {
      return Promise.reject(new Error('This file is not a TCG Deck Tracker backup'));
    }
    return this.write((s) => {
      Object.assign(s, empty(), clone(backup));
    });
  }
}
