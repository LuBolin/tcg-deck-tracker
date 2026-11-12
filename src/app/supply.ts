import type { Unlimited } from '../domain/status';
import { games } from '../games';
import { getPref, setPref } from './prefs';

const key = (game: string) => `track-unlimited:${game}`;

/** Whether the player counts their copies of a game's "unlimited" cards (basic Energy) like any other card. */
export const tracksUnlimited = (game: string): boolean => getPref<boolean>(key(game), false) === true;

export const setTracksUnlimited = (game: string, on: boolean) => setPref(key(game), on);

/** The endless-supply test for slot statuses, or undefined when the game has none or the player tracks them. */
export function unlimitedFor(game: string): Unlimited | undefined {
  const rule = games().find((g) => g.id === game)?.unlimited;
  return rule && !tracksUnlimited(game) ? (cardId) => rule.test(cardId) : undefined;
}
