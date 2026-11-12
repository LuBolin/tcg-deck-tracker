import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { formatUsd } from '../domain/insights';
import { BINDER, type Card, type PrintRow } from '../domain/types';
import type { GameAdapter, Printing } from '../games/types';
import { RarityMark } from './CollectionGrid';

interface Props {
  adapter: GameAdapter;
  name: string;
  card?: Card;
  locs: { location: string; qty: number }[];
  needs: { deckId: string; short: number; missing: number }[];
  deckName: (id: string) => string;
  onBinder: (delta: number) => void;
  /** Printing labels of this card's copies. */
  prints: PrintRow[];
  /** Set a printing's count; `addCopy` first adds a new copy to the binder (every owned copy was already labeled). */
  onSetPrint: (printing: Printing, qty: number, addCopy: boolean) => void;
  onClose: () => void;
}

/** One card in the collection: where every copy is, which decks want it, and binder +/−. */
export function CollectionCardDialog({ adapter, name, card, locs, needs, deckName, onBinder, prints, onSetPrint, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const binder = locs.find((l) => l.location === BINDER)?.qty ?? 0;
  const total = locs.reduce((n, l) => n + l.qty, 0);

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  // Every printing of this card (alternate arts), fetched once when the dialog opens.
  const [printings, setPrintings] = useState<Printing[]>();
  const [printError, setPrintError] = useState<string>();
  const [shown, setShown] = useState<string>(); // image of the printing being looked at
  useEffect(() => {
    if (!card || !adapter.printingsOf) return;
    let live = true;
    adapter.printingsOf(card).then(
      (p) => live && setPrintings(p),
      (e: unknown) => live && setPrintError(e instanceof Error ? e.message : String(e)),
    );
    return () => { live = false; };
  }, [adapter, card]);
  const labeled = prints.reduce((n, p) => n + p.qty, 0);
  const countOf = (printId: string) => prints.find((p) => p.printId === printId)?.qty ?? 0;
  // Labels for printings the source no longer lists still show, so they can be cleared.
  const extraLabels = prints.filter((p) => printings && !printings.some((x) => x.printId === p.printId));
  const close = () => {
    ref.current?.close();
    onClose();
  };

  return (
    <dialog ref={ref} className="card-dialog" onClick={(e) => e.target === ref.current && close()} onCancel={(e) => { e.preventDefault(); close(); }} aria-labelledby="coll-card-title">
      <div className="card-dialog-body">
        <div className="card-dialog-art">
          {(shown ?? card?.imageUrl) ? <img src={(shown ?? card!.imageUrl!).replace('/low.webp', '/high.webp').replace('/small/', '/normal/')} alt={name} /> : <div className="no-art">{name}</div>}
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
          {adapter.printingsOf && card && (
            <div>
              <h3>Printings</h3>
              <p className="small muted" style={{ marginTop: 0 }}>
                Which of your {total} copies are which print. − only removes the label; remove copies with the binder buttons.
              </p>
              {labeled > total && <p className="chip warn">{labeled} copies are labeled but you own {total}. Lower some printings.</p>}
              {printError && <p className="small muted">Could not load printings: {printError}</p>}
              {!printings && !printError && <p className="small muted">Loading printings…</p>}
              {printings?.length === 0 && <p className="small muted">No other printings found.</p>}
              <div className="print-grid">
                {[...(printings ?? []), ...extraLabels.map((p): Printing => ({ printId: p.printId, set: p.set, number: p.number, rarity: p.rarity, imageUrl: p.imageUrl }))].map((p) => {
                  const n = countOf(p.printId);
                  const full = labeled >= total; // every copy labeled: + adds a new copy of this print
                  return (
                    <div key={p.printId} className={`print-tile ${n > 0 ? 'owned' : ''}`}>
                      <button type="button" className="art-button" onClick={() => setShown(p.imageUrl)} aria-label={`Show ${[p.set, p.number].filter(Boolean).join(' ')}`}>
                        {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" /> : <span className="no-art">{p.set} {p.number}</span>}
                      </button>
                      <div className="print-meta small">
                        {p.rarity && <RarityMark adapter={adapter} rarity={p.rarity} />}
                        <span>{[p.set, p.number].filter(Boolean).join(' ')}</span>
                        {p.price !== undefined && <span className="muted">{formatUsd(p.price)}</span>}
                      </div>
                      <div className="row print-step">
                        <button type="button" className="small" disabled={n === 0} onClick={() => onSetPrint(p, n - 1, false)} aria-label={`One fewer ${p.set} ${p.number}`}>−</button>
                        <strong>{n}</strong>
                        <button type="button" className="small" onClick={() => onSetPrint(p, n + 1, full)}
                          aria-label={`One more ${p.set} ${p.number}`} title={full ? 'Adds a new copy of this print to the binder' : 'Labels one of your copies as this print'}>+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
