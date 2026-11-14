import { useState } from 'react';
import * as actions from '../../app/actions';
import { repo } from '../../app/repo';
import { diffLists } from '../../domain/decklist';
import type { Outcome } from '../../domain/matches';
import type { DeckLine } from '../../domain/types';
import { LabelChip } from '../components';

/** Small deck-page pieces: compare with another deck, labels, log a result, make a variant. */

/** Card differences between this deck and any other deck of the same game. */
export function CompareWith({ deck, lines, decks }: { deck: { name: string }; lines: DeckLine[]; decks: { id: string; name: string }[] }) {
  const [otherId, setOtherId] = useState('');
  const [other, setOther] = useState<DeckLine[]>();
  if (decks.length === 0) return null;
  const pick = async (id: string) => {
    setOtherId(id);
    setOther(id ? await actions.latestLines(repo, id) : undefined);
  };
  const diff = other ? diffLists(lines, other) : [];
  const name = decks.find((d) => d.id === otherId)?.name;
  return (
    <div className="stack" style={{ gap: '0.4rem' }}>
      <label className="row small">
        Compare with
        <select value={otherId} onChange={(e) => pick(e.target.value)}>
          <option value="">Choose a deck…</option>
          {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      {other && (
        diff.length === 0 ? <span className="muted small">{deck.name} and {name} have the same cards.</span> : (
          <table className="list compare">
            <thead><tr><th>Card</th><th className="num">{deck.name}</th><th className="num">{name}</th></tr></thead>
            <tbody>
              {diff.map((d) => (
                <tr key={`${d.section}|${d.cardId}`}>
                  <td>{d.name}{d.section !== 'main' && <span className="muted small"> ({d.section})</span>}</td>
                  <td className="num">{d.before || '—'}</td>
                  <td className={`num ${d.delta > 0 ? 'diff-add' : 'diff-del'}`}>{d.after || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}

/** Add a label, ignoring case duplicates; labels are short, like GitHub labels. */
const addLabel = (labels: string[], raw: string) => {
  const t = raw.trim().slice(0, 30);
  return !t || labels.some((l) => l.toLowerCase() === t.toLowerCase()) ? labels : [...labels, t];
};

/** Deck labels ("vs aggro", "budget"): chips with ×, plus an input that suggests labels used on other decks. */
export function Labels({ value = [], known, onSave }: { value?: string[]; known: string[]; onSave: (labels: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const suggestions = known.filter((k) => !value.some((v) => v.toLowerCase() === k.toLowerCase()));
  return (
    <div className="row labels">
      {value.map((l) => <LabelChip key={l} name={l} onRemove={() => onSave(value.filter((x) => x !== l))} />)}
      {adding ? (
        <form className="row" onSubmit={(e) => { e.preventDefault(); const next = addLabel(value, text); if (next !== value) onSave(next); setText(''); setAdding(false); }}>
          <input className="label-input" list="known-labels" value={text} onChange={(e) => setText(e.target.value)} placeholder="vs aggro, budget, locals…" aria-label="New label" autoFocus
            onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
          <datalist id="known-labels">{suggestions.map((k) => <option key={k} value={k} />)}</datalist>
          <button type="submit" className="small primary">Add</button>
          <button type="button" className="small" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      ) : (
        <button type="button" className="link-button accent-link small" onClick={() => setAdding(true)}>{value.length ? '+ Label' : '+ Add a label (when to play it)'}</button>
      )}
    </div>
  );
}

export interface LoggedMatch { outcome: Outcome; opponent: string; turn?: 'first' | 'second'; event: string; note: string }

/** One match: won, lost or tied, against which deck, going first or second, at which event. */
export function LogResult({ known, onSave, onCancel }: { known: { opponents: string[]; events: string[] }; onSave: (m: LoggedMatch) => void; onCancel: () => void }) {
  const [outcome, setOutcome] = useState<Outcome>();
  const [opponent, setOpponent] = useState('');
  const [turn, setTurn] = useState<'first' | 'second'>();
  const [event, setEvent] = useState(known.events[0] ?? '');
  const [note, setNote] = useState('');
  const toggle = <T,>(value: T, current: T | undefined, set: (v: T | undefined) => void, label: string) => (
    <button key={label} type="button" aria-pressed={current === value} className={current === value ? 'primary' : ''} onClick={() => set(current === value ? undefined : value)}>{label}</button>
  );
  return (
    <form className="panel stack log-result" onSubmit={(e) => { e.preventDefault(); if (outcome) onSave({ outcome, opponent, turn, event, note }); }}>
      <div className="row" role="group" aria-label="Result">
        {toggle<Outcome>('win', outcome, setOutcome, 'Won')}
        {toggle<Outcome>('loss', outcome, setOutcome, 'Lost')}
        {toggle<Outcome>('tie', outcome, setOutcome, 'Tied')}
        <span className="muted small">went</span>
        {toggle<'first' | 'second'>('first', turn, setTurn, 'First')}
        {toggle<'first' | 'second'>('second', turn, setTurn, 'Second')}
      </div>
      <div className="row">
        <label className="field" style={{ flex: 1, minWidth: '10rem' }}>Opponent's deck
          <input value={opponent} onChange={(e) => setOpponent(e.target.value)} list="known-opponents" placeholder="Gardevoir ex" />
        </label>
        <label className="field" style={{ flex: 1, minWidth: '10rem' }}>Event (optional)
          <input value={event} onChange={(e) => setEvent(e.target.value)} list="known-events" placeholder="Friday locals" />
        </label>
      </div>
      <datalist id="known-opponents">{known.opponents.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="known-events">{known.events.map((o) => <option key={o} value={o} />)}</datalist>
      <label className="field">Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What worked, what did not" /></label>
      <div className="row">
        <button type="submit" className="primary" disabled={!outcome}>Save result</button>
        <button type="button" onClick={onCancel}>Cancel</button>
        <span className="muted small">One entry per match. Win rates by opponent and by version show on the Stats tab.</span>
      </div>
    </form>
  );
}

export function MakeVariant({ onMake, defaultName, known }: { onMake: (name: string, labels: string[]) => void; defaultName: string; known: string[] }) {
  const [name, setName] = useState(defaultName);
  const [labels, setLabels] = useState('');
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); onMake(name, labels.split(',').reduce(addLabel, [] as string[])); }}>
      <label className="field" style={{ flex: 1, minWidth: '12rem' }}>Variant name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field" style={{ flex: 2, minWidth: '14rem' }}>Labels (comma-separated)<input value={labels} onChange={(e) => setLabels(e.target.value)} list="variant-labels" placeholder="vs aggro, budget" /></label>
      <datalist id="variant-labels">{known.map((k) => <option key={k} value={k} />)}</datalist>
      <button type="submit" className="primary" style={{ alignSelf: 'flex-end' }}>Make variant</button>
    </form>
  );
}
