import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { readList } from '../app/importing';
import type { ParseError } from '../domain/listParse';
import type { GameAdapter, ResolvedLine } from '../games/types';
import { ErrorBox } from './components';
import { plural } from './text';
import { detectGame, games } from '../games';

/**
 * Paste box that parses and matches a list. Lines that fail go to a "Fix these" list:
 * the player retypes or removes them. Nothing is dropped silently.
 */
export function ListReader({
  adapter,
  label = 'Deck list',
  placeholder,
  initialText = '',
  onSwitchGame,
  onChange,
}: {
  adapter: GameAdapter;
  label?: string;
  placeholder?: string;
  initialText?: string;
  /** Offered when the text looks like another game's list. Gets the game id and the current text. */
  onSwitchGame?: (gameId: string, text: string) => void;
  onChange: (resolved: ResolvedLine[], unresolved: number) => void;
}) {
  const [text, setText] = useState(initialText);
  const guess = detectGame(text);
  /** A pasted share link ("…/share#d=…") belongs on the share page, not in the list parser. */
  const shareHash = /\/share(#d=[A-Za-z0-9_-]+)/.exec(text)?.[1];
  const other = onSwitchGame && guess && guess !== adapter.id ? games().find((g) => g.id === guess) : undefined;
  const [resolved, setResolved] = useState<ResolvedLine[]>();
  const [errors, setErrors] = useState<ParseError[]>([]);
  const [busy, setBusy] = useState(false);
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;
  const errorsRef = useRef(errors);
  errorsRef.current = errors;
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();

  const publish = (r: ResolvedLine[], e: ParseError[]) => {
    setResolved(r);
    setErrors(e);
    onChange(r, r.filter((x) => !x.card).length + e.length);
  };

  const read = async () => {
    setBusy(true);
    setError(undefined);
    try {
      let input = text;
      // A deck page URL: let the game fetch the list, then read it like pasted text.
      if (/^https?:\/\/\S+$/.test(text.trim())) {
        const fetched = adapter.importUrl ? await adapter.importUrl(text.trim()) : undefined;
        if (fetched === undefined) throw new Error(`Links from this site are not supported for ${adapter.name}. Copy the deck list text from the page instead.`);
        input = fetched;
        setText(fetched);
      }
      const out = await readList(adapter, input, (done, total) => total > 40 && setProgress(`Reading ${done} of ${total} lines…`));
      publish(out.resolved, out.errors);
    } catch (e) {
      setError(`Could not read the list: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  };

  /** Replace one problem line with retyped text. */
  const retry = async (lineNo: number, raw: string, section: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const out = await readList(adapter, raw);
      // Keep a section the adapter chose (Leader, Extra Deck); otherwise use the problem line's section.
      const fixed = out.resolved.map((r) => ({ ...r, line: { ...r.line, lineNo, section: r.line.section !== 'main' ? r.line.section : section } }));
      // Read the latest lists (refs), not the ones captured when Retry was clicked.
      publish(
        [...(resolvedRef.current ?? []).filter((r) => r.line.lineNo !== lineNo), ...fixed].sort((a, b) => a.line.lineNo - b.line.lineNo),
        [...errorsRef.current.filter((e) => e.lineNo !== lineNo), ...out.errors.map((e) => ({ ...e, lineNo, section }))],
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (lineNo: number) =>
    publish((resolved ?? []).filter((r) => r.line.lineNo !== lineNo), errors.filter((e) => e.lineNo !== lineNo));

  const problems = [
    ...(resolved ?? []).filter((r) => !r.card).map((r) => ({ lineNo: r.line.lineNo, raw: r.line.raw, section: r.line.section, why: 'Card not found' })),
    ...errors.map((e) => ({ ...e, section: e.section ?? 'main', why: 'Not a card line' })),
  ].sort((a, b) => a.lineNo - b.lineNo);

  return (
    <div className="stack">
      <label className="field">
        {label}
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder ?? adapter.sampleList} spellCheck={false} />
      </label>
      <div className="row">
        <button type="button" className="primary" onClick={read} disabled={busy || !text.trim()}>
          {busy ? progress ?? 'Reading…' : 'Read list'}
        </button>
        <label className="btn" title="A deck list (.txt) or a collection export (.csv) from a collection app such as Dragon Shield or TCGplayer">
          Load a file
          <input type="file" accept=".txt,.csv,.dek,text/plain,text/csv" hidden
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = ''; }} />
        </label>
        {resolved && (
          <span className="muted small">
            {plural(resolved.filter((r) => r.card).length, 'line')} matched
            {problems.length > 0 && `, ${problems.length} to fix`}
          </span>
        )}
      </div>
      {shareHash && (
        <div className="notice row">
          <span>This is a deck share link.</span>
          <Link className="btn small primary" to={`/share${shareHash}`}>Open the shared deck</Link>
        </div>
      )}
      {other && (
        <div className="notice row">
          <span>This looks like a <strong>{other.name}</strong> list.</span>
          <button type="button" className="small" onClick={() => onSwitchGame!(other.id, text)}>Switch to {other.name}</button>
        </div>
      )}
      <ErrorBox error={error} />
      {problems.length > 0 && (
        <div className="panel">
          <h3>Fix these</h3>
          <p className="muted small">Retype the line (for example with its set code and number) or remove it.</p>
          {problems.map((p) => (
            <ProblemLine key={`${p.lineNo}|${p.raw}`} {...p} busy={busy} onRetry={(raw) => retry(p.lineNo, raw, p.section)} onRemove={() => remove(p.lineNo)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProblemLine(p: { lineNo: number; raw: string; why: string; busy: boolean; onRetry: (raw: string) => void; onRemove: () => void }) {
  const [raw, setRaw] = useState(p.raw);
  return (
    <div className="row" style={{ marginBottom: '0.4rem' }}>
      <span className="chip bad">line {p.lineNo}: {p.why}</span>
      <input value={raw} onChange={(e) => setRaw(e.target.value)} aria-label={`Line ${p.lineNo}`} style={{ flex: 1, minWidth: '12rem' }} />
      <button type="button" className="small" onClick={() => p.onRetry(raw)} disabled={p.busy}>Retry</button>
      <button type="button" className="small danger" onClick={p.onRemove} disabled={p.busy}>Remove</button>
    </div>
  );
}
