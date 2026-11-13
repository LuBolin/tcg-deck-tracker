import { rolesFor } from '../app/prefs';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { addCopies, latestLines } from '../app/actions';
import { toDeckLines } from '../app/importing';
import { repo } from '../app/repo';
import { unlimitedFor } from '../app/supply';
import { useLoad } from '../app/useLoad';
import { cardTotals } from '../domain/decklist';
import { formatUsd } from '../domain/insights';
import { slotStatuses } from '../domain/status';
import { collectionToCsv } from '../domain/csv';
import { downloadText } from './download';
import { BINDER, type Card, type PrintRow } from '../domain/types';
import type { Printing } from '../games/types';
import { CollectionGrid } from './CollectionGrid';
import { games } from '../games';
import type { ResolvedLine } from '../games/types';
import { Empty, ErrorBox, FilterChips, GameField, LabelChip, Loading } from './components';
import { cardTags, cardTypes, searchCards, typeOptions } from '../domain/cardText';
import { useGameChoice } from './useGameChoice';
import { plural } from './text';
import { ListReader } from './ListReader';
import { CardPreviewPanel, CardSearchBox } from './CardSearchBox';
import { stamp } from '../app/cardData';
import { CollectionCardDialog } from './CollectionCardDialog';
import { useTitle } from './useTitle';

async function load(game: string) {
  const [copies, allDecks, printRows] = await Promise.all([repo.listCopies(game), repo.listDecks(), repo.listPrints(game)]);
  const prints = new Map<string, PrintRow[]>();
  for (const p of printRows) prints.set(p.cardId, [...(prints.get(p.cardId) ?? []), p]);
  const decks = allDecks.filter((d) => d.game === game);
  // Per card: decks that are short of it (copies missing, or sitting elsewhere).
  const needs = new Map<string, { deckId: string; short: number; missing: number }[]>();
  for (const d of decks) {
    for (const st of slotStatuses(d.id, await latestLines(repo, d.id), copies, undefined, unlimitedFor(game)).values()) {
      const short = st.needed - st.inDeck;
      if (short > 0) needs.set(st.cardId, [...(needs.get(st.cardId) ?? []), { deckId: d.id, short, missing: st.missing }]);
    }
  }
  const cards = await repo.getCards(game, [...new Set([...copies.map((c) => c.cardId), ...needs.keys()])]);
  return { copies, decks: allDecks, cards, needs, prints };
}

