import { useState } from 'react';
import { countCards } from '../../domain/decklist';
import type { SlotStatus } from '../../domain/status';
import { BINDER, type Card, type DeckLine } from '../../domain/types';
import type { GameAdapter } from '../../games/types';
import { Empty, SlotChips } from '../components';
import { groupLines } from './group';

export type View = 'list' | 'images';

interface Props {
  adapter: GameAdapter;
  lines: DeckLine[];
  statuses: Map<string, SlotStatus>;
  cards: Map<string, Card>;
  illegal: Set<string>;
  format?: string;
  view: View;
  deckName: (id: string) => string;
  onMove: (line: DeckLine, from: string, qty: number) => void;
  onOpen: (line: DeckLine) => void;
}

export function CardList(p: Props) {
  const [open, setOpen] = useState<string>();
  if (p.lines.length === 0) return <Empty>This deck has no cards yet. Use Edit list to add some.</Empty>;

  return (
    <div className="panel">
      {groupLines(p.adapter, p.lines).map((g) => (
        <section key={g.section.id}>
          <div className="section-title"><h3>{g.section.label}</h3><span className="muted small">{g.count}</span></div>
          {g.cats.map((c) => (
            <div key={c.cat}>
              <div className="cat-title">{c.cat} <span className="muted">· {countCards(c.lines)}</span></div>
              {p.view === 'images' ? (
                <div className="card-grid">
                  {c.lines.map((l) => <CardTile key={`${l.section}|${l.cardId}`} line={l} {...p} />)}
                </div>
              ) : (
                c.lines.map((l) => {
                  const key = `${l.section}|${l.cardId}`;
                  return <CardRow key={key} line={l} open={open === key} onToggle={() => setOpen(open === key ? undefined : key)} {...p} />;
                })
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function CardRow({ line: l, open, onToggle, statuses, cards, illegal, format, deckName, onMove, onOpen }: Props & { line: DeckLine; open: boolean; onToggle: () => void }) {
  const st = statuses.get(l.cardId);
  const card = cards.get(l.cardId);
  const canGet = !!st && (st.inBinder > 0 || st.inOtherDecks.length > 0);
  return (
    <div className="card-line">
      <span className="qty-n">{l.qty}</span>
      <span className="card-name">
        <button type="button" className="link-button" onClick={() => onOpen(l)}>{l.name}</button>
        <span className="print">{[l.set, l.number].filter(Boolean).join(' ')}</span>
        {card?.imageUrl && <img className="preview" src={card.imageUrl} alt="" loading="lazy" />}
      </span>
      <span className="chips">
        {illegal.has(l.cardId) && <span className="chip bad" title={`Not legal in ${format}`}>not {format}-legal</span>}
        <SlotChips status={st} deckName={deckName} />
        {canGet && (
          <button type="button" className="small ghost" aria-expanded={open} onClick={onToggle}>Get copies</button>
        )}
      </span>
      {open && st && (
        <div className="sources">
          <span className="muted small">Move into this deck from:</span>
          {st.inBinder > 0 && <button type="button" className="small" onClick={() => onMove(l, BINDER, st.inBinder)}>Binder ({st.inBinder})</button>}
          {st.inOtherDecks.map((o) => (
            <button key={o.deckId} type="button" className="small" onClick={() => onMove(l, o.deckId, o.qty)}>{deckName(o.deckId)} ({o.qty})</button>
          ))}
        </div>
      )}
    </div>
  );
}

function CardTile({ line: l, statuses, cards, illegal, format, deckName, onOpen }: Props & { line: DeckLine }) {
  const st = statuses.get(l.cardId);
  const card = cards.get(l.cardId);
  const missing = st?.missing ?? 0;
  return (
    <figure className={`card-tile ${missing === st?.needed && missing > 0 ? 'all-missing' : ''}`}>
      <button type="button" className="art" onClick={() => onOpen(l)} aria-label={`${l.name} details`}>
        {card?.imageUrl ? <img src={card.imageUrl} alt={l.name} loading="lazy" /> : <div className="no-art">{l.name}</div>}
        <span className="qty-badge">{l.qty}×</span>
        {missing > 0 && <span className="missing-badge">{missing} missing</span>}
      </button>
      <figcaption>
        <span className="small">{l.name}</span>
        <span className="chips">
          {illegal.has(l.cardId) && <span className="chip bad">not {format}-legal</span>}
          {st && st.inDeck < st.needed && <SlotChips status={{ ...st, inDeck: 0, missing: 0 }} deckName={deckName} />}
        </span>
      </figcaption>
    </figure>
  );
}
