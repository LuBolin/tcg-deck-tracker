import type { SupabaseClient } from '@supabase/supabase-js';
import type { Card, Change, CopyDelta, CopyRow, Deck, DeckLine, GameId } from '../domain/types';
import type { Backup, Repository } from './repository';

/** Rows as Postgres stores them (supabase/migrations/0001_init.sql). */
interface DeckRow {
  id: string; game: string; name: string; format: string | null; purpose: string | null; labels: string[] | null; locked: boolean | null;
  parent_deck_id: string | null; parent_change_id: string | null; created_at: string; updated_at: string;
}
interface ChangeRow { id: string; deck_id: string; seq: number; created_at: string; lines: DeckLine[]; tags: string[]; note: string; result: string }
interface CopyDbRow { game: string; card_id: string; location: string; qty: number }
interface CardRow {
  game: string; id: string; name: string; category: string | null; subtype: string | null; set_code: string | null;
  number: string | null; image_url: string | null; price: number | string | null; legal: string[] | null; cost: number | string | null;
  max_copies: number | null; identity: string[] | null; limit_group: string | null; text: string | null; updated_at: string;
}

const opt = <T,>(v: T | null): T | undefined => (v === null ? undefined : v);
const num = (v: number | string | null) => (v === null ? undefined : Number(v)); // numeric columns arrive as strings

const toDeck = (r: DeckRow): Deck => ({
  id: r.id, game: r.game, name: r.name, format: opt(r.format), purpose: opt(r.purpose),
  labels: r.labels?.length ? r.labels : undefined, locked: r.locked || undefined,
  parentDeckId: opt(r.parent_deck_id), parentChangeId: opt(r.parent_change_id), createdAt: r.created_at, updatedAt: r.updated_at,
});
const toChange = (r: ChangeRow): Change => ({
  id: r.id, deckId: r.deck_id, seq: r.seq, createdAt: r.created_at, lines: r.lines, tags: r.tags, note: r.note, result: r.result,
});
const toCard = (r: CardRow): Card => ({
  game: r.game, id: r.id, name: r.name, category: opt(r.category), subtype: opt(r.subtype), set: opt(r.set_code),
  number: opt(r.number), imageUrl: opt(r.image_url), price: num(r.price), legal: opt(r.legal), cost: num(r.cost),
  maxCopies: opt(r.max_copies), identity: opt(r.identity), limitGroup: opt(r.limit_group), text: opt(r.text), fetchedAt: r.updated_at,
});
const fromCard = (c: Card) => ({
  game: c.game, id: c.id, name: c.name, category: c.category ?? null, subtype: c.subtype ?? null, set_code: c.set ?? null,
  number: c.number ?? null, image_url: c.imageUrl ?? null, price: c.price ?? null, legal: c.legal ?? null, cost: c.cost ?? null,
  max_copies: c.maxCopies ?? null, identity: c.identity ?? null, limit_group: c.limitGroup ?? null, text: c.text ?? null,
  updated_at: c.fetchedAt ?? new Date().toISOString(),
});

type Result<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
const PAGE = 1000; // PostgREST's default row limit

async function must<T>(q: Result<T>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as T;
}

