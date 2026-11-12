import type { Unlimited } from '../domain/status';
import { games } from '../games';

const key = (game: string) => `track-unlimited:${game}`;

/**
 * Whether the player counts their copies of a game's "unlimited" cards (basic Energy) like any other card.
 * shortcut: a per-browser setting; move it into the account if players want it on every device.
 */
export function tracksUnlimited(game: string): boolean {
  try {
    return localStorage.getItem(key(game)) === '1';
  } catch {
    return false;
  }
}

export function setTracksUnlimited(game: string, on: boolean) {
  try {
    if (on) localStorage.setItem(key(game), '1');
    else localStorage.removeItem(key(game));
  } catch {
    // Storage blocked: the setting lasts until the page reloads.
  }
}

/** The endless-supply test for slot statuses, or undefined when the game has none or the player tracks them. */
export function unlimitedFor(game: string): Unlimited | undefined {
  const rule = games().find((g) => g.id === game)?.unlimited;
  return rule && !tracksUnlimited(game) ? (cardId) => rule.test(cardId) : undefined;
}
