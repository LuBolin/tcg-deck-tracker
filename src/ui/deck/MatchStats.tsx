import { formatRecord, type MatchRecord } from '../../domain/insights';
import { gamesIn, matchStats, winRate } from '../../domain/matches';
import type { Change } from '../../domain/types';

const pct = (r: MatchRecord) => `${Math.round(winRate(r) * 100)}%`;

function Row({ label, record, sub }: { label: string; record: MatchRecord; sub?: string }) {
  return (
    <tr>
      <td>{label}{sub && <span className="muted small"> · {sub}</span>}</td>
      <td className="num">{formatRecord(record)}</td>
      <td className="num">{pct(record)}</td>
    </tr>
  );
}

/** Win rates from logged results: by opponent deck, going first or second, and by deck version. */
export function MatchStats({ changes }: { changes: Change[] }) {
  const s = matchStats(changes);
  if (!s.total.events) {
    return (
      <section className="panel">
        <h3 style={{ marginTop: 0 }}>Matches</h3>
        <p className="muted small" style={{ margin: 0 }}>No results yet. After each match, use <strong>Log a result</strong> on the Cards tab. Win rates by opponent and by version show here.</p>
      </section>
    );
  }
  const date = (iso: string) => new Date(iso).toLocaleDateString();
  return (
    <section className="panel stack">
      <h3 style={{ margin: 0 }}>Matches <span className="muted small">{formatRecord(s.total)} · {pct(s.total)} won · {gamesIn(s.total)} games</span></h3>
      <table className="match-table">
        <thead><tr><th>Opponent's deck</th><th className="num">W-L-T</th><th className="num">Won</th></tr></thead>
        <tbody>{s.byOpponent.map((o) => <Row key={o.opponent} label={o.opponent} record={o.record} />)}</tbody>
      </table>
      {(gamesIn(s.byTurn.first) > 0 || gamesIn(s.byTurn.second) > 0) && (
        <table className="match-table">
          <thead><tr><th>Turn order</th><th className="num">W-L-T</th><th className="num">Won</th></tr></thead>
          <tbody>
            {gamesIn(s.byTurn.first) > 0 && <Row label="Went first" record={s.byTurn.first} />}
            {gamesIn(s.byTurn.second) > 0 && <Row label="Went second" record={s.byTurn.second} />}
          </tbody>
        </table>
      )}
      {s.versions > 1 && (
        <table className="match-table">
          <thead><tr><th>Version played</th><th className="num">W-L-T</th><th className="num">Won</th></tr></thead>
          <tbody>
            {[...s.byVersion].reverse().map((v) => (
              <Row key={v.version} label={`Version ${v.version}`} sub={`${v.version === s.versions ? 'current, ' : ''}from ${date(v.since)}`} record={v.record} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
