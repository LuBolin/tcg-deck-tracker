import { useState } from 'react';
import * as actions from '../../app/actions';
import { repo } from '../../app/repo';
import { diffLists } from '../../domain/decklist';
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

export function LogResult({ onSave, onCancel }: { onSave: (result: string, note: string) => void; onCancel: () => void }) {
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  return (
    <form className="panel row" onSubmit={(e) => { e.preventDefault(); if (result.trim()) onSave(result, note); }}>
      <label className="field" style={{ minWidth: '9rem' }}>Result<input value={result} onChange={(e) => setResult(e.target.value)} placeholder="3-1 vs Gardevoir" autoFocus /></label>
      <label className="field" style={{ flex: 1, minWidth: '12rem' }}>Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What worked, what did not" /></label>
      <button type="submit" className="primary" disabled={!result.trim()}>Save result</button>
      <button type="button" onClick={onCancel}>Cancel</button>
      <p className="muted small" style={{ width: '100%', margin: 0 }}>Write wins-losses (for example 3-1) and the record adds up per deck and per variant.</p>
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
