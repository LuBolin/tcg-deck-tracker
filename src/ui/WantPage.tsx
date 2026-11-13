import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { latestLines } from '../app/actions';
import { APP_NAME, repo } from '../app/repo';
import { unlimitedFor } from '../app/supply';
import { useLoad } from '../app/useLoad';
import { ownedTotal } from '../domain/collection';
import { slotStatuses } from '../domain/status';
import { BINDER } from '../domain/types';
import type { Card, CopyRow, Deck, DeckLine } from '../domain/types';
import { formatUsd } from '../domain/insights';
import { formatWantList, matchWant, parsePrice, parseWantList, tradeListKind, wantListGame, type WantItem, type WantMatch } from '../domain/wantlist';
import { games } from '../games';
import type { GameAdapter } from '../games/types';
import { CopyButton, Empty, ErrorBox, GameField, Loading } from './components';
import { useGameChoice } from './useGameChoice';
import { useTitle } from './useTitle';

export function WantPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'make' | 'sell' | 'check'>('make');
  useTitle('Want-lists');
  const tabs = [['make', 'Make a want-list'], ['sell', 'Sell spares'], ['check', 'Check a list']] as const;
  return (
    <>
      <h1>Want-lists</h1>
      <p className="muted">
        Plain-text messages for any community chat. A want-list names the cards you are missing and your offers; a selling list
        names your spare cards. Paste either one into the Check tab to see what matches your cards and decks.
      </p>
      <div className="tabs" role="tablist">
        {tabs.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>
      {tab === 'make' && <MakeWantList initialDeck={params.get('deck') ?? undefined} />}
      {tab === 'sell' && <SellSpares />}
      {tab === 'check' && <CheckWantList />}
    </>
  );
}

async function loadDecks() {
  const decks = await repo.listDecks();
  const lines = new Map<string, DeckLine[]>();
  for (const d of decks) lines.set(d.id, await latestLines(repo, d.id));
  const copies = new Map<string, CopyRow[]>();
  const cards = new Map<string, Card>();
  for (const g of new Set(decks.map((d) => d.game))) {
    copies.set(g, await repo.listCopies(g));
    const ids = decks.filter((d) => d.game === g).flatMap((d) => lines.get(d.id)!.map((l) => l.cardId));
    for (const c of await repo.getCards(g, [...new Set(ids)])) cards.set(`${g}|${c.id}`, c);
  }
  return { decks, lines, copies, cards };
}

interface Row extends WantItem { cardId: string }

/**
 * Cards to buy for the selected decks.
 * - Normal: per card, the most any one deck is missing (copies in other decks count as owned).
 * - Build together: enough copies to have every selected deck built at the same time.
 */
