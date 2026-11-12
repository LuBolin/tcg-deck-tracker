import { describe, expect, it } from 'vitest';
import { cardTags, searchCards, textScore } from './cardText';
import type { Card } from './types';

const card = (name: string, text: string, extra: Partial<Card> = {}): Card => ({ game: 'demo', id: name, name, text, ...extra });

describe('fuzzy card text search', () => {
  it('matches word forms, small words and typos', () => {
    const text = 'When summoned, draw a cards from your deck.';
    expect(textScore('draw card', text)).toBeGreaterThan(0);
    expect(textScore('draw a card', text)).toBeGreaterThan(0);
    expect(textScore('draws cards', 'Draw 2 cards.')).toBeGreaterThan(0);
    expect(textScore('dsicard', 'Your opponent discards a card.')).toBeGreaterThan(0);
    expect(textScore('draw card', 'Discard a card.')).toBe(0);
  });

  it('ranks close phrases over scattered words, and names first', () => {
    const near = card('Near', 'Draw a card.');
    const far = card('Far', 'Draw this way, then later put a card on the bottom of the deck under all others.');
    const named = card('Card Draw Engine', '');
    expect(searchCards([far, near, named], 'draw card', () => []).map((c) => c.name)).toEqual(['Card Draw Engine', 'Near', 'Far']);
  });
});

describe('card role tags', () => {
  it('reads roles from rules text in any game', () => {
    expect(cardTags(card('Opt', 'Scry 1. Draw a card.'))).toEqual(['draw']);
    expect(cardTags(card('Wrath', 'Destroy all creatures. They can\'t be regenerated.'))).toEqual(['aoe']);
    expect(cardTags(card('Bolt', 'Lightning Bolt deals 3 damage to any target.'))).toEqual(['removal']);
    expect(cardTags(card('Nest Ball', 'Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.'))).toEqual(['search']);
    expect(cardTags(card('Iono', '', { subtype: 'Supporter' }), [{ tag: 'supporter', test: (c) => c.subtype === 'Supporter' }])).toEqual(['supporter']);
  });

  it('handles accents and does not treat discarding your own cards as discard', () => {
    const rules = [{ tag: 'gust', phrases: ['switch opponent benched pokemon active'] }];
    expect(cardTags(card("Boss's Orders", "Switch in 1 of your opponent's Benched Pokémon to the Active Spot."), rules)).toEqual(['gust']);
    expect(cardTags(card('Ultra Ball', 'You can use this card only if you discard 2 other cards from your hand. Search your deck for a Pokémon.'))).toEqual(['search']);
  });

  it('does not tag when the words are far apart', () => {
    expect(cardTags(card('Odd', 'Draw your sword. Many turns later, flip a coin; if heads, look at a card.'))).toEqual([]);
  });
});

describe('Magic burn and removal', () => {
  it('tells "any target" from "target player"', async () => {
    const { tagRulesFor } = await import('./cardText');
    const rules = tagRulesFor({ tagRules: [{ tag: 'burn', phrases: ['damage any target', 'damage target player'] }] });
    expect(cardTags(card('Lava Spike', 'Lava Spike deals 3 damage to target player or planeswalker.'), rules)).toEqual(['burn']);
    expect(cardTags(card('Lightning Bolt', 'Lightning Bolt deals 3 damage to any target.'), rules)).toEqual(['removal', 'burn']);
  });
});