/** Every row of a query, page by page (the query must have a stable order). */
async function all<T>(page: (from: number, to: number) => Result<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = await must(page(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const chunks = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/**
 * Storage in the signed-in user's Supabase account. Row-level security limits writes to their own rows;
 * reads filter by owner too, because public decks of other users are readable.
 */
export class SupabaseRepository implements Repository {
  private readonly db: SupabaseClient;
  private readonly userId: string;

  constructor(db: SupabaseClient, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  async listDecks() {
    const rows = await all<DeckRow>((a, b) => this.db.from('decks').select('*').eq('owner_id', this.userId).order('id').range(a, b));
    return rows.map(toDeck);
  }
  async getDeck(id: string) {
    const row = await must<DeckRow | null>(this.db.from('decks').select('*').eq('owner_id', this.userId).eq('id', id).maybeSingle());
    return row ? toDeck(row) : undefined;
  }
  async putDeck(d: Deck) {
    await must(this.db.from('decks').upsert({
      id: d.id, game: d.game, name: d.name, format: d.format ?? null, purpose: d.purpose ?? null, labels: d.labels ?? [], locked: d.locked ?? false,
      parent_deck_id: d.parentDeckId ?? null, parent_change_id: d.parentChangeId ?? null, created_at: d.createdAt, updated_at: d.updatedAt,
    }));
  }
  /** The decks_copies_to_binder trigger moves the deck's copies to the binder in the same statement. */
  async deleteDeck(id: string) {
    await must(this.db.from('decks').delete().eq('id', id));
  }

  async listChanges(deckId: string) {
    const rows = await all<ChangeRow>((a, b) => this.db.from('changes').select('*').eq('deck_id', deckId).order('seq').range(a, b));
    return rows.map(toChange);
  }
  async addChange(c: Change) {
    const { error } = await this.db.from('changes').insert({
      id: c.id, deck_id: c.deckId, seq: c.seq, created_at: c.createdAt, lines: c.lines, tags: c.tags, note: c.note, result: c.result,
    });
    if (error?.code === '23505') throw new Error(`Change ${c.seq} already exists for this deck`);
    if (error) throw new Error(error.message);
  }

  /** Copies of one game, or of every game. */
  async listCopies(game?: GameId) {
    const rows = await all<CopyDbRow>((a, b) => {
      const q = this.db.from('copies').select('game, card_id, location, qty').eq('owner_id', this.userId);
      return (game ? q.eq('game', game) : q).order('game').order('card_id').order('location').range(a, b);
    });
    return rows.map((r): CopyRow => ({ game: r.game, cardId: r.card_id, location: r.location, qty: r.qty }));
  }
  /** All-or-nothing in Postgres (adjust_copies raises before committing an overdraw). */
  async adjustCopies(game: GameId, deltas: CopyDelta[]) {
    await must(this.db.rpc('adjust_copies', { p_game: game, p_deltas: deltas }));
  }

  async getCards(game: GameId, ids: string[]) {
    const out: Card[] = [];
    for (const part of chunks([...new Set(ids)], 100)) {
      out.push(...(await must<CardRow[]>(this.db.from('cards').select('*').eq('game', game).in('id', part))).map(toCard));
    }
    return out;
  }
  async putCards(cards: Card[]) {
    for (const part of chunks(cards, 500)) await must(this.db.from('cards').upsert(part.map(fromCard)));
  }

  async exportAll(): Promise<Backup> {
    const decks = await this.listDecks();
    const changes: Change[] = [];
    for (const part of chunks(decks.map((d) => d.id), 100)) {
      const rows = await all<ChangeRow>((a, b) => this.db.from('changes').select('*').in('deck_id', part).order('id').range(a, b));
      changes.push(...rows.map(toChange));
    }
    const copies = await this.listCopies();
    const ids = new Map<string, Set<string>>();
    const want = (game: string, id: string) => (ids.get(game) ?? ids.set(game, new Set()).get(game)!).add(id);
    for (const c of changes) {
      const game = decks.find((d) => d.id === c.deckId)!.game;
      for (const l of c.lines) want(game, l.cardId);
    }
    for (const c of copies) want(c.game, c.cardId);
    const cards: Card[] = [];
    for (const [game, set] of ids) cards.push(...(await this.getCards(game, [...set])));
    return { version: 1, decks, changes, copies, cards };
  }
  /** Replaces the account's data in one transaction (supabase/migrations/0002_import_all.sql). */
  async importAll(backup: Backup) {
    const lists = [backup?.decks, backup?.changes, backup?.copies, backup?.cards];
    if (backup?.version !== 1 || !lists.every(Array.isArray)) throw new Error('This file is not a TCG Deck Tracker backup');
    await must(this.db.rpc('import_all', { p_backup: backup }));
  }
}
