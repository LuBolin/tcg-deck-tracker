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
  isLocked: (id: string) => boolean;
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

/** "(3/4)": copies in the deck out of copies the deck needs, when some owned copies are elsewhere. */
function Short({ st }: { st?: SlotStatus }) {
  // Not owned at all already reads "N missing"; the count is for copies you own but took out.
  if (!st || st.inDeck >= st.needed || st.missing === st.needed) return null;
  return <span className="short" title={`${st.inDeck} of ${st.needed} copies are in this deck`}>({st.inDeck}/{st.needed})</span>;
}

function CardRow({ line: l, open, onToggle, statuses, cards, illegal, format, deckName, isLocked, onMove, onOpen }: Props & { line: DeckLine; open: boolean; onToggle: () => void }) {
  const st = statuses.get(l.cardId);
  const card = cards.get(l.cardId);
  const canGet = !!st && (st.inBinder > 0 || st.inOtherDecks.some((o) => !isLocked(o.deckId)));
  return (
    <div className="card-line">
      <span className="qty-n">{l.qty}</span>
      <span className="card-name">
        <button type="button" className="link-button" onClick={() => onOpen(l)}>{l.name}</button>
        <Short st={st} />
        <span className="print">{[l.set, l.number].filter(Boolean).join(' ')}</span>
        {(l.imageUrl ?? card?.imageUrl) && <img className="preview" src={l.imageUrl ?? card!.imageUrl} alt="" loading="lazy" />}
      </span>
      <span className="chips">
        {illegal.has(l.cardId) && <span className="chip bad" title={`Not legal in ${format}`}>not {format}-legal</span>}
        <SlotChips status={st} deckName={deckName} isLocked={isLocked} />
        {canGet && (
          <button type="button" className="small ghost" aria-expanded={open} onClick={onToggle}>Get copies</button>
        )}
      </span>
      {open && st && (
        <div className="sources">
          <span className="muted small">Move into this deck from:</span>
          {st.inBinder > 0 && <button type="button" className="small" onClick={() => onMove(l, BINDER, st.inBinder)}>Binder ({st.inBinder})</button>}
          {st.inOtherDecks.filter((o) => !isLocked(o.deckId)).map((o) => (
            <button key={o.deckId} type="button" className="small" onClick={() => onMove(l, o.deckId, o.qty)}>{deckName(o.deckId)} ({o.qty})</button>
          ))}
        </div>
      )}
    </div>
  );
}

function CardTile({ line: l, statuses, cards, illegal, format, deckName, isLocked, onOpen }: Props & { line: DeckLine }) {
  const st = statuses.get(l.cardId);
  const card = cards.get(l.cardId);
  const missing = st?.missing ?? 0;
  return (
    <figure className={`card-tile ${missing === st?.needed && missing > 0 ? 'all-missing' : ''}`}>
      <button type="button" className="art" onClick={() => onOpen(l)} aria-label={`${l.name} details`}>
        {(l.imageUrl ?? card?.imageUrl) ? <img src={l.imageUrl ?? card!.imageUrl} alt={l.name} loading="lazy" /> : <div className="no-art">{l.name}</div>}
        <span className="qty-badge">{l.qty}×</span>
        {missing > 0 && <span className="missing-badge">{missing} missing</span>}
      </button>
      <figcaption>
        <span className="small">{l.name} <Short st={st} /></span>
        <span className="chips">
          {illegal.has(l.cardId) && <span className="chip bad">not {format}-legal</span>}
          {st && st.inDeck < st.needed && <SlotChips status={{ ...st, inDeck: 0, missing: 0 }} deckName={deckName} isLocked={isLocked} />}
        </span>
      </figcaption>
    </figure>
  );
}
