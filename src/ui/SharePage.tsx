import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { importShared } from '../app/actions';
import { currentSocial, repo } from '../app/repo';
import { unlimitedFor } from '../app/supply';
import { useLoad } from '../app/useLoad';
import { countCards, diffLists } from '../domain/decklist';
import { decodeShare, type SharedDeck } from '../domain/share';
import { slotStatuses, summarize } from '../domain/status';
import { games } from '../games';
import { DiffView, Empty, ErrorBox, GameBadge, Loading, SlotChips } from './components';
import { groupLines } from './deck/group';
import { plural } from './text';
import { useToast } from './toast';
import { useTitle } from './useTitle';

/** The id statuses are computed for: no deck of mine, so nothing counts as "in deck". */
const SHARED = '__shared__';

/** The deck from a share link (in the URL), or a public deck by id. */
async function readShared(handle?: string, deckId?: string): Promise<{ decoded: SharedDeck; owner?: string }> {
  if (deckId) {
    const social = currentSocial();
    if (!social) throw new Error('Sign in to see public decks.');
    const found = await social.publicDeck(deckId);
    if (!found) throw new Error('This deck is private or no longer exists.');
    const { deck, changes } = found;
    return {
      owner: handle,
      decoded: { v: 1, game: deck.game, name: deck.name, format: deck.format, purpose: deck.purpose, changes: changes.map((c) => ({ at: c.createdAt, tags: c.tags, note: c.note, result: c.result, lines: c.lines })) },
    };
  }
  const data = new URLSearchParams(location.hash.slice(1)).get('d');
  if (!data) throw new Error('This link has no deck in it.');
  return { decoded: await decodeShare(data) };
}

async function load(handle?: string, deckId?: string) {
  const { decoded, owner } = await readShared(handle, deckId);
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
  return { shared, adapter, copies, decks, owner };
}

/** A deck someone shared by link: their list and reasons, checked against my collection. */
export function SharePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { handle, deckId } = useParams();
  const { data, error } = useLoad(() => load(handle, deckId), [location.hash, handle, deckId]);
  const [saving, setSaving] = useState(false);
  useTitle(data ? `Shared: ${data.shared.name}` : 'Shared deck');

  if (error) return <Empty><ErrorBox error={error} /><Link to="/">Go to your decks</Link></Empty>;
  if (!data) return <Loading />;

  const { shared, adapter, copies, decks, owner } = data;
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
          <div className="row"><GameBadge name={adapter.name} />{shared.format && <span className="muted small">{shared.format}</span>}{owner ? <span className="chip">public deck by <Link to={`/u/${owner}`}>@{owner}</Link></span> : <span className="chip">shared deck</span>}</div>
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
