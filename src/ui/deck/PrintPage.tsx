import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { getPref, setPref } from '../../app/prefs';
import { repo } from '../../app/repo';
import { unlimitedFor } from '../../app/supply';
import { useLoad } from '../../app/useLoad';
import { slotStatuses } from '../../domain/status';
import { OPTIONS, type Card, type DeckLine } from '../../domain/types';
import { Empty, ErrorBox, Loading } from '../components';
import { useTitle } from '../useTitle';

async function load(id: string) {
  const deck = await repo.getDeck(id);
  if (!deck) return null;
  const [changes, copies] = await Promise.all([repo.listChanges(id), repo.listCopies(deck.game)]);
  const lines = (changes.at(-1)?.lines ?? []).filter((l) => l.section !== OPTIONS);
  const cards = new Map((await repo.getCards(deck.game, lines.map((l) => l.cardId))).map((c) => [c.id, c]));
  return { deck, lines, cards, statuses: slotStatuses(deck.id, lines, copies, undefined, unlimitedFor(deck.game)) };
}

/** Printable pages for a deck: playtest proxies, or a tournament deck registration sheet. */
export function PrintPage() {
  const { id = '', kind = '' } = useParams();
  const { data, error } = useLoad(() => load(id), [id]);
  useTitle(data ? `${kind === 'sheet' ? 'Deck registration' : 'Proxies'}: ${data.deck.name}` : undefined);
  if (error) return <ErrorBox error={error} />;
  if (data === undefined) return <Loading />;
  if (data === null) return <Empty>This deck does not exist. <Link to="/">Back to your decks</Link></Empty>;
  return (
    <>
      <nav className="crumbs small no-print"><Link to="/">Decks</Link> / <Link to={`/decks/${id}`}>{data.deck.name}</Link> / <span>{kind === 'sheet' ? 'Deck registration sheet' : 'Proxies'}</span></nav>
      {kind === 'sheet' ? <Sheet {...data} /> : <Proxies {...data} />}
    </>
  );
}

const big = (url: string) => url.replace('/low.webp', '/high.webp').replace('/small/', '/normal/');

function Proxies({ lines, cards, statuses }: NonNullable<Awaited<ReturnType<typeof load>>>) {
  const [all, setAll] = useState(false);
  const prints = lines.flatMap((l) => {
    const n = all ? l.qty : statuses.get(l.cardId)?.missing ?? 0;
    const art = l.imageUrl ?? cards.get(l.cardId)?.imageUrl;
    return Array.from({ length: Math.min(n, l.qty) }, (_, i) => ({ key: `${l.section}|${l.cardId}|${i}`, name: l.name, art }));
  });
  return (
    <>
      <div className="no-print stack" style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Proxies</h1>
        <p className="muted small" style={{ margin: 0 }}>Card-size images (63 × 88 mm) for playtesting, not for sanctioned events. Print at 100% scale, then cut along the edges.</p>
        <div className="row">
          <label className="row small"><input type="radio" checked={!all} onChange={() => setAll(false)} /> Missing cards only</label>
          <label className="row small"><input type="radio" checked={all} onChange={() => setAll(true)} /> Whole deck</label>
          <button type="button" className="primary" onClick={() => window.print()} disabled={prints.length === 0}>Print {prints.length}</button>
        </div>
        {prints.length === 0 && <p className="muted">Nothing is missing: you own every card in this deck.</p>}
      </div>
      <div className="proxy-sheet">
        {prints.map((p) => (
          <div key={p.key} className="proxy">
            {p.art ? <img src={big(p.art)} alt={p.name} /> : <span>{p.name}</span>}
          </div>
        ))}
      </div>
    </>
  );
}

const PLAYER_KEY = 'player-info';
interface Player { name: string; id: string; birth: string; division: string }

function Sheet({ deck, lines, cards }: NonNullable<Awaited<ReturnType<typeof load>>>) {
  const [player, setPlayer] = useState<Player>(() => ({ name: '', id: '', birth: '', division: 'Masters', ...getPref<Partial<Player>>(PLAYER_KEY, {}) }));
  const edit = (patch: Partial<Player>) => {
    const next = { ...player, ...patch };
    setPlayer(next);
    void setPref(PLAYER_KEY, next);
  };
  const category = (l: DeckLine, c?: Card) => (c?.category ?? l.category ?? 'Trainer');
  const groups = ['Pokémon', 'Trainer', 'Energy'].map((cat) => ({
    cat,
    lines: lines.filter((l) => category(l, cards.get(l.cardId)) === cat).sort((a, b) => a.name.localeCompare(b.name)),
  }));
  const total = lines.reduce((n, l) => n + l.qty, 0);
  return (
    <>
      <div className="no-print stack" style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Deck registration sheet</h1>
        <p className="muted small" style={{ margin: 0 }}>Fill in your details (saved for next time), then print or save as PDF. Check it against your event's official form; tech options are left out.</p>
        <div className="row">
          <label className="field">Player name<input value={player.name} onChange={(e) => edit({ name: e.target.value })} autoComplete="name" /></label>
          <label className="field">Player ID<input value={player.id} onChange={(e) => edit({ id: e.target.value })} inputMode="numeric" /></label>
          <label className="field">Date of birth<input type="date" value={player.birth} onChange={(e) => edit({ birth: e.target.value })} /></label>
          <label className="field">Age division
            <select value={player.division} onChange={(e) => edit({ division: e.target.value })}>
              {['Junior', 'Senior', 'Masters'].map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
        </div>
        <div className="row"><button type="button" className="primary" onClick={() => window.print()}>Print</button></div>
      </div>
      <div className="reg-sheet">
        <h2>Deck registration sheet</h2>
        <dl className="reg-fields">
          <div><dt>Player name</dt><dd>{player.name}</dd></div>
          <div><dt>Player ID</dt><dd>{player.id}</dd></div>
          <div><dt>Date of birth</dt><dd>{player.birth}</dd></div>
          <div><dt>Age division</dt><dd>{player.division}</dd></div>
          <div><dt>Deck</dt><dd>{deck.name}{deck.format ? ` (${deck.format})` : ''}</dd></div>
          <div><dt>Total cards</dt><dd>{total}</dd></div>
        </dl>
        {groups.map((g) => (
          <table key={g.cat} className="reg-table">
            <thead>
              <tr><th className="num">Qty</th><th>{g.cat}</th><th>Set</th><th>No.</th></tr>
            </thead>
            <tbody>
              {g.lines.map((l) => (
                <tr key={l.cardId}><td className="num">{l.qty}</td><td>{l.name}</td><td>{l.set ?? ''}</td><td>{l.number ?? ''}</td></tr>
              ))}
              <tr className="reg-total"><td className="num">{g.lines.reduce((n, l) => n + l.qty, 0)}</td><td colSpan={3}>Total {g.cat}</td></tr>
            </tbody>
          </table>
        ))}
      </div>
    </>
  );
}
