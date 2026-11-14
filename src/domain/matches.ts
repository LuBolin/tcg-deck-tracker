import { diffLists } from './decklist';
import { parseRecord, type MatchRecord } from './insights';
import { OPTIONS, type Change, type DeckLine } from './types';

export type Outcome = 'win' | 'loss' | 'tie';

/** Result text for one match, readable on its own and countable by `parseRecord`: "1-0 vs Gardevoir ex". */
export function matchResult(outcome: Outcome, opponent?: string): string {
  const record = outcome === 'win' ? '1-0' : outcome === 'loss' ? '0-1' : '0-0-1';
  return opponent?.trim() ? `${record} vs ${opponent.trim()}` : record;
}

export const gamesIn = (r: MatchRecord) => r.wins + r.losses + r.draws;
/** Wins out of all games, ties included (ties are common in Pokémon). */
export const winRate = (r: MatchRecord) => (gamesIn(r) ? r.wins / gamesIn(r) : 0);

const empty = (): MatchRecord => ({ wins: 0, losses: 0, draws: 0, events: 0 });
const add = (to: MatchRecord, r: MatchRecord) => {
  to.wins += r.wins;
  to.losses += r.losses;
  to.draws += r.draws;
  to.events += r.events;
};
const counted = (lines: DeckLine[]) => lines.filter((l) => l.section !== OPTIONS);

export interface MatchStats {
  total: MatchRecord;
  byTurn: { first: MatchRecord; second: MatchRecord };
  byOpponent: { opponent: string; record: MatchRecord }[];
  /** A version starts at each change that changes the counted list; results count for the version they were played with. */
  byVersion: { version: number; since: string; record: MatchRecord }[];
  versions: number;
}

/** Records by opponent deck, by going first or second, and by deck version, from a deck's changes (oldest first). */
export function matchStats(changes: Change[]): MatchStats {
  const total = empty();
  const byTurn = { first: empty(), second: empty() };
  const byOpponent = new Map<string, { opponent: string; record: MatchRecord }>();
  const versions: MatchStats['byVersion'] = [];
  let prev: DeckLine[] | undefined;
  for (const c of changes) {
    if (!prev || diffLists(counted(prev), counted(c.lines)).length) versions.push({ version: versions.length + 1, since: c.createdAt, record: empty() });
    prev = c.lines;
    const r = parseRecord(c.result);
    if (!r) continue;
    // Older results are free text ("3-1 vs Gardevoir"): take the opponent from it.
    const opponent = c.match?.opponent?.trim() || /\bvs\.?\s+(.+)$/i.exec(c.result)?.[1].trim() || 'Not noted';
    const key = opponent.toLowerCase();
    if (!byOpponent.has(key)) byOpponent.set(key, { opponent, record: empty() });
    add(total, r);
    add(byOpponent.get(key)!.record, r);
    if (c.match?.turn) add(byTurn[c.match.turn], r);
    add(versions.at(-1)!.record, r);
  }
  return {
    total,
    byTurn,
    byOpponent: [...byOpponent.values()].sort((a, b) => gamesIn(b.record) - gamesIn(a.record) || a.opponent.localeCompare(b.opponent)),
    byVersion: versions.filter((v) => v.record.events > 0),
    versions: versions.length,
  };
}
