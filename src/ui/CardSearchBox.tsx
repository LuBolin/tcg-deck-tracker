import { useEffect, useId, useRef, useState } from 'react';
import { formatUsd } from '../domain/insights';
import type { Card } from '../domain/types';
import type { GameAdapter } from '../games/types';
import { plural } from './text';

/**
 * Type-ahead search of the game's card database. Results drop down under the box; hovering or
 * arrowing to one shows its image beside the list. Enter or click picks it.
 */
export function CardSearchBox({ adapter, onPick, placeholder = 'Search cards by name or effect' }: {
  adapter: GameAdapter;
  onPick: (card: Card) => void;
  placeholder?: string;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Card[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const box = useRef<HTMLDivElement>(null);

  // Search after a short pause in typing; only the latest query's answer is shown.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResults([]); setBusy(false); return; }
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      adapter.search(query).then(
        (r) => { if (live) { setResults(r); setActive(r.length ? 0 : -1); setError(undefined); setBusy(false); } },
        (e: unknown) => { if (live) { setResults([]); setError(e instanceof Error ? e.message : String(e)); setBusy(false); } },
      );
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [q, adapter]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (c: Card) => {
    onPick(c);
    setOpen(false);
    setQ('');
  };
  const shown = open && q.trim().length >= 2;
  const preview = results[active];

  return (
    <div className="card-search" ref={box}>
      <input
        type="search" role="combobox" aria-expanded={shown} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? `${id}-${active}` : undefined}
        aria-label="Search cards" placeholder={placeholder} value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(results.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && shown && preview) { e.preventDefault(); pick(preview); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {shown && (
        <div className="card-search-pop">
          <ul id={`${id}-list`} role="listbox" aria-label="Matching cards" className="card-search-list">
            {busy && <li className="muted small" aria-live="polite">Searching…</li>}
            {!busy && error && <li className="small bad-text">{error}</li>}
            {!busy && !error && results.length === 0 && <li className="muted small">No cards found.</li>}
            {!busy && results.map((c, i) => (
              <li key={`${c.id}|${c.set}|${c.number}`} id={`${id}-${i}`} role="option" aria-selected={i === active}
                className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(c); }}>
                <span className="cs-name">{c.name}</span>
                <span className="muted small">{[c.subtype ?? c.category, [c.set, c.number].filter(Boolean).join(' '), c.price !== undefined ? formatUsd(c.price) : ''].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
          {!busy && preview?.imageUrl && <img className="card-search-preview" src={preview.imageUrl} alt={`${preview.name} card`} />}
        </div>
      )}
    </div>
  );
}

/** Card images for a list being read or added, with copy counts; lines not matched yet show their text. */
export function CardPreviewPanel({ items, title = 'Preview' }: { items: { key: string; name: string; qty: number; card?: Card }[]; title?: string }) {
  const total = items.reduce((n, i) => n + i.qty, 0);
  return (
    <aside className="preview-panel" aria-label={title}>
      <div className="spread"><h3 style={{ margin: 0 }}>{title}</h3>{total > 0 && <span className="muted small">{plural(total, 'card')}</span>}</div>
      {items.length === 0
        ? <p className="muted small">Card images show here as you add or read cards.</p>
        : (
          <div className="preview-grid">
            {items.map((i) => (
              <figure key={i.key} className={`preview-card ${i.card ? '' : 'unmatched'}`} title={i.card ? i.name : `${i.name}: not matched yet`}>
                {i.card?.imageUrl ? <img src={i.card.imageUrl} alt={i.name} loading="lazy" /> : <span className="no-art">{i.name}</span>}
                <span className="preview-qty">{i.qty}</span>
              </figure>
            ))}
          </div>
        )}
    </aside>
  );
}
