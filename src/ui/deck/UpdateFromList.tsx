import { useMemo, useState } from 'react';
import type { ChangeInfo } from '../../app/actions';
import { toDeckLines } from '../../app/importing';
import { diffLists, normalizeLines } from '../../domain/decklist';
import { REASON_TAGS, type DeckLine } from '../../domain/types';
import type { GameAdapter, ResolvedLine } from '../../games/types';
import { DiffView, TagPicker } from '../components';
import { ListReader } from '../ListReader';

/**
 * Paste a newer version of this deck's list (for example an updated tournament list) and save
 * the difference as one change with a reason, keeping the deck's history.
 */
export function UpdateFromList({ adapter, lines, onSave, onClose }: {
  adapter: GameAdapter;
  lines: DeckLine[];
  onSave: (next: DeckLine[], info: ChangeInfo) => void;
  onClose: () => void;
}) {
  const [resolved, setResolved] = useState<ResolvedLine[]>([]);
  const [unresolved, setUnresolved] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const next = useMemo(() => normalizeLines(toDeckLines(resolved)), [resolved]);
  const diff = next.length ? diffLists(lines, next) : [];

  return (
    <div className="panel stack">
      <div className="spread">
        <h3 style={{ margin: 0 }}>Update from a list</h3>
        <button type="button" className="small ghost" onClick={onClose}>Close</button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Paste the new full list. Only the difference is saved, as one change with your reason.</p>
      <ListReader adapter={adapter} label="New list" onChange={(r, u) => (setResolved(r), setUnresolved(u))} />
      {next.length > 0 && (
        <>
          <div><strong className="small">Difference: </strong><DiffView diff={diff} /></div>
          <TagPicker tags={REASON_TAGS} value={tags} onChange={setTags} />
          <label className="field">Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: updated to the regional-winning list" /></label>
          <div className="row">
            <button type="button" className="primary" disabled={diff.length === 0 || unresolved > 0} onClick={() => onSave(next, { tags, note })}>Save as a change</button>
            {unresolved > 0 && <span className="muted small">Fix or remove the problem lines first.</span>}
            {unresolved === 0 && diff.length === 0 && <span className="muted small">Same cards as the deck now.</span>}
          </div>
        </>
      )}
    </div>
  );
}
