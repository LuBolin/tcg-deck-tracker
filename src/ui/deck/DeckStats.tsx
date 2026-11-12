import { rolesFor } from '../../app/prefs';
import { cardTags } from '../../domain/cardText';
import { LabelChip } from '../components';
import { useState } from 'react';
import { cardTotals, countCards } from '../../domain/decklist';
import { chanceInHand, costCurve, deckValue, formatUsd } from '../../domain/insights';
import type { SlotStatus } from '../../domain/status';
import type { Card, DeckLine } from '../../domain/types';
import type { GameAdapter } from '../../games/types';

/** Breakdown by category, cost curve (when the game has costs) and value. */
export function DeckStats({ adapter, lines, cards, statuses }: { adapter: GameAdapter; lines: DeckLine[]; cards: Map<string, Card>; statuses: Map<string, SlotStatus> }) {
  const main = lines.filter((l) => l.section === 'main');
  const total = countCards(main);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const cats = [...adapter.categories, 'Other']
    .map((cat) => ({ cat, n: countCards(main.filter((l) => (l.category && adapter.categories.includes(l.category) ? l.category : 'Other') === cat)) }))
    .filter((c) => c.n > 0);
  // Finer types (Pokémon stage, Trainer type) when the card source has them.
  const subtypes = [...main.reduce((m, l) => {
    const sub = cards.get(l.cardId)?.subtype;
    if (sub) m.set(sub, (m.get(sub) ?? 0) + l.qty);
    return m;
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const curve = costCurve(lines, cards, ['Land']);
  const peak = Math.max(1, ...curve.map((c) => c.qty));
  // Average uses exact costs (the curve groups 7 and up together).
  const costed = main.filter((l) => cards.get(l.cardId)?.cost !== undefined && l.category !== 'Land');
  const avgCost = costed.reduce((n, l) => n + cards.get(l.cardId)!.cost! * l.qty, 0) / Math.max(1, countCards(costed));
  const value = deckValue(lines, cards, statuses);
  const pickedCopies = main.filter((l) => picked.has(l.cardId)).reduce((n, l) => n + l.qty, 0);
  // Same card in several main lines (rare) counts once with its total.
  const perCard = [...cardTotals(main)].map(([cardId, qty]) => ({ cardId, qty, name: main.find((l) => l.cardId === cardId)!.name })).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));

  const priciestMissing = [...cardTotals(lines)]
    .map(([cardId]) => ({ card: cards.get(cardId), missing: statuses.get(cardId)?.missing ?? 0 }))
    .filter((x) => x.card?.price !== undefined && x.missing > 0)
    .sort((a, b) => b.card!.price! * b.missing - a.card!.price! * a.missing)
    .slice(0, 5);

  const rules = rolesFor(adapter);
  const roleCount = new Map<string, number>();
  for (const l of lines.filter((x) => x.section === adapter.sections[0].id)) {
    const c = cards.get(l.cardId);
    for (const t of c ? cardTags(c, rules) : []) roleCount.set(t, (roleCount.get(t) ?? 0) + l.qty);
  }
  const roles = [...roleCount].sort((a, b) => b[1] - a[1]);

  return (
    <div className="grid2">
      <div className="panel">
        <h3>Main deck makeup</h3>
        <div className="stack" style={{ gap: '0.4rem' }}>
          {cats.map((c) => (
            <div key={c.cat} className="bar-row">
              <span className="bar-label">{c.cat}</span>
              <span className="bar-track"><span className="bar-fill" style={{ width: `${(c.n / Math.max(1, total)) * 100}%` }} /></span>
              <span className="num small">{c.n}</span>
            </div>
          ))}
        </div>
        {subtypes.length > 0 && (
          <p className="small muted" style={{ marginTop: '0.75rem' }}>{subtypes.map(([s, n]) => `${n} ${s}`).join(' · ')}</p>
        )}
        {roles.length > 0 && (
          <>
            <h3 style={{ marginTop: '1.25rem' }}>Roles <span className="muted small">(cards with each role tag, main deck)</span></h3>
            <div className="stack" style={{ gap: '0.4rem' }}>
              {roles.map(([t, n]) => (
                <div key={t} className="bar-row">
                  <span className="bar-label"><LabelChip name={t} /></span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${(n / Math.max(1, total)) * 100}%` }} /></span>
                  <span className="num small">{n}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {curve.length > 0 && (
          <>
            <h3 style={{ marginTop: '1.25rem' }}>{adapter.id === 'mtg' ? 'Mana curve' : 'Cost curve'} <span className="muted small">{adapter.id === 'mtg' ? '(non-land cards) ' : ''}average {avgCost.toFixed(2)}</span></h3>
            <div className="curve" role="img" aria-label={`Cost curve: ${curve.map((c) => `${c.qty} at ${c.cost}`).join(', ')}`}>
              {curve.map((c) => (
                <div key={c.cost} className="curve-col">
                  <span className="small muted">{c.qty || ''}</span>
                  <span className="curve-bar" style={{ height: `${(c.qty / peak) * 100}%` }} />
                  <span className="small">{c.cost === 7 ? '7+' : c.cost}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="panel">
        <h3>Value</h3>
        <div className="value-grid">
          <div><div className="big">{formatUsd(value.total)}</div><div className="muted small">whole deck</div></div>
          <div><div className="big" style={{ color: value.toComplete ? 'var(--bad)' : 'var(--ok)' }}>{formatUsd(value.toComplete)}</div><div className="muted small">to complete</div></div>
        </div>
        {value.unpriced > 0 && <p className="muted small">{value.unpriced === 1 ? '1 card has' : `${value.unpriced} cards have`} no price, so these totals are lower bounds.</p>}
        {priciestMissing.length > 0 && (
          <>
            <h3 style={{ marginTop: '1rem' }}>Most expensive missing cards</h3>
            <table className="list">
              <tbody>
                {priciestMissing.map(({ card, missing }) => (
                  <tr key={card!.id}>
                    <td>{missing}× {card!.name}</td>
                    <td className="num">{formatUsd(card!.price!)} each</td>
                    <td className="num"><strong>{formatUsd(card!.price! * missing)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <p className="muted small" style={{ marginTop: '0.75rem' }}>Prices are market estimates in USD for one printing ({adapter.source.prices ?? adapter.source.name}).</p>
      </div>
      <div className="panel" style={{ gridColumn: '1 / -1' }}>
        <h3>Opening hand odds <span className="muted small">(at least one in {adapter.openingHand} cards from {total})</span></h3>
        {total === 0 ? <p className="muted small">Add cards to see odds.</p> : (
          <div className="grid2">
            <table className="list small">
              <thead><tr><th>Category</th><th className="num">Cards</th><th className="num">Chance</th></tr></thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c.cat}><td>{c.cat}</td><td className="num">{c.n}</td><td className="num">{pct(chanceInHand(total, c.n, adapter.openingHand))}</td></tr>
                ))}
                {subtypes.map(([sub, n]) => (
                  <tr key={sub}><td className="muted">· {sub}</td><td className="num">{n}</td><td className="num">{pct(chanceInHand(total, n, adapter.openingHand))}</td></tr>
                ))}
              </tbody>
            </table>
            <table className="list small">
              <thead><tr><th>Card <span className="muted">(tick to combine)</span></th><th className="num">Copies</th><th className="num">Chance</th></tr></thead>
              <tbody>
                {picked.size > 0 && (
                  <tr className="combo-row">
                    <td>Any of the {picked.size} ticked</td>
                    <td className="num">{pickedCopies}</td>
                    <td className="num"><strong>{pct(chanceInHand(total, pickedCopies, adapter.openingHand))}</strong></td>
                  </tr>
                )}
                {(showAll ? perCard : perCard.slice(0, 12)).map((l) => (
                  <tr key={l.cardId}>
                    <td>
                      <label className="row" style={{ gap: '0.4rem' }}>
                        <input type="checkbox" checked={picked.has(l.cardId)} onChange={() => toggle(l.cardId)} />
                        {l.name}
                      </label>
                    </td>
                    <td className="num">{l.qty}</td>
                    <td className="num">{pct(chanceInHand(total, l.qty, adapter.openingHand))}</td>
                  </tr>
                ))}
                {perCard.length > 12 && (
                  <tr><td colSpan={3}><button type="button" className="small ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show fewer' : `Show all ${perCard.length}`}</button></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ margin: '0.5rem 0 0' }}>Before any mulligan or search effects.</p>
      </div>
    </div>
  );
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
