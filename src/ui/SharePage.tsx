import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { importShared } from '../app/actions';
import { repo } from '../app/repo';
import { unlimitedFor } from '../app/supply';
import { useLoad } from '../app/useLoad';
import { countCards, diffLists } from '../domain/decklist';
import { decodeShare } from '../domain/share';
import { slotStatuses, summarize } from '../domain/status';
import { games } from '../games';
import { DiffView, Empty, ErrorBox, GameBadge, Loading, SlotChips } from './components';
import { groupLines } from './deck/group';
import { plural } from './text';
import { useToast } from './toast';
import { useTitle } from './useTitle';

/** The id statuses are computed for: no deck of mine, so nothing counts as "in deck". */
const SHARED = '__shared__';

async function load() {
  const data = new URLSearchParams(location.hash.slice(1)).get('d');
  if (!data) throw new Error('This link has no deck in it.');
  const decoded = await decodeShare(data);
  const adapter = games().find((g) => g.id === decoded.game);
  if (!adapter) throw new Error(`This deck is for a game this app does not support (${decoded.game}).`);
  // A section this game does not have would be counted but never shown: put such lines in the main deck.
  const known = new Set(adapter.sections.map((s) => s.id));
  const fallback = known.has('main') ? 'main' : adapter.sections[0].id;
  const shared = {
    ...decoded,
    changes: decoded.changes.map((c) => ({ ...c, lines: c.lines.map((l) => (known.has(l.section) ? l : { ...l, section: fallback })) })),
  };
  const [copies, decks] = await Promise.all([repo.listCopies(shared.game), repo.listDecks()]);
  return { shared, adapter, copies, decks };
}

/** A deck someone shared by link: their list and reasons, checked against my collection. */
export function SharePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error } = useLoad(load, [location.hash]);
  const [saving, setSaving] = useState(false);
  useTitle(data ? `Shared: ${data.shared.name}` : 'Shared deck');

  if (error) return <Empty><ErrorBox error={error} /><Link to="/">Go to your decks</Link></Empty>;
  if (!data) return <Loading />;

  const { shared, adapter, copies, decks } = data;
  const lines = shared.changes.at(-1)!.lines;
  const unlimited = unlimitedFor(adapter.id);
  const statuses = slotStatuses(SHARED, lines, copies, undefined, unlimited);
  const summary = summarize(SHARED, lines, copies, unlimited);
  const deckName = (id: string) => decks.find((d) => d.id === id)?.name ?? 'a deck';
  const ownedNow = summary.inBinder + summary.inOtherDecks;

  const save = async () => {
    setSaving(true);
    try {
      const deck = await importShared(repo, shared);
      toast(`Saved ${deck.name} to your decks`);
      navigate(`/decks/${deck.id}`);
    } catch (e) {
      toast(`Could not save: ${e instanceof Error ? e.message : e}`, 'bad');
      setSaving(false);
    }
  };

  return (
    <>
      <div className="spread">
        <div>
          <div className="row"><GameBadge name={adapter.name} />{shared.format && <span className="muted small">{shared.format}</span>}<span className="chip">shared deck</span></div>
          <h1 style={{ marginTop: '0.4rem' }}>{shared.name}</h1>
          {shared.purpose && <p className="small"><span className="muted">When to play:</span> {shared.purpose}</p>}
        </div>
        <button type="button" className="primary" onClick={save} disabled={saving}>Save a copy to my decks</button>
      </div>

      <div className="panel row">
        <strong>{countCards(lines, 'main')}</strong><span className="muted small">main deck</span>
        <span className="chip info">{plural(ownedNow, 'card')} you own</span>
        <span className={`chip ${summary.missing ? 'bad' : 'ok'}`}>{summary.missing} missing from your collection</span>
      </div>

      <div className="grid2">
        <div className="panel">
          {groupLines(adapter, lines).map((g) => (
            <section key={g.section.id}>
              <div className="section-title"><h3>{g.section.label}</h3><span className="muted small">{g.count}</span></div>
              {g.cats.map((c) => (
                <div key={c.cat}>
                  <div className="cat-title">{c.cat}</div>
                  {c.lines.map((l) => (
                    <div key={`${l.section}|${l.cardId}`} className="card-line">
                      <span className="qty-n">{l.qty}</span>
                      <span>{l.name}<span className="print">{[l.set, l.number].filter(Boolean).join(' ')}</span></span>
                      <span className="chips"><SlotChips status={statuses.get(l.cardId)} deckName={deckName} /></span>
                    </div>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="panel">
          <h3>Why it looks like this</h3>
          {shared.changes.length === 1 && <p className="muted small">The owner shared the current list only, without its history.</p>}
          {[...shared.changes].reverse().map((c, i, arr) => {
            const prev = arr[i + 1];
            return (
              <div key={i} className="history-item">
                <div className="row">
                  <span className="muted small">{Number.isNaN(Date.parse(c.at)) ? '' : new Date(c.at).toLocaleDateString()}</span>
                  {c.tags.map((t) => <span key={t} className="chip accent">{t}</span>)}
                </div>
                {c.note && <p style={{ margin: '0.25rem 0' }}>{c.note}</p>}
                {c.result && <p className="small" style={{ margin: '0.25rem 0' }}>Result: <strong>{c.result}</strong></p>}
                {prev ? <DiffView diff={diffLists(prev.lines, c.lines)} /> : <span className="muted small">{plural(countCards(c.lines), 'card')}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
