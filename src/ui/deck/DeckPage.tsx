import { rolesFor } from '../../app/prefs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import * as actions from '../../app/actions';
import { currentAccount, repo } from '../../app/repo';
import { unlimitedFor } from '../../app/supply';
import { useLoad } from '../../app/useLoad';
import { isStale } from '../../app/cardData';
import { cardTags, cardTypes, searchCards, typeOptions } from '../../domain/cardText';
import { countCards, diffLists } from '../../domain/decklist';
import { coverArt, deckValue, formatRecord, formatUsd, illegalCards, totalRecord, type MatchRecord } from '../../domain/insights';
import { plural } from '../text';
import { slotStatuses, summarize, type SlotStatus } from '../../domain/status';
import { moveDeltas } from '../../domain/collection';
import type { Card, CopyDelta, DeckLine } from '../../domain/types';
import { deckCount, describeIssue, sizeLabel, validateDeck } from '../../domain/rules';
import { pendingParentChanges } from '../../domain/variants';
import { getGame } from '../../games';
import { CopyButton, DiffView, Empty, ErrorBox, FilterChips, GameBadge, LabelChip, Loading, MoreMenu } from '../components';
import { useToast } from '../toast';
import { CardDialog } from './CardDialog';
import { CardList, type View } from './CardList';
import { DeckStats } from './DeckStats';
import { EditList } from './EditList';
import { GatherPanel } from './GatherPanel';
import { SharePanel } from './SharePanel';
import { UpdateFromList } from './UpdateFromList';
import { useTitle } from '../useTitle';
import { downloadText } from '../download';
import { CompareWith, Labels, LogResult, MakeVariant } from './DeckParts';
import { deckGuide } from './deckGuide';
import { VersionGraph } from './VersionGraph';
import { deckFamily } from '../../domain/variants';

async function load(id: string) {
  const deck = await repo.getDeck(id);
  if (!deck) return null;
  const [changes, copies, decks] = await Promise.all([repo.listChanges(id), repo.listCopies(deck.game), repo.listDecks()]);
  const parent = deck.parentDeckId ? decks.find((d) => d.id === deck.parentDeckId) : undefined;
  const parentChanges = parent ? await repo.listChanges(parent.id) : [];
  const ids = [...new Set(changes.flatMap((c) => c.lines.map((l) => l.cardId)))];
  const cards = new Map((await repo.getCards(deck.game, ids)).map((c) => [c.id, c]));
  const children = decks.filter((d) => d.parentDeckId === deck.id);
  const childLines = new Map<string, DeckLine[]>();
  const childRecords = new Map<string, MatchRecord>();
  for (const c of children) {
    const ch = await repo.listChanges(c.id);
    childLines.set(c.id, ch.at(-1)?.lines ?? []);
    childRecords.set(c.id, totalRecord(ch.map((x) => x.result)));
  }
  // The whole family (original deck and every variant), for the version graph.
  const family = deckFamily(decks, deck.id);
  const familyChanges = new Map(await Promise.all(family.map(async (d) => [d.id, d.id === deck.id ? changes : await repo.listChanges(d.id)] as const)));
  return { deck, changes, copies, decks, parent, parentChanges, cards, children, childLines, childRecords, family, familyChanges };
}

/** Deeper legality results per session, so a deck is not re-checked on every visit. */
const legalityCache = new Map<string, boolean>();
const VIEW_KEY = 'deck-view';

type Tab = 'cards' | 'stats' | 'history' | 'variants';

/** Keyed by deck id, so tabs and drafts reset when moving to another deck. */
export function DeckPage() {
  const { id = '' } = useParams();
  return <DeckView key={id} id={id} />;
}

