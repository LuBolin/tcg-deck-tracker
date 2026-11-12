import { Link } from 'react-router';
import { versionGraph } from '../../domain/variants';
import type { Change, Deck } from '../../domain/types';
import { LabelChip } from '../components';

const ROW = 36;
const LANE = 22;
const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#84cc16', '#ec4899'];
const color = (lane: number) => COLORS[lane % COLORS.length];

/**
 * A deck family's history as a graph, newest first: one colored lane per deck, a dot per saved change,
 * curves where a variant was made from a version, and dashed curves where a variant took a parent change.
 */
export function VersionGraph({ family, changes, currentId }: { family: Deck[]; changes: Map<string, Change[]>; currentId: string }) {
  const { nodes, edges } = versionGraph(family, changes);
  if (nodes.length === 0) return null;
  const last = nodes.length - 1;
  const x = (lane: number) => 12 + lane * LANE;
  const y = (row: number) => (last - row) * ROW + ROW / 2; // newest at the top
  const width = x(family.length - 1) + 14;
  return (
    <div className="version-graph" role="figure" aria-label={`Version graph of ${family.length} decks and ${nodes.length} changes`}>
      <svg width={width} height={nodes.length * ROW} aria-hidden="true" className="vg-lines">
        {edges.map((e, i) => {
          const [x1, y1, x2, y2] = [x(e.from.lane), y(e.from.row), x(e.to.lane), y(e.to.row)];
          const d = e.kind === 'next' && x1 === x2 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;
          return <path key={i} d={d} fill="none" stroke={color(e.kind === 'applied' ? e.from.lane : e.to.lane)} strokeWidth={2} strokeDasharray={e.kind === 'applied' ? '4 3' : undefined} />;
        })}
        {nodes.map((n) => (
          <circle key={n.change.id} cx={x(n.lane)} cy={y(n.row)} r={n.deck.id === currentId ? 6 : 4.5} fill={color(n.lane)}
            stroke="var(--surface)" strokeWidth={2} />
        ))}
      </svg>
      <ol className="vg-rows">
        {[...nodes].reverse().map((n) => (
          <li key={n.change.id} style={{ height: ROW }} className={n.deck.id === currentId ? 'current' : ''}>
            <Link to={`/decks/${n.deck.id}`} className="vg-deck" style={{ borderColor: color(n.lane) }}>{n.deck.name}</Link>
            {n.change.seq === 1 && (n.deck.labels ?? []).map((l) => <LabelChip key={l} name={l} />)}
            <span className="vg-text">
              <strong>Change {n.change.seq}</strong>
              {n.change.tags.map((t) => <span key={t} className="chip accent">{t}</span>)}
              {n.change.result && <span className="chip">{n.change.result}</span>}
              {n.change.note && <span className="muted"> {n.change.note}</span>}
            </span>
            <time className="muted small" dateTime={n.change.createdAt}>{new Date(n.change.createdAt).toLocaleDateString()}</time>
          </li>
        ))}
      </ol>
    </div>
  );
}
