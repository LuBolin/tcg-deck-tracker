import type { Prefs, Repository } from '../data/repository';
import { tagRulesFor, type TagRule } from '../domain/cardText';

/**
 * Player settings, loaded once before the first render and kept in memory so pages read them synchronously.
 * Saved to the account when signed in, else to this browser.
 */
let prefs: Prefs = {};
let store: Repository | undefined;

export async function loadPrefs(repo: Repository) {
  store = repo;
  try {
    prefs = await repo.getPrefs();
  } catch {
    prefs = {}; // unreadable settings fall back to defaults; the app still works
  }
}

export const getPref = <T,>(key: string, fallback: T): T => (key in prefs ? (prefs[key] as T) : fallback);

export async function setPref(key: string, value: unknown) {
  prefs = { ...prefs, [key]: value };
  await store?.setPrefs(prefs);
}

/** Role tag renames, original tag → the player's name for it. */
export const roleNames = () => getPref<Record<string, string>>('role-names', {});
export const setRoleName = (tag: string, name: string) => {
  const next = { ...roleNames() };
  if (name.trim() && name.trim() !== tag) next[tag] = name.trim();
  else delete next[tag];
  return setPref('role-names', next);
};

/** A game's role rules with the player's names applied. */
export const rolesFor = (game?: { tagRules?: TagRule[] }) => tagRulesFor(game, roleNames());
