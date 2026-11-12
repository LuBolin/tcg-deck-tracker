import { useState } from 'react';
import * as actions from '../../app/actions';
import { repo } from '../../app/repo';
import { diffLists } from '../../domain/decklist';
import type { DeckLine } from '../../domain/types';

/** Small deck-page pieces: compare with another deck, "when to play", log a result, make a variant. */

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

/** "When to play this deck": the reason a variant exists, edited in place. */
export function Purpose({ value, onSave }: { value?: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? '');
  if (!editing) {
    return (
      <p className="purpose small">
        {value ? <><span className="muted">When to play:</span> {value} </> : null}
        <button type="button" className="link-button accent-link" onClick={() => { setText(value ?? ''); setEditing(true); }}>
          {value ? 'Edit' : '+ Add when to play this deck'}
        </button>
      </p>
    );
  }
  return (
    <form className="row purpose" onSubmit={(e) => { e.preventDefault(); onSave(text.trim()); setEditing(false); }}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: against aggro-heavy locals, or on a budget" aria-label="When to play this deck" style={{ flex: 1, minWidth: '14rem' }} autoFocus />
      <button type="submit" className="small primary">Save</button>
      <button type="button" className="small" onClick={() => setEditing(false)}>Cancel</button>
    </form>
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

export function MakeVariant({ onMake, defaultName }: { onMake: (name: string, purpose: string) => void; defaultName: string }) {
  const [name, setName] = useState(defaultName);
  const [purpose, setPurpose] = useState('');
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); onMake(name, purpose); }}>
      <label className="field" style={{ flex: 1, minWidth: '12rem' }}>Variant name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field" style={{ flex: 2, minWidth: '14rem' }}>When to play it<input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="For example: against aggro, or on a budget" /></label>
      <button type="submit" className="primary" style={{ alignSelf: 'flex-end' }}>Make variant</button>
    </form>
  );
}
