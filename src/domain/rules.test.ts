import { describe, expect, it } from 'vitest';
import { mtgAdapter } from '../games/mtg';
import { pokemonAdapter } from '../games/pokemon';
import { describeIssue, validateDeck } from './rules';
import type { DeckLine } from './types';

const line = (name: string, qty: number, section = 'main'): DeckLine => ({ cardId: name, name, qty, section });

describe('deck rules', () => {
  it('Pokémon: exactly 60, 4 per name across printings, basic Energy unlimited', () => {
    const rules = pokemonAdapter.deckRules('Standard');
    const lines = [
      { ...line('Pikachu ex', 3), cardId: 'pokemon:pikachu ex:a' },
      { ...line('Pikachu ex', 2), cardId: 'pokemon:pikachu ex:b' }, // different attacks, same name: shares the limit
      line('Fire Energy', 20),
      line('Iono', 4),
    ];
    expect(validateDeck(lines, rules).map(describeIssue)).toEqual([
      'Deck has 29 cards; it needs exactly 60',
      '5 copies of Pikachu ex; the limit is 4',
    ]);
  });

  it('MTG constructed: at least 60, 4 per name including sideboard, sideboard up to 15', () => {
    const rules = mtgAdapter.deckRules('Modern');
    const lines = [line('Lightning Bolt', 4), line('Mountain', 57), line('Lightning Bolt', 1, 'sideboard'), line('Duress', 4, 'sideboard'), line('Abrade', 4, 'sideboard'), line('Pyroblast', 4, 'sideboard'), line('Smash to Smithereens', 3, 'sideboard')];
    expect(validateDeck(lines, rules).map((i) => i.kind)).toEqual(['copies', 'section']);
  });

  it('MTG Commander: exactly 100 including the commander, singleton except basics', () => {
    const rules = mtgAdapter.deckRules('Commander');
    const ok = [line('Krenko, Mob Boss', 1, 'commander'), line('Snow-Covered Mountain', 60), line('Goblin Matron', 1), ...Array.from({ length: 38 }, (_, i) => line(`Card ${i}`, 1))];
    expect(validateDeck(ok, rules)).toEqual([]);
    expect(validateDeck([...ok, line('Goblin Matron', 1)], rules).map((i) => i.kind)).toEqual(['size', 'copies']);
  });
});

describe('limit groups', () => {
  it('Pokémon: one ACE SPEC and one Radiant Pokémon per deck', () => {
    const rules = pokemonAdapter.deckRules('Standard');
    const cards = new Map([
      ['catcher', { game: 'pokemon', id: 'catcher', name: 'Prime Catcher', limitGroup: 'ACE SPEC' }],
      ['vessel', { game: 'pokemon', id: 'vessel', name: 'Master Ball', limitGroup: 'ACE SPEC' }],
      ['greninja', { game: 'pokemon', id: 'greninja', name: 'Radiant Greninja', limitGroup: 'Radiant' }],
    ]);
    const lines = [line('catcher', 1), line('vessel', 1), line('greninja', 1), line('Fire Energy', 57)].map((l) => ({ ...l, cardId: l.name }));
    expect(validateDeck(lines, rules, cards).map(describeIssue)).toEqual(['2 ACE SPEC cards; the limit is 1 per deck']);
  });
});

describe('commander color identity', () => {
  it('flags cards outside the commander colors, and stays quiet when identity is unknown', () => {
    const rules = mtgAdapter.deckRules('Commander');
    const card = (id: string, identity?: string[]) => [id, { game: 'mtg', id, name: id, identity }] as const;
    const cards = new Map([card('Krenko', ['R']), card('Bolt', ['R']), card('Counterspell', ['U']), card('Sol Ring', [])]);
    const lines = [
      { cardId: 'Krenko', name: 'Krenko', qty: 1, section: 'commander' },
      { cardId: 'Bolt', name: 'Bolt', qty: 1, section: 'main' },
      { cardId: 'Counterspell', name: 'Counterspell', qty: 1, section: 'main' },
      { cardId: 'Sol Ring', name: 'Sol Ring', qty: 1, section: 'main' },
    ];
    const msgs = validateDeck(lines, rules, cards).map(describeIssue);
    expect(msgs).toContain("Outside the commander's colors: Counterspell");
    const unknown = new Map([...cards, card('Krenko')]);
    expect(validateDeck(lines, rules, unknown).map(describeIssue).some((m) => m.startsWith('Outside'))).toBe(false);
  });
});
