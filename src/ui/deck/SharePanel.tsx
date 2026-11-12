import { useEffect, useState } from 'react';
import { encodeShare, packDeck } from '../../domain/share';
import type { Change, Deck } from '../../domain/types';
import { CopyButton, ErrorBox } from '../components';

/** Longest message a Discord user can send without Nitro; a longer link needs history left out. */
const CHAT_LIMIT = 2000;

/** A link that carries the deck and its reasons. Nothing is uploaded: the deck travels inside the link. */
export function SharePanel({ deck, changes, onClose }: { deck: Deck; changes: Change[]; onClose: () => void }) {
  const [withHistory, setWithHistory] = useState(true);
  const [link, setLink] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    encodeShare(packDeck(deck, changes, withHistory))
      .then((d) => live && setLink(`${location.origin}${import.meta.env.BASE_URL}share#d=${d}`))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [deck, changes, withHistory]);

  return (
    <div className="panel stack">
      <div className="spread">
        <h3 style={{ margin: 0 }}>Share this deck</h3>
        <button type="button" className="small ghost" onClick={onClose}>Close</button>
      </div>
      <label className="row small">
        <input type="checkbox" checked={withHistory} onChange={(e) => setWithHistory(e.target.checked)} />
        Include every change and its reason ({changes.length} changes)
      </label>
      <div className="row">
        <input readOnly value={link} aria-label="Share link" style={{ flex: 1, minWidth: '12rem' }} onFocus={(e) => e.target.select()} />
        <CopyButton text={link} label="Copy link" />
      </div>
      <ErrorBox error={error} />
      <p className="muted small" style={{ margin: 0 }}>
        The deck travels inside the link; nothing is uploaded. Anyone with the link sees the list checked against their own cards and can save a copy.
        {link.length > CHAT_LIMIT && ` This link is ${link.length} characters, too long for one chat message: leave the history out to shorten it.`}
      </p>
    </div>
  );
}