function DeckView({ id }: { id: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => load(id), [id]);
  const [tab, setTab] = useState<Tab>('cards');
  const [draft, setDraft] = useState<DeckLine[] | null>(null);
  const [draftBase, setDraftBase] = useState(0);
  const [showExport, setShowExport] = useState(false);
  const [exportMode, setExportMode] = useState<string>('list');
  const [actionError, setActionError] = useState<string>();
  const [view, setView] = useState<View>(() => {
    try { return (localStorage.getItem(VIEW_KEY) as View) || 'list'; } catch { return 'list'; }
  });
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<DeckLine>();
  const [logging, setLogging] = useState(false);
  const [gathering, setGathering] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [comparing, setComparing] = useState<number>();
  const [tagFilter, setTagFilter] = useState<string>();
  const [cardFilter, setCardFilter] = useState<'all' | 'missing' | 'away'>('all');
  const [cardQuery, setCardQuery] = useState('');
  const [role, setRole] = useState<string>();
  const [variantFrom, setVariantFrom] = useState<number>();
  const [type, setType] = useState<string>();
  const [updateBase, setUpdateBase] = useState(0);
  const [checking, setChecking] = useState(false);
  const [legalTick, setLegalTick] = useState(0);
  const autoRefreshed = useRef(false);

  useTitle(data?.deck.name);
  const lines = useMemo(() => data?.changes.at(-1)?.lines ?? [], [data]);
  const cards = useMemo(() => data?.cards ?? new Map<string, Card>(), [data]);
  const lockedIds = useMemo(() => new Set((data?.decks ?? []).filter((d) => d.locked).map((d) => d.id)), [data]);
  const statuses = useMemo(() => (data ? slotStatuses(data.deck.id, lines, data.copies, lockedIds, unlimitedFor(data.deck.game)) : new Map<string, SlotStatus>()), [data, lines, lockedIds]);
  const adapter = data ? getGame(data.deck.game) : undefined;
  const format = data?.deck.format;
  const confirmed = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const l of lines) {
      const v = legalityCache.get(`${data?.deck.game}|${format}|${l.cardId}`);
      if (v !== undefined) m.set(l.cardId, v);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, format, legalTick, data?.deck.game]);
  const illegal = useMemo(() => illegalCards(lines, cards, format, confirmed), [lines, cards, format, confirmed]);

  const refresh = async (quiet = false) => {
    if (!data || !adapter) return;
    setRefreshing(true);
    try {
      const n = await actions.refreshCardData(repo, adapter, lines);
      if (!quiet) toast(`Updated data for ${n} cards`);
      reload();
    } catch (e) {
      if (!quiet) toast(`Could not update card data: ${e instanceof Error ? e.message : e}`, 'bad');
    } finally {
      setRefreshing(false);
    }
  };

  // Decks imported before prices/legality existed: fetch card data once, quietly.
  useEffect(() => {
    if (!data || autoRefreshed.current || lines.length === 0) return;
    autoRefreshed.current = true;
    // Missing or week-old card data (prices, legality, banlists change): fetch it again, quietly.
    if (lines.some((l) => isStale(cards.get(l.cardId)))) void refresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Deeper legality check (Pokémon: any legal printing with the same text counts).
  useEffect(() => {
    if (!adapter?.checkLegality || !format || checking) return;
    const toCheck = [...illegal].filter((cid) => !confirmed.has(cid)).map((cid) => cards.get(cid)).filter((c): c is Card => !!c);
    if (toCheck.length === 0) return;
    setChecking(true);
    adapter.checkLegality(toCheck, format)
      .then((res) => {
        for (const [cid, ok] of res) legalityCache.set(`${adapter.id}|${format}|${cid}`, ok);
        setLegalTick((t) => t + 1);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [illegal, format]);

  if (error) return <ErrorBox error={error} />;
  if (data === undefined || !adapter) return <Loading />;
  if (data === null) return <Empty>This deck does not exist. <Link to="/">Back to your decks</Link></Empty>;

  const { deck, changes, copies, decks, parent, parentChanges, children, childLines, childRecords, family, familyChanges } = data;
  const record = totalRecord(changes.map((c) => c.result));
  // Cards filter: missing = not owned at all; away = owned but in the binder or another deck.
  const roleRules = rolesFor(adapter);
  const tagsOf = (cardId: string) => { const c = cards.get(cardId); return c ? cardTags(c, roleRules) : []; };
  const roles = [...new Set(lines.flatMap((l) => tagsOf(l.cardId)))].sort();
  // Name, role or rules text; lines without card data match by name only.
  const queried = cardQuery.trim()
    ? new Set(searchCards(lines.map((l) => cards.get(l.cardId) ?? { game: deck.game, id: l.cardId, name: l.name }), cardQuery, (c) => tagsOf(c.id)).map((c) => c.id))
    : undefined;
  const types = typeOptions(lines.flatMap((l) => cards.get(l.cardId) ?? []), adapter.categories);
  const shownLines = lines.filter((l) => {
    if (queried && !queried.has(l.cardId)) return false;
    if (type && !cardTypes(cards.get(l.cardId) ?? { game: deck.game, id: l.cardId, name: l.name, category: l.category }).includes(type)) return false;
    if (role && !tagsOf(l.cardId).includes(role)) return false;
    if (cardFilter === 'all') return true;
    const st = statuses.get(l.cardId);
    return cardFilter === 'missing' ? (st?.missing ?? 0) > 0 : !!st && st.inDeck < st.needed && st.missing < st.needed - st.inDeck;
  });
  const filtering = cardFilter !== 'all' || !!queried || !!role || !!type;
  const historyTags = [...new Set(changes.flatMap((c) => c.tags))].sort();
  const cover = coverArt(lines, cards);
  const summary = summarize(deck.id, lines, copies, unlimitedFor(deck.game));
  const value = deckValue(lines, cards, statuses);
  const deckName = (did: string) => decks.find((d) => d.id === did)?.name ?? 'another deck';
  const isLocked = (did: string) => lockedIds.has(did);
  const knownLabels = [...new Set(decks.flatMap((d) => d.labels ?? []))].sort();
  const inDeckTotal = copies.filter((c) => c.location === deck.id).reduce((n, c) => n + c.qty, 0);
  // Locked decks keep their cards: Gather only offers the binder and decks in rotation.
  const gatherable = [...statuses.values()].reduce((n, s) => n + s.inBinder + s.inOtherDecks.filter((o) => !isLocked(o.deckId)).reduce((m, o) => m + o.qty, 0), 0);
  const pending = parent ? pendingParentChanges(deck, parentChanges) : [];
  const rules = adapter.deckRules(deck.format);
  const issues = validateDeck(lines, rules, cards);
  const fromParent = parent ? diffLists(parentChanges.at(-1)?.lines ?? [], lines) : [];
  const extraExport = adapter.exports?.find((e) => e.label === exportMode);
  const exportText = extraExport ? extraExport.format(lines)
    : exportMode === 'guide' ? deckGuide(deck.name, adapter.formatList(lines), changes, parent?.name)
    : adapter.formatList(lines);

  /** Run an action, then reload; show failures instead of losing them. */
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setActionError(undefined);
    try {
      await fn();
      if (done) toast(done);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Toast action that reverses copy changes. */
  const undo = (deltas: CopyDelta[]) => ({
    label: 'Undo',
    run: () => run(() => actions.revertDeltas(repo, deck.game, deltas), 'Undone'),
  });
  const moveInto = (cardId: string, name: string, from: string, qty: number) => {
    const deltas = moveDeltas(cardId, from, deck.id, qty);
    return run(async () => {
      await repo.adjustCopies(deck.game, deltas);
      toast(`Moved ${qty} ${name} into ${deck.name}`, 'ok', undo(deltas));
    });
  };

  const touch = (patch: Partial<typeof deck>) => actions.updateDeck(repo, deck.id, patch);
  /** Open the editor, remembering which change the edit starts from. */
  const startEdit = (initial: DeckLine[]) => {
    setDraftBase(changes.at(-1)?.seq ?? 0);
    setDraft(initial);
  };

  const rename = () => {
    const name = window.prompt('Deck name', deck.name)?.trim();
    if (name && name !== deck.name) run(() => touch({ name }), 'Deck renamed');
  };

  const archive = () => {
    if (!window.confirm(`Archive "${deck.name}"?

All ${inDeckTotal} copies in it go back to your binder. The list and history stay; the deck moves to Empty decks.`)) return;
    run(async () => {
      const deltas = await actions.archiveDeck(repo, deck);
      toast(`Archived ${deck.name}: ${actions.movedCount(deltas)} copies went to the binder`, 'ok', undo(deltas));
    });
  };

  const remove = () => {
    const inDeck = copies.filter((c) => c.location === deck.id).reduce((n, c) => n + c.qty, 0);
    const msg = `Delete "${deck.name}"?\n\n${inDeck} owned copies in it go back to your binder. Its change history is deleted and cannot be restored.`;
    if (window.confirm(msg)) run(async () => {
      await actions.deleteDeck(repo, deck);
      toast(`Deleted ${deck.name}. ${inDeck} copies went back to the binder.`);
      navigate('/');
    });
  };

  const chooseView = (v: View) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* per-viewer convenience only */ }
  };

  return (
    <>
      <nav className="crumbs small"><Link to="/">Decks</Link> / {parent && <><Link to={`/decks/${parent.id}`}>{parent.name}</Link> / </>}<span>{deck.name}</span></nav>
      <div className="spread">
        <div>
          <div className="row">
            <GameBadge name={adapter.name} />
            <select className="inline-select" value={deck.format ?? ''} aria-label="Format" onChange={(e) => run(() => touch({ format: e.target.value || undefined }), 'Format changed')}>
              <option value="">No format</option>
              {adapter.formats.map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>
          <div className="deck-title">
            {cover && <img className="deck-title-art" src={cover} alt="" />}
            <h1>{deck.name}</h1>
            {deck.locked && <span className="chip" title="Its cards are not offered for gathering into other decks">Locked</span>}
            {deck.isPublic && <span className="chip accent" title="Anyone signed in can view it; your followers see its changes">Public</span>}
          </div>
          <Labels value={deck.labels} known={knownLabels} onSave={(labels) => run(() => touch({ labels: labels.length ? labels : undefined }))} />
          {deck.purpose && <p className="purpose small"><span className="muted">When to play:</span> {deck.purpose}</p>}
          {parent && (
            <p className="muted small">
              Variant of <Link to={`/decks/${parent.id}`}>{parent.name}</Link>
              {' · '}{fromParent.length ? <>differs by <DiffView diff={fromParent} /></> : 'same cards as its parent'}
            </p>
          )}
        </div>
        <div className="row">
          <button type="button" onClick={() => setShowExport((v) => !v)} aria-expanded={showExport}>Export</button>
          <button type="button" onClick={() => setSharing((v) => !v)} aria-expanded={sharing}>Share</button>
          <Link className="btn" to={`/want?deck=${deck.id}`}>Want-list</Link>
          <MoreMenu items={[
            { label: 'Rename', onClick: rename },
            { label: 'Duplicate (independent copy)', onClick: () => run(async () => { const c = await actions.duplicateDeck(repo, deck, `${deck.name} copy`); toast(`Made ${c.name}`); navigate(`/decks/${c.id}`); }) },
            { label: 'Update from a list', disabled: !!draft, onClick: () => { setTab('cards'); setUpdating(true); setUpdateBase(changes.at(-1)?.seq ?? 0); } },
            deck.locked
              ? { label: 'Put back in rotation', onClick: () => run(() => touch({ locked: undefined }), 'Back in rotation') }
              : { label: 'Lock (keep its cards here)', onClick: () => run(() => touch({ locked: true }), 'Locked: its cards stay out of other decks') },
            ...(currentAccount() ? [deck.isPublic
              ? { label: 'Make private', onClick: () => run(() => touch({ isPublic: undefined }), 'Private: only you can see it') }
              : { label: 'Make public', onClick: () => run(() => touch({ isPublic: true }), 'Public: your followers will see its changes') }] : []),
            { label: 'Archive (all cards to binder)…', disabled: inDeckTotal === 0, onClick: archive },
            { label: 'Delete deck…', onClick: remove, danger: true },
          ]} />
        </div>
      </div>

      <div className="panel summary">
        <div className="row">
          <strong className={issues.some((i) => i.kind === 'size') ? 'warn-text' : ''}>
            {deckCount(lines, rules)}{rules.size ? ` / ${sizeLabel(rules)}` : ''}
          </strong>
          <span className="muted small">main deck</span>
          <span className="chip ok">{summary.inDeck} in deck</span>
          {summary.inBinder > 0 && <span className="chip info">{summary.inBinder} in binder</span>}
          {summary.inOtherDecks > 0 && <span className="chip warn">{summary.inOtherDecks} in other decks</span>}
          <span className={`chip ${summary.missing ? 'bad' : 'ok'}`}>{summary.missing} missing</span>
          {issues.length > 0 && <span className="chip warn">{issues.length === 1 ? '1 rule problem' : `${issues.length} rule problems`}</span>}
          {format && (illegal.size > 0
            ? <span className="chip bad">{illegal.size} not {format}-legal{checking ? ' (checking…)' : ''}</span>
            : checking ? <span className="chip">checking {format} legality…</span> : null)}
        </div>
        {issues.length > 0 && (
          <ul className="issues small" style={{ margin: 0 }}>{issues.map((i) => <li key={describeIssue(i)}>{describeIssue(i)}</li>)}</ul>
        )}
        <div className="row">
          {value.total > 0 && <span className="small muted">Value <strong className="text">{formatUsd(value.total)}</strong></span>}
          {value.toComplete > 0 && <span className="small muted">To complete <strong className="text">{formatUsd(value.toComplete)}</strong></span>}
          {record.events > 0 && <span className="small muted">Record <strong className="text">{formatRecord(record)}</strong> over {plural(record.events, 'event')}</span>}
          <span style={{ flex: 1 }} />
          {gatherable > 0 && (
            <button type="button" className="small" onClick={() => setGathering((v) => !v)} aria-expanded={gathering}>
              Gather {gatherable} cards
            </button>
          )}
          {summary.extra.length > 0 && (
            <button type="button" className="small" onClick={() => run(() => actions.returnExtras(repo, deck, lines), 'Unused copies went back to the binder')}>
              Return {summary.extra.reduce((n, e) => n + e.qty, 0)} unused to binder
            </button>
          )}
          <button type="button" className="small ghost" onClick={() => refresh()} disabled={refreshing}>{refreshing ? 'Updating…' : 'Update card data'}</button>
        </div>
      </div>

      <ErrorBox error={actionError} />

      {gathering && (
        <GatherPanel lines={lines} statuses={statuses} deckName={deckName} isLocked={isLocked} onClose={() => setGathering(false)}
          onGather={(from, label) => run(async () => {
            const deltas = await actions.gatherFrom(repo, deck, lines, from);
            toast(`Moved ${plural(actions.movedCount(deltas), 'card')} from ${label} into ${deck.name}`, 'ok', undo(deltas));
          })} />
      )}

      {sharing && <SharePanel deck={deck} changes={changes} onClose={() => setSharing(false)} />}

      {showExport && (
        <div className="panel stack">
          <div className="spread">
            <div className="segmented" role="group" aria-label="Export type">
              <button type="button" aria-pressed={exportMode === 'list'} className={exportMode === 'list' ? 'on' : ''} onClick={() => setExportMode('list')}>Deck list</button>
              <button type="button" aria-pressed={exportMode === 'guide'} className={exportMode === 'guide' ? 'on' : ''} onClick={() => setExportMode('guide')}>List with change notes</button>
              {adapter.exports?.map((e) => (
                <button key={e.label} type="button" aria-pressed={exportMode === e.label} className={exportMode === e.label ? 'on' : ''} onClick={() => setExportMode(e.label)}>{e.label}</button>
              ))}
            </div>
            <div className="row">
              <CopyButton text={exportText} />
              <button type="button" onClick={() => downloadText(`${deck.name}${extraExport?.label.startsWith('.') ? extraExport.label.split(' ')[0] : '.txt'}`, exportText)}>Download</button>
            </div>
          </div>
          <textarea readOnly value={exportText} aria-label="Exported deck list" style={{ minHeight: '14rem' }} />
          <p className="muted small">
            {exportMode === 'list'
              ? `Imports into other tools as is. Standard formats cannot hold missing flags, so this is the full list.`
              : exportMode === 'guide' ? 'For sharing: the list plus every change and its reason, newest first.'
              : `Save this text as a file to load it in other apps.`}
          </p>
        </div>
      )}

      {pending.map((p, i) => (
        <div key={p.change.id} className="notice">
          <div className="spread">
            <div>
              <strong>{parent!.name} changed</strong> <span className="muted small">(change {p.change.seq}{p.change.note ? `: ${p.change.note}` : ''})</span>
              <div><DiffView diff={p.diff} /></div>
            </div>
            {/* Parent changes are taken in order, and not while a list edit is open. */}
            {i === 0 && !draft ? (
              <div className="row">
                <button type="button" className="small primary" onClick={() => run(() => actions.applyParentChange(repo, deck, parent!.name, p), 'Change applied to this variant')}>Apply here too</button>
                <button type="button" className="small" onClick={() => run(() => actions.dismissParentChange(repo, deck, p))}>Dismiss</button>
              </div>
            ) : (
              <span className="muted small">{draft ? 'Finish your edit first' : 'After the change above'}</span>
            )}
          </div>
        </div>
      ))}

      <div className="tabs" role="tablist">
        {(['cards', 'stats', 'history', 'variants'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'cards' ? 'Cards' : t === 'stats' ? 'Stats' : t === 'history' ? `History (${changes.length})` : `Variants (${children.length})`}
          </button>
        ))}
      </div>

      {tab === 'cards' && updating && !draft && (
        <UpdateFromList adapter={adapter} lines={lines} onClose={() => setUpdating(false)}
          onSave={(next, info) => run(async () => { await actions.saveChange(repo, deck, next, info, { baseSeq: updateBase }); setUpdating(false); }, 'Deck updated from the list')} />
      )}
      {tab === 'cards' && lines.length === 0 && !draft && (
        <Empty>
          <p>This deck is empty. Add cards by searching, or paste a list on the import page.</p>
          <button type="button" className="primary" onClick={() => startEdit([])}>Add cards</button>
        </Empty>
      )}
      {tab === 'cards' && (lines.length > 0 || draft) && (draft ? (
        <EditList adapter={adapter} format={format} cards={cards} lines={lines} usedTags={[...new Set(changes.flatMap((c) => c.tags))].filter((t) => !['restore', 'result', 'from parent'].includes(t))} draft={draft} setDraft={setDraft}
          onSave={(info) => run(async () => { await actions.saveChange(repo, deck, draft, info, { baseSeq: draftBase }); setDraft(null); }, 'Change saved')} />
      ) : (
        <>
          <div className="spread" style={{ marginBottom: '0.5rem' }}>
            <div className="row">
              <button type="button" className="primary" onClick={() => startEdit(lines.map((l) => ({ ...l })))}>Edit list</button>
              <button type="button" onClick={() => setLogging((v) => !v)} aria-expanded={logging}>Log a result</button>
            </div>
            <div className="row">
            <input value={cardQuery} onChange={(e) => setCardQuery(e.target.value)} placeholder="Find: name, role or text" aria-label="Find a card in this deck" style={{ minWidth: '12rem' }} />
            <div className="segmented" role="group" aria-label="Show cards">
              {([['all', 'All'], ['missing', 'Missing'], ['away', 'Not in deck']] as const).map(([v, label]) => (
                <button key={v} type="button" aria-pressed={cardFilter === v} className={cardFilter === v ? 'on' : ''} onClick={() => setCardFilter(v)}>{label}</button>
              ))}
            </div>
            <div className="segmented" role="group" aria-label="View">
              <button type="button" aria-pressed={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => chooseView('list')}>List</button>
              <button type="button" aria-pressed={view === 'images'} className={view === 'images' ? 'on' : ''} onClick={() => chooseView('images')}>Images</button>
            </div>
            </div>
          </div>
          <FilterChips label="Type" options={types} value={type} onChange={setType} />
          <FilterChips label="Roles" options={roles} value={role} onChange={setRole} extra={<Link className="small" to="/settings#roles">Rename</Link>} />
          {logging && (
            <LogResult onCancel={() => setLogging(false)}
              onSave={(result, note) => run(async () => { await actions.saveChange(repo, deck, lines, { tags: ['result'], result, note }, { baseSeq: changes.at(-1)?.seq ?? 0 }); setLogging(false); }, 'Result logged')} />
          )}
          {shownLines.length === 0 && filtering && <p className="muted small">{queried || role || type ? 'No cards in this deck match.' : cardFilter === 'missing' ? 'Nothing missing: you own every card in this deck.' : 'Every owned copy is already in this deck.'}</p>}
          {(shownLines.length > 0 || !filtering) && <CardList adapter={adapter} lines={shownLines} statuses={statuses} cards={cards} illegal={illegal} format={format} view={view} deckName={deckName} isLocked={isLocked}
            onOpen={setDetail}
            onMove={(l, from, qty) => moveInto(l.cardId, l.name, from, qty)} />}
          {detail && (
            <CardDialog adapter={adapter} deckId={deck.id} line={detail} card={cards.get(detail.cardId)} status={statuses.get(detail.cardId)} deckName={deckName} isLocked={isLocked}
              onClose={() => setDetail(undefined)}
              onTakeOut={(qty, updateList) => run(async () => {
                const deltas = await actions.takeOut(repo, deck, detail, qty, updateList);
                toast(updateList ? `Removed ${qty} ${detail.name}; they went to the binder` : `Took out ${qty} ${detail.name}; the deck still needs them`, 'ok', undo(deltas));
                if (updateList && qty >= detail.qty) setDetail(undefined);
              })}
              onTrim={(qty) => run(async () => {
                await actions.setLineQty(repo, deck, detail, qty);
                if (qty === 0) setDetail(undefined); else setDetail({ ...detail, qty });
              }, 'List updated')}
              onMove={(from, qty) => moveInto(detail.cardId, detail.name, from, qty)}
              onAcquired={(qty) => {
                const deltas = [{ cardId: detail.cardId, location: deck.id, delta: qty }];
                run(async () => {
                  await repo.adjustCopies(deck.game, deltas);
                  toast(`Added ${qty} new ${detail.name} to ${deck.name}`, 'ok', undo(deltas));
                });
              }} />
          )}
        </>
      ))}

      {tab === 'stats' && <DeckStats adapter={adapter} lines={lines} cards={cards} statuses={statuses} />}

      {tab === 'history' && (
        <div className="panel">
          <p className="small muted" style={{ marginTop: 0 }}>Every saved change, newest first.{' '}
            <button type="button" className="link-button" onClick={() => setTab('variants')}>See the version graph</button> to follow this deck and its variants together.</p>
          {historyTags.length > 0 && (
            <div className="row" style={{ marginBottom: '0.75rem' }} role="group" aria-label="Filter by tag">
              <span className="muted small">Show:</span>
              <button type="button" className={`chip ${!tagFilter ? 'on' : ''}`} aria-pressed={!tagFilter} onClick={() => setTagFilter(undefined)}>all</button>
              {historyTags.map((t) => (
                <button key={t} type="button" className={`chip ${tagFilter === t ? 'on' : ''}`} aria-pressed={tagFilter === t} onClick={() => setTagFilter(tagFilter === t ? undefined : t)}>{t}</button>
              ))}
            </div>
          )}
          {[...changes].reverse().filter((c) => !tagFilter || c.tags.includes(tagFilter)).map((c) => {
            const prev = changes.find((x) => x.seq === c.seq - 1);
            return (
              <div key={c.id} className="history-item">
                <div className="row">
                  <strong>Change {c.seq}</strong>
                  <span className="muted small">{new Date(c.createdAt).toLocaleString()}</span>
                  {c.tags.map((t) => <span key={t} className="chip accent">{t}</span>)}
                </div>
                {c.note && <p style={{ margin: '0.25rem 0' }}>{c.note}</p>}
                {c.result && <p className="small" style={{ margin: '0.25rem 0' }}>Result: <strong>{c.result}</strong></p>}
                {prev ? <DiffView diff={diffLists(prev.lines, c.lines)} /> : <span className="muted small">{countCards(c.lines)} cards</span>}
                {c.seq !== changes.at(-1)?.seq && (
                  <div style={{ marginTop: '0.3rem' }}>
                    <button type="button" className="small ghost" aria-expanded={comparing === c.seq} onClick={() => setComparing(comparing === c.seq ? undefined : c.seq)}>
                      {comparing === c.seq ? 'Hide comparison' : 'Compare with now'}
                    </button>
                    {comparing === c.seq && (
                      <div className="small" style={{ margin: '0.25rem 0' }}>
                        From this version to now: <DiffView diff={diffLists(c.lines, lines)} />
                      </div>
                    )}
                    <button type="button" className="small ghost" onClick={() => {
                      const back = diffLists(lines, c.lines);
                      if (back.length === 0) return toast('The deck already matches this version');
                      if (window.confirm(`Go back to the list from change ${c.seq}? This saves a new change (${back.length} card lines differ); history is kept.`)) {
                        run(() => actions.saveChange(repo, deck, c.lines, { tags: ['restore'], note: `Back to the list from change ${c.seq}` }), `Restored the list from change ${c.seq}`);
                      }
                    }}>Use this version again</button>
                    <button type="button" className="small ghost" onClick={() => { setVariantFrom(c.seq); setTab('variants'); }}>Make a variant from this version</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'variants' && (
        <div className="panel stack">
          <p className="muted small">A variant is a copy of this deck that remembers where it came from. Use one for a different meta, a budget build or a test. When this deck changes, its variants can apply the change too. Variants share your physical cards; nothing is copied.</p>
          {family.length > 1 || changes.length > 1 ? (
            <div>
              <h2 style={{ marginTop: 0 }}>Version graph</h2>
              <p className="muted small" style={{ marginTop: 0 }}>Every saved change in this deck family, newest first. Each color is one deck; curves show where a variant was made, dashed curves a change it took from its parent. Click a deck name to open it.</p>
              <VersionGraph family={family} changes={familyChanges} currentId={deck.id} />
            </div>
          ) : null}
          <h2>Make a variant</h2>
          {variantFrom !== undefined && (
            <p className="row small">Made from change {variantFrom} (an older version), not the latest.
              <button type="button" className="small ghost" onClick={() => setVariantFrom(undefined)}>Use the latest instead</button></p>
          )}
          <MakeVariant defaultName={`${deck.name} variant`} known={knownLabels}
            onMake={(name, labels) => run(async () => { const v = await actions.makeVariant(repo, deck, name, labels, variantFrom); toast(`Made ${v.name}`); navigate(`/decks/${v.id}`); })} />
          {children.length > 0 && <h2>Variants of this deck</h2>}
          {children.length > 0 && (
            <ul className="deck-tree">
              {children.map((c) => {
                const d = diffLists(lines, childLines.get(c.id) ?? []);
                return (
                  <li key={c.id} className="deck-row">
                    <span className="stack" style={{ gap: 0 }}>
                      <Link to={`/decks/${c.id}`}>{c.name}</Link>
                      {(c.labels?.length ?? 0) > 0 && <span className="row">{c.labels!.map((l) => <LabelChip key={l} name={l} />)}</span>}
                    </span>
                    {d.length ? <DiffView diff={d} /> : <span className="muted small">same cards</span>}
                    {(childRecords.get(c.id)?.events ?? 0) > 0 && <span className="chip">{formatRecord(childRecords.get(c.id)!)}</span>}
                  </li>
                );
              })}
            </ul>
          )}
          <h2>Compare</h2>
          <CompareWith deck={deck} lines={lines} decks={decks.filter((d) => d.game === deck.game && d.id !== deck.id)} />
        </div>
      )}
    </>
  );
}