export function CollectionPage() {
  const [gameId, setGameId] = useGameChoice();
  useTitle("Collection");
  const adapter = games().find((g) => g.id === gameId)!;
  const { data, error, reload } = useLoad(() => load(gameId), [gameId]);
  const [filter, setFilter] = useState('');
  const [role, setRole] = useState<string>();
  const [type, setType] = useState<string>();
  const rules = useMemo(() => rolesFor(adapter), [adapter]);
  // Role tags per card, computed once per load.
  const tagsById = useMemo(() => new Map((data?.cards ?? []).map((c) => [c.id, cardTags(c, rules)])), [data, rules]);
  const [adding, setAdding] = useState<ResolvedLine[]>([]);
  const [picked, setPicked] = useState<{ card: Card; qty: number }[]>([]);
  const [unresolved, setUnresolved] = useState(0);
  const [readerKey, setReaderKey] = useState(0);
  const [actionError, setActionError] = useState<string>();
  const [show, setShow] = useState<'all' | 'binder' | 'decks' | 'missing'>('all');
  const [openCard, setOpenCard] = useState<string>();
  const [sort, setSort] = useState<'name' | 'value' | 'count'>('name');
  const [view, setView] = useState<'images' | 'list'>(() => {
    try { return localStorage.getItem('collection-view') === 'list' ? 'list' : 'images'; } catch { return 'images'; }
  });
  const chooseView = (v: 'images' | 'list') => {
    setView(v);
    try { localStorage.setItem('collection-view', v); } catch { /* storage blocked: the choice lasts until reload */ }
  };

  const rows = useMemo(() => {
    // Name, role tag or rules text ("draw a card" finds "draws 2 cards").
    const matched = filter.trim() ? new Set(searchCards(data?.cards ?? [], filter, (c) => tagsById.get(c.id) ?? []).map((c) => c.id)) : undefined;
    if (!data) return [];
    const byCard = new Map<string, { location: string; qty: number }[]>();
    for (const c of data.copies) byCard.set(c.cardId, [...(byCard.get(c.cardId) ?? []), { location: c.location, qty: c.qty }]);
    // Cards decks need but the player owns none of still get a row (shown under "Missing").
    for (const id of data.needs.keys()) if (!byCard.has(id)) byCard.set(id, []);
    return [...byCard]
      .map(([cardId, locs]) => ({
        cardId,
        card: data.cards.find((c) => c.id === cardId),
        name: data.cards.find((c) => c.id === cardId)?.name ?? cardId,
        locs: locs.sort((a, b) => (a.location === BINDER ? -1 : b.location === BINDER ? 1 : b.qty - a.qty)),
        total: locs.reduce((n, l) => n + l.qty, 0),
        needs: data.needs.get(cardId) ?? [],
      }))
      .filter((r) => !matched || matched.has(r.cardId))
      .filter((r) => !role || (tagsById.get(r.cardId) ?? []).includes(role))
      .filter((r) => !type || (!!r.card && cardTypes(r.card).includes(type)))
      .filter((r) =>
        show === 'missing' ? r.needs.some((n) => n.missing > 0)
        : r.total === 0 ? false
        : show === 'all' || (show === 'binder' ? r.locs.some((l) => l.location === BINDER) : r.locs.some((l) => l.location !== BINDER)))
      .sort((a, b) =>
        sort === 'value' ? (b.card?.price ?? 0) * b.total - (a.card?.price ?? 0) * a.total || a.name.localeCompare(b.name)
        : sort === 'count' ? b.total - a.total || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name));
  }, [data, filter, show, sort, role, type, tagsById]);
  const types = useMemo(() => typeOptions(data?.cards ?? [], adapter.categories), [data, adapter]);
  const roles = [...new Set(rows.flatMap((r) => tagsById.get(r.cardId) ?? []).concat(role ? [role] : []))].sort();

  const run = async (fn: () => Promise<unknown>) => {
    setActionError(undefined);
    try {
      await fn();
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const pickCard = (card: Card) => {
    const same = (p: { card: Card }) => p.card.id === card.id && p.card.set === card.set && p.card.number === card.number;
    setPicked((ps) => (ps.some(same) ? ps.map((p) => (same(p) ? { ...p, qty: p.qty + 1 } : p)) : [...ps, { card, qty: 1 }]));
  };

  const addToBinder = () =>
    run(async () => {
      const lines = [...toDeckLines(adding), ...picked.map((p) => ({ cardId: p.card.id, name: p.card.name, qty: p.qty, section: 'main' }))];
      // Cards picked from search are cached like read ones, so the collection can show them.
      if (picked.length) await repo.putCards(stamp(picked.map((p) => p.card)));
      const deltas = [...cardTotals(lines)].map(([cardId, qty]) => ({ cardId, location: BINDER, delta: qty }));
      await repo.adjustCopies(gameId, deltas);
      setAdding([]);
      setPicked([]);
      setReaderKey((k) => k + 1);
    });

  const deckName = (id: string) => data?.decks.find((d) => d.id === id)?.name ?? 'Unknown deck';
  /** Every owned copy, one row per card and place, in columns this app and other collection apps read. */
  const exportCsv = () => {
    if (!data) return;
    const csv = collectionToCsv(data.copies.map((c) => {
      const card = data.cards.find((x) => x.id === c.cardId);
      return { qty: c.qty, name: card?.name ?? c.cardId, set: card?.set, number: card?.number, location: c.location === BINDER ? 'Binder' : deckName(c.location) };
    }));
    downloadText(`${adapter.name}-collection-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
  };
  const total = rows.reduce((n, r) => n + r.total, 0);
  const value = rows.reduce((n, r) => n + (r.card?.price ?? 0) * r.total, 0);

  return (
    <>
      <div className="spread">
        <h1>Collection</h1>
        <GameField value={gameId} onChange={(id) => setGameId(id)} />
      </div>
      <p className="muted">Every owned copy is in one place: the binder or one deck. Move copies between decks from a deck's page.</p>

      <details className="panel">
        <summary><strong>Add cards to the binder</strong></summary>
        <div className="with-preview" style={{ marginTop: '0.75rem' }}>
          <div className="stack">
            <CardSearchBox adapter={adapter} onPick={pickCard} />
            {picked.length > 0 && (
              <ul className="picked-list">
                {picked.map((p, i) => (
                  <li key={`${p.card.id}|${p.card.set}|${p.card.number}`} className="row">
                    <span className="cs-name">{p.card.name}</span>
                    <span className="muted small">{[p.card.set, p.card.number].filter(Boolean).join(' ')}</span>
                    <span className="row" style={{ marginLeft: 'auto' }}>
                      <button type="button" className="small" aria-label={`One fewer ${p.card.name}`} onClick={() => setPicked(picked.flatMap((x, j) => (j !== i ? [x] : x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : [])))}>−</button>
                      <strong>{p.qty}</strong>
                      <button type="button" className="small" aria-label={`One more ${p.card.name}`} onClick={() => setPicked(picked.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))}>+</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <details>
              <summary className="small">Or paste a list or collection CSV</summary>
              <ListReader key={`${gameId}-${readerKey}`} adapter={adapter} label="Card list or collection CSV" onChange={(r, u) => (setAdding(r), setUnresolved(u))} />
            </details>
            {(picked.length > 0 || adding.some((r) => r.card)) && (
              <div className="row">
                <button type="button" className="primary" onClick={addToBinder} disabled={unresolved > 0}>
                  Add {plural(toDeckLines(adding).reduce((n, l) => n + l.qty, 0) + picked.reduce((n, p) => n + p.qty, 0), 'copy', 'copies')} to the binder
                </button>
                {unresolved > 0 && <span className="muted small">Fix or remove the problem lines first.</span>}
              </div>
            )}
          </div>
          <CardPreviewPanel title="Adding" items={[
            ...picked.map((p) => ({ key: `pick|${p.card.id}|${p.card.set}|${p.card.number}`, name: p.card.name, qty: p.qty, card: p.card })),
            ...adding.map((r) => ({ key: `${r.line.lineNo}|${r.line.raw}`, name: r.card?.name ?? r.line.name, qty: r.line.qty, card: r.card })),
          ]} />
        </div>
      </details>

      <ErrorBox error={error ?? actionError} />
      {!data ? <Loading /> : data.copies.length === 0 && data.needs.size === 0 ? (
        <Empty>
          <p>No {adapter.name} cards in your collection yet.</p>
          <p>Import a deck you own, or add cards to the binder above.</p>
          <Link className="btn primary" to="/import">Import a deck</Link>
        </Empty>
      ) : (
        <div className="panel">
          <div className="spread" style={{ marginBottom: '0.5rem' }}>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a card: name, role or text" aria-label="Find a card" title='Searches names, role tags and rules text, for example "draw a card"' />
            <button type="button" className="small" onClick={exportCsv}>Export CSV</button>
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort cards">
              <option value="name">By name</option>
              <option value="value">Most valuable</option>
              <option value="count">Most copies</option>
            </select>
            <div className="segmented" role="group" aria-label="Show">
              {([['all', 'Owned'], ['binder', 'In binder'], ['decks', 'In decks'], ['missing', 'Missing']] as const).map(([v, label]) => (
                <button key={v} type="button" aria-pressed={show === v} className={show === v ? 'on' : ''} onClick={() => setShow(v)}>{label}</button>
              ))}
            </div>
            <div className="segmented" role="group" aria-label="View">
              <button type="button" aria-pressed={view === 'images'} className={view === 'images' ? 'on' : ''} onClick={() => chooseView('images')}>Images</button>
              <button type="button" aria-pressed={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => chooseView('list')}>List</button>
            </div>
            <span className="muted small">
              {plural(total, 'copy', 'copies')}, {plural(rows.length, 'card')}{value > 0 && <> · about <strong className="text">{formatUsd(value)}</strong></>}
            </span>
          </div>
          <FilterChips label="Type" options={types} value={type} onChange={setType} style={{ marginBottom: '0.5rem' }} />
          <FilterChips label="Roles" options={roles} value={role} onChange={setRole} style={{ marginBottom: '0.5rem' }} extra={<Link className="small" to="/settings#roles">Rename</Link>} />
          {view === 'images' && (rows.length === 0
            ? <p className="muted small">{show === 'missing' ? 'Your decks are not missing any cards.' : 'No cards match.'}</p>
            : <CollectionGrid adapter={adapter} rows={rows} prints={data.prints} onOpen={setOpenCard}
                onBinder={(cardId, delta) => run(() => addCopies(repo, gameId, cardId, BINDER, delta))} />)}
          {view === 'list' && <table className="list">
            <thead><tr><th>Card</th><th className="num">Owned</th><th>Where</th><th>Needed by</th><th className="num">Value</th><th className="num">Binder</th></tr></thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6} className="muted small">{show === 'missing' ? 'Your decks are not missing any cards.' : 'No cards match.'}</td></tr>
              )}
              {rows.map((r) => {
                const binder = r.locs.find((l) => l.location === BINDER)?.qty ?? 0;
                return (
                  <tr key={r.cardId}>
                    <td>
                      <span className="card-name">
                        <button type="button" className="link-button" onClick={() => setOpenCard(r.cardId)}>{r.name}</button>
                        {r.card?.imageUrl && <img className="preview" src={r.card.imageUrl} alt="" loading="lazy" />}
                      </span>
                      {(tagsById.get(r.cardId)?.length ?? 0) > 0 && <span className="row labels">{tagsById.get(r.cardId)!.map((t) => <LabelChip key={t} name={t} />)}</span>}
                    </td>
                    <td className="num">{r.total}</td>
                    <td>
                      <div className="row">
                        {r.locs.map((l) =>
                          l.location === BINDER ? (
                            <span key={l.location} className="chip info">Binder × {l.qty}</span>
                          ) : (
                            <Link key={l.location} className="chip warn" to={`/decks/${l.location}`}>{deckName(l.location)} × {l.qty}</Link>
                          ),
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="row">
                        {r.needs.map((n) => (
                          <Link key={n.deckId} className={`chip ${n.missing > 0 ? 'bad' : 'warn'}`} to={`/decks/${n.deckId}`}
                            title={n.missing > 0 ? `${n.missing} not owned` : 'Owned, but in another place'}>
                            {deckName(n.deckId)} needs {n.short}
                          </Link>
                        ))}
                      </div>
                    </td>
                    <td className="num small muted">{r.card?.price !== undefined && r.total > 0 ? formatUsd(r.card.price * r.total) : '—'}</td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button type="button" className="small" disabled={binder === 0} onClick={() => run(() => addCopies(repo, gameId, r.cardId, BINDER, -1))} aria-label={`Remove one ${r.name} from binder`}>−</button>
                        <button type="button" className="small" onClick={() => run(() => addCopies(repo, gameId, r.cardId, BINDER, 1))} aria-label={`Add one ${r.name} to binder`}>+</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>}
        </div>
      )}
      {openCard && data && (() => {
        const r = rows.find((x) => x.cardId === openCard);
        if (!r) return null;
        return (
          <CollectionCardDialog adapter={adapter} name={r.name} card={r.card} locs={r.locs} needs={r.needs} deckName={deckName}
            prints={data.prints.get(r.cardId) ?? []}
            onSetPrint={(p: Printing, qty: number, addCopy: boolean) => run(async () => {
              if (addCopy) await addCopies(repo, gameId, r.cardId, BINDER, 1);
              await repo.setPrint({ game: gameId, cardId: r.cardId, printId: p.printId, qty, rarity: p.rarity, set: p.set, number: p.number, imageUrl: p.imageUrl });
            })}
            onClose={() => setOpenCard(undefined)}
            onBinder={(delta) => run(() => addCopies(repo, gameId, r.cardId, BINDER, delta))} />
        );
      })()}
    </>
  );
}
