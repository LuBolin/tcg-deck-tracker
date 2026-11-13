import { demoAdapter } from './demo';
import { pokemonAdapter } from './pokemon';
import type { GameAdapter } from './types';

/**
 * Registered games. Add a game by writing an adapter and listing it here. The offline demo game is dev-only.
 * Pokémon only for now: the mtg, yugioh, lorcana and onepiece adapters are kept and tested, but not listed.
 */
const adapters: GameAdapter[] = [pokemonAdapter, ...(import.meta.env.DEV ? [demoAdapter] : [])];

export const games = (): GameAdapter[] => adapters;

/** Best guess of which game a pasted list is for, from format clues. Undefined when unsure. */
export function detectGame(text: string): string | undefined {
  if (/play\.limitlesstcg\.com\/tournament\//i.test(text)) return 'pokemon';
  if (/^\s*\d+\s*x\s*[A-Z]{1,4}\d{0,2}-\d{3}\b/m.test(text)) return 'onepiece';
  if (/^\s*#main\s*$/im.test(text) || /^(extra|side) deck\s*:?\s*\d*\s*$/im.test(text)) return 'yugioh';
  if (/^(pok[eé]mon|trainer|energy)\s*[:-]\s*\d+/im.test(text) || /basic \{[A-Z]\} energy/i.test(text)) return 'pokemon';
  if (/^\d+\s*x?\s+.+\([A-Za-z0-9]{2,6}\)\s+\S+/m.test(text) || /^(sideboard|commander|companion)\s*:?\s*$/im.test(text)) return 'mtg';
  return undefined;
}
