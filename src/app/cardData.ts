import type { Card } from '../domain/types';

/** Mark cards as fetched now, so stale data can be refreshed later. */
export const stamp = (cards: Card[]): Card[] => {
  const fetchedAt = new Date().toISOString();
  return cards.map((c) => ({ ...c, fetchedAt }));
};

/** Card data older than this is fetched again when its deck is opened. */
export const STALE_MS = 7 * 864e5;
export const isStale = (c: Card | undefined) => !c?.fetchedAt || Date.now() - Date.parse(c.fetchedAt) > STALE_MS;
