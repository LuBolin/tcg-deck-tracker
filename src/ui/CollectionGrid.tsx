import type { Card, PrintRow } from '../domain/types';
import { BINDER } from '../domain/types';
import type { GameAdapter, RaritySymbol } from '../games/types';

export interface GridRow {
  cardId: string;
  name: string;
  card?: Card;
  total: number;
  locs: { location: string; qty: number }[];
  needs: { deckId: string; short: number; missing: number }[];
}

/** A rarity as the small symbol printed on cards (★, ◆…), colored by tone. */
export function RarityMark({ adapter, rarity, title }: { adapter: GameAdapter; rarity: string; title?: string }) {
  const s: RaritySymbol = adapter.raritySymbol?.(rarity) ?? { symbol: rarity.slice(0, 1).toUpperCase(), tone: 'plain' };
  return <span className={`rarity ${s.tone}`} title={title ?? rarity} aria-label={title ?? rarity}>{s.symbol}</span>;
}

/** The collection as card images: copies owned with −/+ for the binder, and the rarities owned. */
export function CollectionGrid({ adapter, rows, prints, onOpen, onBinder }: {
  adapter: GameAdapter;
  rows: GridRow[];
  prints: Map<string, PrintRow[]>;
  onOpen: (cardId: string) => void;
  onBinder: (cardId: string, delta: number) => void;
}) {
  return (
    <div className="card-grid coll-grid">
      {rows.map((r) => {
        const binder = r.locs.find((l) => l.location === BINDER)?.qty ?? 0;
        // One mark per rarity owned; the title lists the printings behind it.
        const byRarity = new Map<string, PrintRow[]>();
        for (const p of prints.get(r.cardId) ?? []) if (p.rarity) byRarity.set(p.rarity, [...(byRarity.get(p.rarity) ?? []), p]);
        const short = Math.max(0, ...r.needs.map((x) => x.missing)); // the most any one deck lacks
        return (
          <figure key={r.cardId} className={`card-tile coll-tile ${r.total === 0 ? 'all-missing' : ''}`}>
            <div className="art">
              <button type="button" className="art-button" onClick={() => onOpen(r.cardId)} aria-label={`${r.name}: printings and where your copies are`}>
                {r.card?.imageUrl ? <img src={r.card.imageUrl} alt="" loading="lazy" /> : <span className="no-art">{r.name}</span>}
              </button>
              <div className="coll-bar">
                <button type="button" className="step" disabled={binder === 0} onClick={() => onBinder(r.cardId, -1)}
                  aria-label={`Remove one ${r.name} from the binder`} title={binder === 0 ? 'No copies in the binder (they are in decks)' : 'Remove one from the binder'}>−</button>
                <button type="button" className="step" onClick={() => onBinder(r.cardId, 1)} aria-label={`Add one ${r.name} to the binder`} title="Add one to the binder">+</button>
                <span className="count-hex" title={`You own ${r.total}`} aria-label={`You own ${r.total}`}>{r.total}</span>
                {[...byRarity].map(([rarity, ps]) => (
                  <RarityMark key={rarity} adapter={adapter} rarity={rarity}
                    title={`${rarity}: ${ps.map((p) => `${p.qty}× ${[p.set, p.number].filter(Boolean).join(' ')}`).join(', ')}`} />
                ))}
              </div>
            </div>
            <figcaption className="small">
              <span className="tile-name">{r.name}</span>
              {short > 0 && <span className="chip bad">{short} missing</span>}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