function wantedRows(decks: Deck[], lines: Map<string, DeckLine[]>, copies: CopyRow[], together: boolean): Row[] {
  const needed = new Map<string, { line: DeckLine; sum: number; maxMissing: number }>();
  for (const d of decks) {
    const ls = lines.get(d.id) ?? [];
    for (const st of slotStatuses(d.id, ls, copies, undefined, unlimitedFor(d.game)).values()) {
      if (st.unlimited) continue; // basic Energy: nobody needs to buy it
      const e = needed.get(st.cardId) ?? { line: ls.find((l) => l.cardId === st.cardId)!, sum: 0, maxMissing: 0 };
      e.sum += st.needed;
      e.maxMissing = Math.max(e.maxMissing, st.missing);
      needed.set(st.cardId, e);
    }
  }
  return [...needed]
    .map(([cardId, e]) => ({
      cardId,
      qty: together ? Math.max(0, e.sum - ownedTotal(copies, cardId)) : e.maxMissing,
      name: e.line.name,
      set: e.line.set,
      number: e.line.number,
    }))
    .filter((r) => r.qty > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function MakeWantList({ initialDeck }: { initialDeck?: string }) {
  const { data, error } = useLoad(loadDecks, []);
  const [gameId, setGameId] = useState<string>();
  const [selected, setSelected] = useState<string[]>(initialDeck ? [initialDeck] : []);
  const [together, setTogether] = useState(false);
  const [edits, setEdits] = useState<Record<string, { qty?: number; price?: string }>>({});
  const [contact, setContact] = useState('');

  const game = gameId ?? data?.decks.find((d) => d.id === initialDeck)?.game ?? games()[0]?.id;
  const adapter = games().find((g) => g.id === game);
  const rows = useMemo(() => {
    if (!data || !game) return [];
    const chosen = data.decks.filter((d) => d.game === game && selected.includes(d.id));
    return wantedRows(chosen, data.lines, data.copies.get(game) ?? [], together).map((r) => ({
      ...r,
      qty: edits[r.cardId]?.qty ?? r.qty,
      price: edits[r.cardId]?.price ?? '',
      market: data.cards.get(`${game}|${r.cardId}`)?.price,
    }));
  }, [data, game, selected, together, edits]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  if (!adapter) return <Empty>No games are set up.</Empty>;

  const gameDecks = data.decks.filter((d) => d.game === game);
  const items = rows.filter((r) => r.qty > 0);
  const offerTotal = items.reduce((n, r) => n + (parsePrice(r.price) ?? 0) * r.qty, 0);
  const marketTotal = items.reduce((n, r) => n + (r.market ?? 0) * r.qty, 0);
  const useMarket = () =>
    setEdits(Object.fromEntries(rows.map((r) => [r.cardId, { ...edits[r.cardId], price: r.market !== undefined ? formatUsd(r.market) : edits[r.cardId]?.price }])));
  const text = formatWantList(items, (i) => adapter.formatLine(i), { contact, appName: APP_NAME, gameName: adapter.name });

  return (
    <div className="grid2">
      <div className="panel stack">
        <GameField value={game} onChange={(id) => (setGameId(id), setSelected([]))} />
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend className="muted small">Decks to buy for</legend>
          {gameDecks.length === 0 && <p className="muted small">No decks for this game yet.</p>}
          {gameDecks.map((d) => (
            <label key={d.id} className="row">
              <input type="checkbox" checked={selected.includes(d.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, d.id] : selected.filter((x) => x !== d.id))} />
              {d.name}
            </label>
          ))}
        </fieldset>
        <label className="row small">
          <input type="checkbox" checked={together} onChange={(e) => setTogether(e.target.checked)} />
          Build the selected decks at the same time (also buy cards that are now in other decks)
        </label>
        {items.length === 0 && rows.length === 0 ? (
          <p className="muted small">{selected.length ? 'Nothing to buy: these decks are complete.' : 'Pick at least one deck.'}</p>
        ) : (
          <table className="list">
            <thead><tr><th>Card</th><th className="num">Qty</th><th className="num">Market</th><th>Offer each</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cardId}>
                  <td>{r.name}</td>
                  <td className="num">
                    <input className="qty" type="number" min={0} value={r.qty} aria-label={`Quantity of ${r.name}`}
                      onChange={(e) => setEdits({ ...edits, [r.cardId]: { ...edits[r.cardId], qty: Math.max(0, Number(e.target.value)) } })} />
                  </td>
                  <td className="num muted small">{r.market !== undefined ? formatUsd(r.market) : '—'}</td>
                  <td>
                    <input value={r.price} placeholder={r.market !== undefined ? formatUsd(r.market) : '$0.00'} style={{ width: '6rem' }} aria-label={`Offer price for ${r.name}`}
                      onChange={(e) => setEdits({ ...edits, [r.cardId]: { ...edits[r.cardId], price: e.target.value } })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {items.length > 0 && (
          <div className="spread small">
            <span className="muted">
              {marketTotal > 0 && <>Market about <strong className="text">{formatUsd(marketTotal)}</strong>. </>}
              {offerTotal > 0 && <>Your offers total <strong className="text">{formatUsd(offerTotal)}</strong>.</>}
            </span>
            {rows.some((r) => r.market !== undefined) && <button type="button" className="small" onClick={useMarket}>Use market prices</button>}
          </div>
        )}
        <label className="field">Contact (optional)<input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="@your-handle · local pickup or ship" /></label>
      </div>
      <div className="panel stack">
        <div className="spread"><h3>Message</h3><CopyButton text={text} label="Copy message" /></div>
        <textarea readOnly value={text} aria-label="Want-list message" style={{ minHeight: '16rem' }} />
        <p className="muted small">Post it in Discord, Telegram or any chat. The app never takes payments: buyers and sellers deal directly.</p>
      </div>
    </div>
  );
}

function CheckWantList() {
  const [gameId, setGameId] = useGameChoice();
  const adapter = games().find((g) => g.id === gameId)!;
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ item: WantItem; found: boolean; match: WantMatch; needs: { deckId: string; missing: number }[] }[]>();
  const kind = tradeListKind(text);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const check = async (a: GameAdapter) => {
    setBusy(true);
    setError(undefined);
    try {
      const { items } = parseWantList(text, a.listFormat);
      const resolved = items.length ? await a.resolve(items.map((i) => i.line)) : [];
      const [copies, allDecks] = await Promise.all([repo.listCopies(a.id), repo.listDecks()]);
      setDecks(allDecks);
      // For selling lists: which of my decks are missing each card.
      const missingByCard = new Map<string, { deckId: string; missing: number }[]>();
      for (const d of allDecks.filter((x) => x.game === a.id)) {
        for (const st of slotStatuses(d.id, await latestLines(repo, d.id), copies).values()) {
          if (st.missing > 0) missingByCard.set(st.cardId, [...(missingByCard.get(st.cardId) ?? []), { deckId: d.id, missing: st.missing }]);
        }
      }
      setResult(items.map((item, i) => {
        const card = resolved[i]?.card;
        return { item, found: !!card, match: matchWant(card?.id, item.qty, copies), needs: (card && missingByCard.get(card.id)) || [] };
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deckName = (id: string) => decks.find((d) => d.id === id)?.name ?? 'a deck';
  const canSell = result?.filter((r) => r.match.spare > 0).length ?? 0;
  const useful = result?.filter((r) => r.needs.length > 0).length ?? 0;

  return (
    <div className="stack">
      <div className="panel stack">
        <GameField value={gameId} onChange={(id) => (setGameId(id), setResult(undefined))} />
        <label className="field">
          Paste a want-list or selling list
          <textarea value={text} onChange={(e) => {
            setText(e.target.value);
            const named = wantListGame(e.target.value)?.toLowerCase();
            const g = named && games().find((x) => x.name.toLowerCase() === named);
            if (g && g.id !== gameId) { setGameId(g.id); setResult(undefined); }
          }} placeholder={`Want to buy\n2 ${adapter.sampleList.split('\n')[0].replace(/^\d+\s+/, '')} @ $3.50`} spellCheck={false} />
        </label>
        <div className="row">
          <button type="button" className="primary" disabled={busy || !text.trim()} onClick={() => check(adapter)}>{busy ? 'Checking…' : 'Check my cards'}</button>
        </div>
        <ErrorBox error={error} />
      </div>
      {result && (
        <div className="panel">
          <div className="spread">
            <h3>{kind === 'sell' ? 'Cards your decks need' : 'Cards you can sell'}</h3>
            <span className="muted small">
              {kind === 'sell' ? `${useful} of ${result.length} cards are missing from your decks` : `You can sell ${canSell} of ${result.length} cards from your binder`}
            </span>
          </div>
          {result.length === 0 ? <p className="muted">No card lines found in that message.</p> : (
            <table className="list">
              <thead><tr><th>Card</th><th className="num">{kind === 'sell' ? 'For sale' : 'Wanted'}</th><th>{kind === 'sell' ? 'Price' : 'Offer'}</th><th>{kind === 'sell' ? 'Your decks need' : 'You have'}</th></tr></thead>
              <tbody>
                {result.map((r, i) => (
                  <tr key={i}>
                    <td>{r.item.name} <span className="muted small">{[r.item.set, r.item.number].filter(Boolean).join(' ')}</span></td>
                    <td className="num">{r.item.qty}</td>
                    <td>{r.item.price ?? <span className="muted">—</span>}</td>
                    <td>
                      <div className="row">
                        {!r.found && <span className="chip bad">card not recognised</span>}
                        {kind === 'sell' && r.needs.map((n) => <span key={n.deckId} className="chip ok">{deckName(n.deckId)} is missing {n.missing}</span>)}
                        {kind === 'sell' && r.found && r.needs.length === 0 && <span className="muted small">not needed</span>}
                        {kind === 'buy' && r.match.spare > 0 && <span className="chip ok">{r.match.spare} spare in binder</span>}
                        {kind === 'buy' && r.match.inDecks.map((d) => <span key={d.location} className="chip warn">{d.qty} in {deckName(d.location)}</span>)}
                        {kind === 'buy' && r.found && r.match.spare === 0 && r.match.inDecks.length === 0 && <span className="muted small">none</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/** A selling list from binder copies (spares no deck uses), priced at market by default. */
function SellSpares() {
  const [gameId, setGameId] = useGameChoice();
  const adapter = games().find((g) => g.id === gameId)!;
  const { data, error } = useLoad(async () => {
    const copies = (await repo.listCopies(gameId)).filter((c) => c.location === BINDER);
    const cards = new Map((await repo.getCards(gameId, copies.map((c) => c.cardId))).map((c) => [c.id, c]));
    return { copies, cards };
  }, [gameId]);
  const [edits, setEdits] = useState<Record<string, { qty?: number; price?: string }>>({});
  const [contact, setContact] = useState('');

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const rows = data.copies
    .map((c) => {
      const card = data.cards.get(c.cardId);
      return {
        cardId: c.cardId,
        have: c.qty,
        name: card?.name ?? c.cardId,
        set: card?.set,
        number: card?.number,
        qty: edits[c.cardId]?.qty ?? c.qty,
        price: edits[c.cardId]?.price ?? (card?.price !== undefined ? formatUsd(card.price) : ''),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const items = rows.filter((r) => r.qty > 0);
  const text = formatWantList(items, (i) => adapter.formatLine(i), { contact, appName: APP_NAME, gameName: adapter.name, kind: 'sell' });

  return (
    <div className="grid2">
      <div className="panel stack">
        <GameField value={gameId} onChange={(id) => (setGameId(id), setEdits({}))} />
        {rows.length === 0 ? (
          <p className="muted small">No spare {adapter.name} cards: the binder is empty. Copies in decks are not offered.</p>
        ) : (
          <table className="list">
            <thead><tr><th>Card</th><th className="num">Sell</th><th>Price each</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cardId}>
                  <td>{r.name} <span className="muted small">of {r.have}</span></td>
                  <td className="num">
                    <input className="qty" type="number" min={0} max={r.have} value={r.qty} aria-label={`Copies of ${r.name} to sell`}
                      onChange={(e) => setEdits({ ...edits, [r.cardId]: { ...edits[r.cardId], qty: Math.min(r.have, Math.max(0, Number(e.target.value))) } })} />
                  </td>
                  <td>
                    <input value={r.price} placeholder="$0.00" style={{ width: '6rem' }} aria-label={`Price for ${r.name}`}
                      onChange={(e) => setEdits({ ...edits, [r.cardId]: { ...edits[r.cardId], price: e.target.value } })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <label className="field">Contact (optional)<input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="@your-handle · local pickup or ship" /></label>
      </div>
      <div className="panel stack">
        <div className="spread"><h3>Message</h3><CopyButton text={text} label="Copy message" /></div>
        <textarea readOnly value={text} aria-label="Selling list message" style={{ minHeight: '16rem' }} />
        <p className="muted small">Prices start at the market estimate; change any of them. Only binder copies are listed, so cards in your decks stay put.</p>
      </div>
    </div>
  );
}
