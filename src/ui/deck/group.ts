import { countCards } from '../../domain/decklist';
import type { DeckLine } from '../../domain/types';
import type { GameAdapter } from '../../games/types';

/** Lines by section, then category. `keepEmpty` keeps sections whose lines are all at 0 (while editing). */
export function groupLines(adapter: GameAdapter, lines: DeckLine[], keepEmpty = false) {
  return adapter.sections
    .map((s) => {
      const inSection = lines.filter((l) => l.section === s.id);
      const cats = [...adapter.categories, undefined].map((cat) => ({
        cat: cat ?? 'Other',
        lines: inSection
          .filter((l) => (cat ? l.category === cat : !l.category || !adapter.categories.includes(l.category)))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));
      return { section: s, count: countCards(inSection), cats: cats.filter((c) => c.lines.length) };
    })
    .filter((g) => g.count > 0 || (keepEmpty && g.cats.length > 0));
}
