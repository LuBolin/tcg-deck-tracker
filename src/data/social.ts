import type { SupabaseClient } from '@supabase/supabase-js';
import type { Change, Deck, DeckLine } from '../domain/types';

/**
 * Following other players and seeing their public decks (supabase/migrations/0005_social.sql).
 * Signed-in only; row-level security decides what each player can read and change.
 */
export interface Profile { id: string; handle: string; displayName?: string }
export interface FeedItem {
  changeId: string; deckId: string; deckName: string; game: string; ownerId: string; handle?: string; displayName?: string;
  seq: number; note: string; tags: string[]; result: string; createdAt: string;
}

/** Handles are 3 to 20 lowercase letters, digits or underscores (the database checks the same). */
export const HANDLE = /^[a-z0-9_]{3,20}$/;

type Result<T> = PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>;
async function must<T>(q: Result<T>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(error.code === '23505' ? 'That handle is taken. Try another.' : error.message);
  return data as T;
}
interface ProfileRow { id: string; handle: string; display_name: string | null }
const toProfile = (r: ProfileRow): Profile => ({ id: r.id, handle: r.handle, displayName: r.display_name ?? undefined });

export class Social {
  private readonly db: SupabaseClient;
  readonly userId: string;
  constructor(db: SupabaseClient, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  async myProfile(): Promise<Profile | undefined> {
    const r = await must<ProfileRow | null>(this.db.from('profiles').select('id, handle, display_name').eq('id', this.userId).maybeSingle());
    return r ? toProfile(r) : undefined;
  }
  async saveProfile(handle: string, displayName: string) {
    const h = handle.trim().toLowerCase();
    if (!HANDLE.test(h)) throw new Error('A handle is 3 to 20 lowercase letters, digits or underscores.');
    await must(this.db.from('profiles').upsert({ id: this.userId, handle: h, display_name: displayName.trim() || null }));
  }
  async profile(handle: string): Promise<Profile | undefined> {
    const r = await must<ProfileRow | null>(this.db.from('profiles').select('id, handle, display_name').eq('handle', handle.toLowerCase()).maybeSingle());
    return r ? toProfile(r) : undefined;
  }
  async findProfiles(query: string): Promise<Profile[]> {
    const q = query.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!q) return [];
    return (await must<ProfileRow[]>(this.db.from('profiles').select('id, handle, display_name').ilike('handle', `${q}%`).order('handle').limit(10))).map(toProfile);
  }

  async following(): Promise<Profile[]> {
    const rows = await must<{ followee_id: string }[]>(this.db.from('follows').select('followee_id').eq('follower_id', this.userId));
    if (rows.length === 0) return [];
    return (await must<ProfileRow[]>(this.db.from('profiles').select('id, handle, display_name').in('id', rows.map((r) => r.followee_id)).order('handle'))).map(toProfile);
  }
  async followerCount(userId: string): Promise<number> {
    const { count, error } = await this.db.from('follows').select('*', { count: 'exact', head: true }).eq('followee_id', userId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
  async follow(userId: string) {
    await must(this.db.from('follows').upsert({ follower_id: this.userId, followee_id: userId }));
  }
  async unfollow(userId: string) {
    await must(this.db.from('follows').delete().eq('follower_id', this.userId).eq('followee_id', userId));
  }

  async feed(limit = 50): Promise<FeedItem[]> {
    const rows = await must<{
      change_id: string; deck_id: string; deck_name: string; game: string; owner_id: string; handle: string | null; display_name: string | null;
      seq: number; note: string; tags: string[]; result: string; created_at: string;
    }[]>(this.db.rpc('activity_feed', { p_limit: limit }));
    return rows.map((r) => ({
      changeId: r.change_id, deckId: r.deck_id, deckName: r.deck_name, game: r.game, ownerId: r.owner_id, handle: r.handle ?? undefined,
      displayName: r.display_name ?? undefined, seq: r.seq, note: r.note, tags: r.tags, result: r.result, createdAt: r.created_at,
    }));
  }

  async publicDecks(ownerId: string): Promise<Pick<Deck, 'id' | 'name' | 'game' | 'format' | 'purpose' | 'updatedAt'>[]> {
    const rows = await must<{ id: string; name: string; game: string; format: string | null; purpose: string | null; updated_at: string }[]>(
      this.db.from('decks').select('id, name, game, format, purpose, updated_at').eq('owner_id', ownerId).eq('is_public', true).order('updated_at', { ascending: false }),
    );
    return rows.map((r) => ({ id: r.id, name: r.name, game: r.game, format: r.format ?? undefined, purpose: r.purpose ?? undefined, updatedAt: r.updated_at }));
  }
  /** A public deck (or one of mine) with its whole history, oldest change first. */
  async publicDeck(deckId: string): Promise<{ deck: { id: string; name: string; game: string; format?: string; purpose?: string; ownerId: string }; changes: Change[] } | undefined> {
    const d = await must<{ id: string; name: string; game: string; format: string | null; purpose: string | null; owner_id: string } | null>(
      this.db.from('decks').select('id, name, game, format, purpose, owner_id').eq('id', deckId).maybeSingle(),
    );
    if (!d) return undefined;
    const rows = await must<{ id: string; seq: number; created_at: string; lines: DeckLine[]; tags: string[]; note: string; result: string }[]>(
      this.db.from('changes').select('id, seq, created_at, lines, tags, note, result').eq('deck_id', deckId).order('seq'),
    );
    return {
      deck: { id: d.id, name: d.name, game: d.game, format: d.format ?? undefined, purpose: d.purpose ?? undefined, ownerId: d.owner_id },
      changes: rows.map((r) => ({ id: r.id, deckId, seq: r.seq, createdAt: r.created_at, lines: r.lines, tags: r.tags, note: r.note, result: r.result })),
    };
  }
}
