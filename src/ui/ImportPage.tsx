import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { createDeck } from '../app/actions';
import { toDeckLines } from '../app/importing';
import { stamp } from '../app/cardData';
import { repo } from '../app/repo';
import { cardTotals, countCards, normalizeLines } from '../domain/decklist';
import { formatUsd } from '../domain/insights';
import { games } from '../games';
import type { ResolvedLine } from '../games/types';
import { ErrorBox, GameField } from './components';
import { useGameChoice } from './useGameChoice';
import { plural } from './text';
import { ListReader } from './ListReader';
import { CardPreviewPanel } from './CardSearchBox';
import { useTitle } from './useTitle';

type Ownership = 'all' | 'none' | 'pick';

export function ImportPage() {
  const navigate = useNavigate();
  const [gameId, setGameId] = useGameChoice();
  useTitle("Import a deck");
  const adapter = games().find((g) => g.id === gameId)!;
  const [name, setName] = useState('');
  const [format, setFormat] = useState(adapter.formats[0] ?? '');
  const [resolved, setResolved] = useState<ResolvedLine[]>([]);
  const [unresolved, setUnresolved] = useState(0);
  const [ownership, setOwnership] = useState<Ownership>('none');
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string | false>(false);
  const [commonPrint, setCommonPrint] = useState(false);

  const lines = useMemo(() => normalizeLines(toDeckLines(resolved)), [resolved]);
  /** Name idea: the commander or Leader, else the priciest card that is not a basic resource. */
  const suggested = useMemo(() => {
    const commander = lines.find((l) => l.section === 'commander' || l.section === 'leader');
    if (commander) return commander.name;
    const key = resolved
      .map((r) => r.card)
      .filter((c) => c && c.category !== 'Energy' && c.category !== 'Land')
      .sort((a, b) => (b!.price ?? 0) - (a!.price ?? 0))[0];
    return key?.name ?? '';
  }, [lines, resolved]);
  const totals = useMemo(() => cardTotals(lines), [lines]);

  const [carryText, setCarryText] = useState('');
  const changeGame = (id: string, text = '') => {
    setCarryText(text);
    setGameId(id);
    setFormat(games().find((g) => g.id === id)?.formats[0] ?? '');
    setResolved([]);
  };

  const create = async () => {
    setBusy('Creating…');
    setError(undefined);
    try {
      let deckLines = lines;
      if (commonPrint && adapter.commonPrinting) {
        setBusy('Finding common printings…');
        const cards = [...new Map(resolved.flatMap((r) => (r.card ? [[r.card.id, r.card] as const] : []))).values()];
        const common = await adapter.commonPrinting(cards);
        if (common.size) await repo.putCards(stamp([...common.values()]));
        // The card id stays the same, so copies of any print still count; only the shown printing changes.
        deckLines = lines.map((l) => {
          const c = common.get(l.cardId);
          return c ? { ...l, set: c.set, number: c.set ? c.number : undefined } : l;
        });
      }
      const owned = new Map<string, number>();
      for (const [cardId, qty] of totals) {
        owned.set(cardId, ownership === 'all' ? qty : ownership === 'none' ? 0 : Math.min(qty, picked[cardId] ?? qty));
      }
      const deck = await createDeck(repo, { game: gameId, name: name.trim() || suggested, format, lines: deckLines, owned });
      navigate(`/decks/${deck.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const startEmpty = async () => {
    setBusy('Creating…');
    try {
      const deck = await createDeck(repo, { game: gameId, name: name.trim() || `New ${adapter.name} deck`, format, lines: [] });
      navigate(`/decks/${deck.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Import a deck</h1>
      <div className="panel stack">
        <div className="row">
          <GameField value={gameId} onChange={(id) => changeGame(id)} />
          <label className="field" style={{ flex: 1, minWidth: '12rem' }}>
            Deck name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested || 'For example: Charizard ex'} />
          </label>
          <label className="field">
            Format
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              {adapter.formats.map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          No list? <button type="button" className="link-button accent-link" onClick={startEmpty} disabled={!!busy}>Start an empty deck</button> and add cards by search.
        </p>
        <div className="with-preview">
          <ListReader key={gameId} adapter={adapter} initialText={carryText} onSwitchGame={changeGame} onChange={(r, u) => (setResolved(r), setUnresolved(u))} />
          <CardPreviewPanel title="Deck preview" items={resolved.map((r) => ({ key: `${r.line.lineNo}|${r.line.raw}`, name: r.card?.name ?? r.line.name, qty: r.line.qty, card: r.card }))} />
        </div>
      </div>

      {lines.length > 0 && (
        <div className="panel stack">
          <details>
            <summary className="small">Check what each line matched ({plural(resolved.filter((r) => r.card).length, 'line')})</summary>
            <table className="list small" style={{ marginTop: '0.5rem' }}>
              <thead><tr><th>You wrote</th><th>Matched card</th><th className="num">Price</th></tr></thead>
              <tbody>
                {resolved.filter((r) => r.card).map((r) => (
                  <tr key={r.line.lineNo}>
                    <td className="muted">{r.line.raw}</td>
                    <td>
                      <span className="card-name">
                        {r.card!.name} <span className="muted">{[r.card!.category, r.line.set ?? r.card!.set, r.line.set ? r.line.number : r.card!.number].filter(Boolean).join(' · ')}</span>
                        {r.card!.imageUrl && <img className="preview" src={r.card!.imageUrl} alt="" loading="lazy" />}
                      </span>
                    </td>
                    <td className="num muted">{r.card!.price !== undefined ? formatUsd(r.card!.price) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <div className="spread">
            <h2>Which cards do you own?</h2>
            <span className="muted small">{countCards(lines, 'main')} cards in the main deck</span>
          </div>
          <div className="row" role="radiogroup" aria-label="Ownership">
            {([
              ['none', 'Check against my collection'],
              ['all', 'I own all of these'],
              ['pick', 'Let me pick'],
            ] as const).map(([v, label]) => (
              <label key={v} className="row">
                <input type="radio" name="own" checked={ownership === v} onChange={() => setOwnership(v)} /> {label}
              </label>
            ))}
          </div>
          <p className="muted small">
            {ownership === 'all' && 'All these copies are added to your collection, inside this deck.'}
            {ownership === 'none' && 'No copies are added. The deck uses the copies already in your binder and other decks, and flags the rest as missing.'}
            {ownership === 'pick' && 'Set how many copies of each card you own. They are added inside this deck; the rest are flagged as missing.'}
          </p>
          {ownership === 'pick' && (
            <table className="list">
              <thead><tr><th>Card</th><th className="num">In list</th><th className="num">I own</th></tr></thead>
              <tbody>
                {[...totals].map(([cardId, qty]) => (
                  <tr key={cardId}>
                    <td>{lines.find((l) => l.cardId === cardId)?.name}</td>
                    <td className="num">{qty}</td>
                    <td className="num">
                      <input
                        className="qty"
                        type="number"
                        min={0}
                        max={qty}
                        value={picked[cardId] ?? qty}
                        onChange={(e) => setPicked({ ...picked, [cardId]: Math.max(0, Number(e.target.value)) })}
                        aria-label={`Copies of ${lines.find((l) => l.cardId === cardId)?.name} owned`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {adapter.commonPrinting && (
            <div className="stack" style={{ gap: '0.25rem' }}>
              <label className="row">
                <input type="checkbox" checked={commonPrint} onChange={(e) => setCommonPrint(e.target.checked)} /> Use the most common printing of each card
              </label>
              <p className="muted small" style={{ margin: 0 }}>
                Ignores the set and number in the list and picks the lowest-rarity print, so prices are for the cheap version. Copies you own count whatever their print.
              </p>
            </div>
          )}
          <ErrorBox error={error} />
          <div className="row">
            <button type="button" className="primary" onClick={create} disabled={!!busy || unresolved > 0}>
              {busy || 'Create deck'}
            </button>
            {unresolved > 0 && <span className="muted small">Fix or remove the {plural(unresolved, 'problem line')} first.</span>}
          </div>
        </div>
      )}
    </>
  );
}
