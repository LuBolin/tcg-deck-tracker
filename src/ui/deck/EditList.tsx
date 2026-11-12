import { useState } from 'react';
import type { ChangeInfo } from '../../app/actions';
import { diffLists } from '../../domain/decklist';
import { deckCount, describeIssue, sizeLabel, validateDeck } from '../../domain/rules';
import { formatUsd } from '../../domain/insights';
import { REASON_TAGS, type Card, type DeckLine } from '../../domain/types';
import type { GameAdapter } from '../../games/types';
import { DiffView, ErrorBox, TagPicker } from '../components';
import { groupLines } from './group';

export function EditList({ adapter, format, cards, lines, draft, setDraft, onSave, usedTags = [] }: {
  adapter: GameAdapter;
  /** Tags used before in this deck's history, offered again. */
  usedTags?: string[];
  format?: string;
  cards: Map<string, Card>;
  lines: DeckLine[];
  draft: DeckLine[];
  setDraft: (d: DeckLine[] | null) => void;
  onSave: (info: ChangeInfo) => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [customTags, setCustomTags] = useState<string[]>(usedTags);
  const [note, setNote] = useState('');
  const [result, setResult] = useState('');
  const diff = diffLists(lines, draft);
  const key = (l: DeckLine) => `${l.section}|${l.cardId}`;
  const setQty = (k: string, qty: number) => setDraft(draft.map((l) => (key(l) === k ? { ...l, qty: Math.max(0, qty) } : l)));
  /** Adding a card already in the list (even one set to 0) bumps its quantity. */
  const add = (card: Card, picked: string) => {
    // Some cards belong in a fixed section (Extra Deck monsters, Leaders) whatever was picked.
    const forced = adapter.sectionFor?.(card);
    const section = forced && picked !== 'sideboard' ? forced : picked;
    const k = `${section}|${card.id}`;
    setDraft(
      draft.some((l) => key(l) === k)
        ? draft.map((l) => (key(l) === k ? { ...l, qty: l.qty + 1 } : l))
        : [...draft, { cardId: card.id, name: card.name, qty: 1, section, set: card.set, number: card.number, category: card.category }],
    );
  };
  const cancel = () => {
    if (diff.length === 0 || window.confirm('Discard your unsaved card changes?')) setDraft(null);
  };
  const rules = adapter.deckRules(format);
  const main = deckCount(draft, rules);
  const issues = validateDeck(draft, rules, cards);

  return (
    <div className="grid2 edit-grid">
      <div className="panel">
        <div className="spread">
          <h3>Cards</h3>
          <span className={`chip ${issues.length ? 'warn' : 'ok'}`}>
            {main}{rules.size ? ` / ${sizeLabel(rules)}` : ''} cards
          </span>
        </div>
        {groupLines(adapter, draft, true).map((g) => (
          <section key={g.section.id}>
            <div className="cat-title">{g.section.label}</div>
            {g.cats.flatMap((c) => c.lines).map((gl) => {
              const l = draft.find((x) => key(x) === key(gl))!;
              return (
                <div key={key(l)} className="edit-row" style={{ opacity: l.qty === 0 ? 0.45 : 1 }}>
                  <div className="stepper">
                    <button type="button" className="small" onClick={() => setQty(key(l), l.qty - 1)} aria-label={`One less ${l.name}`} disabled={l.qty === 0}>−</button>
                    <input className="qty" type="number" min={0} value={l.qty} onChange={(e) => setQty(key(l), Number(e.target.value))} aria-label={`Quantity of ${l.name}`} />
                    <button type="button" className="small" onClick={() => setQty(key(l), l.qty + 1)} aria-label={`One more ${l.name}`}>+</button>
                  </div>
                  <span className={l.qty === 0 ? 'struck' : ''}>{l.name}</span>
                  <button type="button" className="small ghost" onClick={() => setQty(key(l), 0)} aria-label={`Remove ${l.name}`} disabled={l.qty === 0}>Remove</button>
                </div>
              );
            })}
          </section>
        ))}
        {issues.length > 0 && (
          <ul className="issues small">{issues.map((i) => <li key={describeIssue(i)}>{describeIssue(i)}</li>)}</ul>
        )}
        <AddCard adapter={adapter} onAdd={add} />
      </div>
      <div className="panel stack save-panel">
        <h3>Save this change</h3>
        <DiffView diff={diff} />
        <div>
          <div className="muted small" style={{ marginBottom: '0.3rem' }}>Why? Tap any that fit.</div>
          <TagPicker tags={[...REASON_TAGS, ...customTags.filter((t) => !(REASON_TAGS as readonly string[]).includes(t))]} value={tags} onChange={setTags} />
          <form className="row" style={{ marginTop: '0.4rem' }} onSubmit={(e) => {
            e.preventDefault();
            const typed = newTag.trim();
            // Reuse an existing tag with the same letters, so "vs Rakdos" and "VS rakdos" stay one tag.
            const t = [...REASON_TAGS, ...customTags].find((x) => x.toLowerCase() === typed.toLowerCase()) ?? typed;
            if (t && !tags.includes(t)) setTags([...tags, t]);
            if (t && ![...REASON_TAGS, ...customTags].includes(t)) setCustomTags([...customTags, t]);
            setNewTag('');
          }}>
            <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Your own tag, e.g. vs Gardevoir" aria-label="Add your own tag" style={{ flex: 1 }} />
            <button type="submit" className="small" disabled={!newTag.trim()}>Add tag</button>
          </form>
        </div>
        <label className="field">Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: aggro is popular at my locals" /></label>
        <label className="field">Result (optional)<input value={result} onChange={(e) => setResult(e.target.value)} placeholder="For example: 3-1 vs Deck X" /></label>
        <div className="row">
          <button type="button" className="primary" disabled={diff.length === 0 && !note.trim() && !result.trim()} onClick={() => onSave({ tags, note, result })}>
            Save change
          </button>
          <button type="button" onClick={cancel}>Cancel</button>
        </div>
        <p className="muted small">With no card changes, you can still save a note or a match result.</p>
      </div>
    </div>
  );
}

function AddCard({ adapter, onAdd }: { adapter: GameAdapter; onAdd: (card: Card, section: string) => void }) {
  const [q, setQ] = useState('');
  const [section, setSection] = useState(adapter.sections.find((s) => s.id === 'main')?.id ?? adapter.sections[0].id);
  const [results, setResults] = useState<Card[]>();
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string>();
  const [error, setError] = useState<string>();
  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setError(undefined);
    setBusy(true);
    try {
      setResults(await adapter.search(q));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={search} style={{ marginTop: '1rem' }}>
      <div className="row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a card to add" aria-label="Card search" style={{ flex: 1, minWidth: '10rem' }} />
        {adapter.sections.length > 1 && (
          <select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Add to section">
            {adapter.sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
        <button type="submit" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
      </div>
      <ErrorBox error={error} />
      {results && (
        <div className="search-results">
          {results.length === 0 && <span className="muted small">No cards found.</span>}
          {results.map((c) => (
            <button key={`${c.id}|${c.set}|${c.number}`} type="button" className={added === c.id ? 'just-added' : ''}
              onClick={() => { onAdd(c, section); setAdded(c.id); }}>
              {c.imageUrl ? <img className="thumb" src={c.imageUrl} alt="" loading="lazy" /> : <span className="thumb" />}
              <span>
                {c.name}
                <br />
                <span className="muted small">{[c.category, c.set, c.number].filter(Boolean).join(' · ')}{c.price !== undefined ? ` · ${formatUsd(c.price)}` : ''}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
