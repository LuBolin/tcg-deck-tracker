import { formatPrinting, splitTrailingSetNumber, type ListFormat } from '../../domain/listParse';
import type { Card } from '../../domain/types';
import { formatSections } from '../common';
import type { GameAdapter } from '../types';

/**
 * Offline test game with built-in cards. Used by tests and by dev builds,
 * so the app works without network access.
 */
const card = (id: string, name: string, category: string, set: string, number: string): Card => ({
  game: 'demo',
  id,
  name,
  category,
  set,
  number,
});

export const DEMO_CARDS: Card[] = [
  card('ember-fox', 'Ember Fox', 'Unit', 'BAS', '1'),
  card('tide-turtle', 'Tide Turtle', 'Unit', 'BAS', '2'),
  card('stone-golem', 'Stone Golem', 'Unit', 'BAS', '3'),
  card('sky-heron', 'Sky Heron', 'Unit', 'BAS', '4'),
  card('quick-draw', 'Quick Draw', 'Spell', 'BAS', '10'),
  card('fireball', 'Fireball', 'Spell', 'BAS', '11'),
  card('counterspell', 'Counter Charm', 'Spell', 'BAS', '12'),
  card('rest', 'Rest at the Inn', 'Spell', 'BAS', '13'),
  card('fire-crystal', 'Fire Crystal', 'Resource', 'BAS', '20'),
  card('water-crystal', 'Water Crystal', 'Resource', 'BAS', '21'),
];

// The same card reprinted in a second set, to exercise "same in play = same card".
const REPRINTS: Record<string, string> = { 'EXP 7': 'ember-fox' };

const format: ListFormat = {
  header: (line) => {
    const l = line.toLowerCase();
    if (l.startsWith('sideboard')) return 'sideboard';
    if (/^(deck|main|units|spells|resources)\b/.test(l)) return 'main';
    if (l.startsWith('total')) return 'ignore';
    return undefined;
  },
  splitPrinting: (rest) => splitTrailingSetNumber(rest) ?? { name: rest },
};

export const demoAdapter: GameAdapter = {
  id: 'demo',
  name: 'Demo game',
  source: { name: 'built-in cards', url: 'https://example.com' },
  sections: [
    { id: 'main', label: 'Main deck' },
    { id: 'sideboard', label: 'Sideboard' },
  ],
  categories: ['Unit', 'Spell', 'Resource'],
  formats: ['Standard'],
  openingHand: 5,
  deckRules: () => ({ size: 20, exact: true, sizeSections: ['main'], copyLimit: 4, unlimited: (n) => / Crystal$/.test(n), sectionMax: { sideboard: 10 } }),
  sampleList: '4 Ember Fox BAS 1\n4 Tide Turtle BAS 2\n4 Fireball BAS 11\n8 Fire Crystal BAS 20',

  listFormat: format,
  formatLine: (l) => formatPrinting(l.qty, l),
  formatList(lines) {
    return formatSections(lines, this, (s, n) => (s.id === 'main' ? null : `${s.label}: ${n}`));
  },

  async resolve(lines) {
    return lines.map((line) => {
      const reprint = line.set && line.number ? REPRINTS[`${line.set} ${line.number}`] : undefined;
      const card =
        DEMO_CARDS.find((c) => c.id === reprint) ??
        DEMO_CARDS.find((c) => line.set && c.set === line.set && c.number === line.number) ??
        DEMO_CARDS.find((c) => c.name.toLowerCase() === line.name.toLowerCase());
      return { line, card };
    });
  },

  async search(query) {
    const q = query.trim().toLowerCase();
    return q ? DEMO_CARDS.filter((c) => c.name.toLowerCase().includes(q)) : DEMO_CARDS;
  },
};
