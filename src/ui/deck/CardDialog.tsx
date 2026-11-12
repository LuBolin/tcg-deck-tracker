import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { latestLines } from '../../app/actions';
import { repo } from '../../app/repo';
import { useLoad } from '../../app/useLoad';
import { formatUsd } from '../../domain/insights';
import type { SlotStatus } from '../../domain/status';
import { BINDER, type Card, type DeckLine } from '../../domain/types';
import type { GameAdapter } from '../../games/types';
import { LabelChip, SlotChips } from '../components';
import { cardTags, tagRulesFor } from '../../domain/cardText';

interface Props {
  adapter: GameAdapter;
  /** The deck this dialog belongs to, left out of "Also played in". */
  deckId: string;
  line: DeckLine;
  card?: Card;
  status?: SlotStatus;
  deckName: (id: string) => string;
  isLocked: (id: string) => boolean;
  onMove: (from: string, qty: number) => void;
  /** Player got new copies (bought, traded): add them straight into this deck. */
  onAcquired: (qty: number) => void;
  /** Move copies to the binder; with updateList the deck also needs that many fewer. */
  onTakeOut: (qty: number, updateList: boolean) => void;
  /** Make this line need `qty` copies (the copies in the deck now). */
  onTrim: (qty: number) => void;
  onClose: () => void;
}

/** Card details and quick actions, in a native modal dialog (focus trap and Esc for free). */
export function CardDialog({ adapter, deckId, line, card, status, deckName, isLocked, onMove, onAcquired, onTakeOut, onTrim, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [got, setGot] = useState(status?.missing || 1);
  const inDeck = status?.inDeck ?? 0;
  const [out, setOut] = useState(1);
  const n = Math.min(Math.max(1, out), inDeck);
  // Copies left for this line once other sections (sideboard) take theirs.
  const fits = status ? Math.max(0, inDeck - (status.needed - line.qty)) : line.qty;
  // Other decks whose list includes this card (whether or not they hold copies of it).
  const alsoIn = useLoad(async () => {
    const decks = (await repo.listDecks()).filter((d) => d.game === adapter.id && d.id !== deckId);
    const out: { id: string; name: string; qty: number }[] = [];
    for (const d of decks) {
      const qty = (await latestLines(repo, d.id)).filter((l) => l.cardId === line.cardId).reduce((n, l) => n + l.qty, 0);
      if (qty > 0) out.push({ id: d.id, name: d.name, qty });
    }
    return out;
  }, [line.cardId]);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    // Backup for any other way the dialog closes; the handlers below unmount it directly.
    const handle = () => closeRef.current();
    d.addEventListener('close', handle);
    return () => d.removeEventListener('close', handle);
  }, []);

  const close = () => {
    ref.current?.close();
    closeRef.current();
  };

  return (
    <dialog ref={ref} className="card-dialog" onClick={(e) => e.target === ref.current && close()}
      onCancel={(e) => { e.preventDefault(); close(); }} aria-labelledby="card-dialog-title">
      <div className="card-dialog-body">
        <div className="card-dialog-art">
          {card?.imageUrl ? <img src={card.imageUrl.replace('/low.webp', '/high.webp').replace('/small/', '/normal/')} alt={line.name} /> : <div className="no-art">{line.name}</div>}
        </div>
        <div className="stack">
          <div className="spread">
            <h2 id="card-dialog-title" style={{ margin: 0 }}>{line.name}</h2>
            <button type="button" className="ghost" onClick={close} aria-label="Close">✕</button>
          </div>
          <div className="row small muted">
            {[card?.category, [line.set, line.number].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
            {card?.price !== undefined && <span className="chip">{formatUsd(card.price)}</span>}
          </div>
          {card?.legal && (
            <div className="row">
              {adapter.formats.map((f) => (
                <span key={f} className={`chip ${card.legal!.includes(f.toLowerCase()) ? 'ok' : ''}`}>
                  {card.legal!.includes(f.toLowerCase()) ? '✓' : '✗'} {f}
                </span>
              ))}
            </div>
          )}
          {card && cardTags(card, tagRulesFor(adapter)).length > 0 && (
            <div className="row labels">{cardTags(card, tagRulesFor(adapter)).map((t) => <LabelChip key={t} name={t} />)}</div>
          )}
          {card?.text && <p className="card-text small">{card.text}</p>}
          {adapter.id === 'pokemon' && <p className="muted small" style={{ margin: 0 }}>Legality shown is for this printing; a legal reprint with the same text also counts.</p>}

          <div>
            <h3>This deck needs {line.qty}{status && status.needed !== line.qty ? ` (${status.needed} across sections)` : ''}
              {status && inDeck < status.needed && <span className="short"> ({inDeck}/{status.needed} in deck)</span>}</h3>
            <div className="row"><SlotChips status={status} deckName={deckName} isLocked={isLocked} /></div>
          </div>

          {inDeck > 0 && !status?.unlimited && (
            <div className="stack takeout" style={{ gap: '0.4rem' }}>
              <span className="muted small">Take copies out to the binder</span>
              <div className="row">
                <input className="qty" type="number" min={1} max={inDeck} value={n} onChange={(e) => setOut(Number(e.target.value))} aria-label="Copies to take out" />
                <button type="button" className="small" onClick={() => onTakeOut(n, false)} title="The deck still needs them; the card shows short">Take out, keep in list</button>
                <button type="button" className="small danger" onClick={() => onTakeOut(n, true)} disabled={n > line.qty} title="The deck needs fewer from now on">Remove from deck</button>
              </div>
            </div>
          )}
          {fits < line.qty && (
            <div className="row">
              <span className="muted small">Not putting them back?</span>
              <button type="button" className="small" onClick={() => onTrim(fits)}>{fits > 0 ? `Change list to need ${fits}` : 'Remove from list'}</button>
            </div>
          )}

          {status && (status.inBinder > 0 || status.inOtherDecks.length > 0) && (
            <div className="stack" style={{ gap: '0.4rem' }}>
              <span className="muted small">Move owned copies into this deck</span>
              <div className="row">
                {status.inBinder > 0 && <button type="button" className="small" onClick={() => onMove(BINDER, status.inBinder)}>From binder ({status.inBinder})</button>}
                {status.inOtherDecks.filter((o) => !isLocked(o.deckId)).map((o) => (
                  <button key={o.deckId} type="button" className="small" onClick={() => onMove(o.deckId, o.qty)}>From {deckName(o.deckId)} ({o.qty})</button>
                ))}
              </div>
            </div>
          )}

          {(alsoIn.data?.length ?? 0) > 0 && (
            <div>
              <h3>Also played in</h3>
              <div className="row">
                {alsoIn.data!.map((d) => <Link key={d.id} className="chip" to={`/decks/${d.id}`} onClick={close}>{d.name} × {d.qty}</Link>)}
              </div>
            </div>
          )}

          <form className="row" onSubmit={(e) => { e.preventDefault(); if (got > 0) onAcquired(got); }}>
            <span className="muted small">Got new copies?</span>
            <input className="qty" type="number" min={1} value={got} onChange={(e) => setGot(Math.max(1, Number(e.target.value)))} aria-label="New copies" />
            <button type="submit" className="small primary">Add to this deck</button>
          </form>
        </div>
      </div>
    </dialog>
  );
}
