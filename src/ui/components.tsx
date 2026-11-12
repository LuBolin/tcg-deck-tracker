import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LineDiff } from '../domain/decklist';
import type { SlotStatus } from '../domain/status';

export function ErrorBox({ error }: { error?: string }) {
  return error ? <div className="error" role="alert">{error}</div> : null;
}

export function Loading() {
  return <p className="muted" aria-live="polite">Loading…</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Status chips for one card slot: in deck, in binder, in other decks, missing. */
export function SlotChips({ status, deckName }: { status?: SlotStatus; deckName: (id: string) => string }) {
  if (!status) return null;
  return (
    <>
      {status.inDeck > 0 && <span className="chip ok" title="Owned copies in this deck">{status.inDeck} in deck</span>}
      {status.inBinder > 0 && <span className="chip info" title="Owned copies in the binder">{status.inBinder} in binder</span>}
      {status.inOtherDecks.map((o) => (
        <span key={o.deckId} className="chip warn" title="Owned copies in another deck">{o.qty} in {deckName(o.deckId)}</span>
      ))}
      {status.missing > 0 && <span className="chip bad" title="Copies you do not own">{status.missing} missing</span>}
    </>
  );
}

export function DiffView({ diff }: { diff: LineDiff[] }) {
  if (diff.length === 0) return <span className="muted small">No card changes</span>;
  return (
    <span className="small">
      {diff.map((d, i) => (
        <span key={`${d.section}|${d.cardId}`} className={d.delta > 0 ? 'diff-add' : 'diff-del'}>
          {i > 0 && ', '}
          {d.delta > 0 ? '+' : '−'}{Math.abs(d.delta)} {d.name}
          {d.section !== 'main' && <span className="muted"> ({d.section})</span>}
        </span>
      ))}
    </span>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('done');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 1800);
  };
  return (
    <button type="button" onClick={copy} aria-live="polite">
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed: select the text' : label}
    </button>
  );
}

export function TagPicker({ tags, value, onChange }: { tags: readonly string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="row" role="group" aria-label="Reason tags">
      {tags.map((t) => {
        const on = value.includes(t);
        return (
          <button
            key={t}
            type="button"
            className={`chip ${on ? 'on' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== t) : [...value, t])}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

export function GameBadge({ name }: { name: string }) {
  return <span className="chip accent">{name}</span>;
}

/** Small dropdown for less-used actions. Native <details>, so keyboard and screen readers work; closes after a choice. */
export function MoreMenu({ items, label = 'More' }: { items: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }[]; label?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  // Close on Escape or a click outside, like other menus.
  useEffect(() => {
    const close = (e: Event) => {
      const d = ref.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !d.contains(e.target as Node)) d.removeAttribute('open');
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, []);
  return (
    <details className="menu" ref={ref}>
      <summary className="btn">{label} ▾</summary>
      <div className="menu-items" role="menu">
        {items.map((i) => (
          <button key={i.label} type="button" role="menuitem" className={i.danger ? 'danger' : ''} disabled={i.disabled}
            onClick={() => { ref.current?.removeAttribute('open'); i.onClick(); }}>
            {i.label}
          </button>
        ))}
      </div>
    </details>
  );
}
