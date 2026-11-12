import type { SlotStatus } from '../../domain/status';
import { BINDER, type DeckLine } from '../../domain/types';
import { plural } from '../text';

/**
 * Where to fetch this deck's cards from, grouped by place, so a player rebuilding a deck
 * knows which binder page or deck box to open. One button moves a whole group.
 */
export function GatherPanel({ lines, statuses, deckName, onGather, onClose }: {
  lines: DeckLine[];
  statuses: Map<string, SlotStatus>;
  deckName: (id: string) => string;
  onGather: (from: string, label: string) => void;
  onClose: () => void;
}) {
  const name = (cardId: string) => lines.find((l) => l.cardId === cardId)?.name ?? cardId;
  const groups = new Map<string, { cardId: string; qty: number }[]>();
  for (const s of statuses.values()) {
    if (s.inBinder > 0) groups.set(BINDER, [...(groups.get(BINDER) ?? []), { cardId: s.cardId, qty: s.inBinder }]);
    for (const o of s.inOtherDecks) groups.set(o.deckId, [...(groups.get(o.deckId) ?? []), { cardId: s.cardId, qty: o.qty }]);
  }
  const missing = [...statuses.values()].filter((s) => s.missing > 0);

  return (
    <div className="panel stack">
      <div className="spread">
        <h3 style={{ margin: 0 }}>Gather cards for this deck</h3>
        <button type="button" className="small ghost" onClick={onClose}>Close</button>
      </div>
      {groups.size === 0 && <p className="muted small">Nothing to gather: every owned copy this deck needs is already in it.</p>}
      <div className="grid2">
        {[...groups].map(([from, items]) => {
          const label = from === BINDER ? 'Binder' : deckName(from);
          const total = items.reduce((n, i) => n + i.qty, 0);
          return (
            <div key={from} className="gather-group">
              <div className="spread">
                <strong>From {label}</strong>
                <button type="button" className="small primary" onClick={() => onGather(from, label)}>Move {plural(total, 'card')}</button>
              </div>
              <ul className="small">
                {items.sort((a, b) => name(a.cardId).localeCompare(name(b.cardId))).map((i) => <li key={i.cardId}>{i.qty}× {name(i.cardId)}</li>)}
              </ul>
              {from !== BINDER && <p className="muted small" style={{ margin: 0 }}>{label} will be short these cards afterwards.</p>}
            </div>
          );
        })}
      </div>
      {missing.length > 0 && (
        <p className="muted small" style={{ margin: 0 }}>
          Still not owned: {missing.map((s) => `${s.missing}× ${name(s.cardId)}`).join(', ')}.
        </p>
      )}
    </div>
  );
}
