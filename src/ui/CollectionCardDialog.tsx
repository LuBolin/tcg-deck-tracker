import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { formatUsd } from '../domain/insights';
import { BINDER, type Card } from '../domain/types';
import type { GameAdapter } from '../games/types';

interface Props {
  adapter: GameAdapter;
  name: string;
  card?: Card;
  locs: { location: string; qty: number }[];
  needs: { deckId: string; short: number; missing: number }[];
  deckName: (id: string) => string;
  onBinder: (delta: number) => void;
  onClose: () => void;
}

/** One card in the collection: where every copy is, which decks want it, and binder +/−. */
export function CollectionCardDialog({ adapter, name, card, locs, needs, deckName, onBinder, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const binder = locs.find((l) => l.location === BINDER)?.qty ?? 0;
  const total = locs.reduce((n, l) => n + l.qty, 0);

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  const close = () => {
    ref.current?.close();
    onClose();
  };

  return (
    <dialog ref={ref} className="card-dialog" onClick={(e) => e.target === ref.current && close()} onCancel={(e) => { e.preventDefault(); close(); }} aria-labelledby="coll-card-title">
      <div className="card-dialog-body">
        <div className="card-dialog-art">
          {card?.imageUrl ? <img src={card.imageUrl.replace('/low.webp', '/high.webp').replace('/small/', '/normal/')} alt={name} /> : <div className="no-art">{name}</div>}
        </div>
        <div className="stack">
          <div className="spread">
            <h2 id="coll-card-title" style={{ margin: 0 }}>{name}</h2>
            <button type="button" className="ghost" onClick={close} aria-label="Close">✕</button>
          </div>
          <div className="row small muted">
            {[card?.category, card?.subtype, [card?.set, card?.number].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
            {card?.price !== undefined && <span className="chip">{formatUsd(card.price)}</span>}
          </div>
          {card?.legal && (
            <div className="row">
              {adapter.formats.map((f) => (
                <span key={f} className={`chip ${card.legal!.includes(f.toLowerCase()) ? 'ok' : ''}`}>{card.legal!.includes(f.toLowerCase()) ? '✓' : '✗'} {f}</span>
              ))}
            </div>
          )}
          <div>
            <h3>You own {total}</h3>
            <div className="row">
              {locs.length === 0 && <span className="muted small">No copies yet.</span>}
              {locs.map((l) => l.location === BINDER
                ? <span key={l.location} className="chip info">Binder × {l.qty}</span>
                : <Link key={l.location} className="chip warn" to={`/decks/${l.location}`} onClick={onClose}>{deckName(l.location)} × {l.qty}</Link>)}
            </div>
          </div>
          <div className="row">
            <span className="muted small">Binder</span>
            <button type="button" className="small" disabled={binder === 0} onClick={() => onBinder(-1)} aria-label={`Remove one ${name} from the binder`}>−</button>
            <strong>{binder}</strong>
            <button type="button" className="small" onClick={() => onBinder(1)} aria-label={`Add one ${name} to the binder`}>+</button>
          </div>
          {needs.length > 0 && (
            <div>
              <h3>Decks short of it</h3>
              <ul className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
                {needs.map((n) => (
                  <li key={n.deckId}>
                    <Link to={`/decks/${n.deckId}`} onClick={onClose}>{deckName(n.deckId)}</Link> needs {n.short}
                    {n.missing > 0 ? <span className="muted"> ({n.missing} not owned)</span> : <span className="muted"> (owned, elsewhere)</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
