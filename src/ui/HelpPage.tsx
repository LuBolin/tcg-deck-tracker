import { Link } from 'react-router';
import { useTitle } from './useTitle';

/** One page that explains the ideas the app is built on. */
export function HelpPage() {
  useTitle('Help');
  return (
    <>
      <h1>How it works</h1>
      <div className="grid2">
        <section className="panel stack">
          <h2>Where your cards are</h2>
          <p>Every card you own is in one place: the binder or one deck. Each card in a deck shows where its copies are:</p>
          <ul className="help-list">
            <li><span className="chip ok">in deck</span> owned and in this deck</li>
            <li><span className="chip info">in binder</span> owned, waiting in the binder</li>
            <li><span className="chip warn">in Deck B</span> owned, but in another deck right now</li>
            <li><span className="chip bad">missing</span> you do not own enough copies</li>
            <li><span className="chip ok">unlimited</span> basic Energy: always available unless you track it in Settings</li>
          </ul>
          <p className="small muted">Use <strong>Gather</strong> on a deck to pull its cards from the binder and other decks, with Undo.</p>
        </section>
        <section className="panel stack">
          <h2>Changes and variants</h2>
          <p>Every save is a <strong>change</strong> with what changed and why (tags, a note, a match result). Old versions stay in History.</p>
          <p>A <strong>variant</strong> is a copy of a deck for another situation (another meta, a budget). It shares your physical cards and remembers its parent: when the parent changes, the variant can apply the change too, oldest first.</p>
          <p className="small muted">Write results as wins-losses (for example 3-1) and each deck keeps a record.</p>
        </section>
        <section className="panel stack">
          <h2>Want-lists and selling</h2>
          <p>A <strong>want-list</strong> is a plain-text message of your missing cards and offers. A <strong>selling list</strong> lists your spare binder cards. Post either in any chat.</p>
          <p>Paste a list from someone else into <Link to="/want">Check a list</Link> to see which of your spares they want, or which of your decks need what they sell.</p>
        </section>
        <section className="panel stack">
          <h2>Sharing a deck</h2>
          <p>A deck's <strong>Share</strong> link carries the list and every reason inside the link itself; nothing is uploaded. Whoever opens it sees the deck checked against their own cards and can save a copy.</p>
        </section>
        <section className="panel stack">
          <h2>Importing</h2>
          <p>Paste a list in the format your game's apps export, load a .txt, .csv or .ydk file, or paste a play.limitlesstcg.com decklist link. Lines the app cannot match go to <strong>Fix these</strong>; nothing is dropped silently.</p>
        </section>
        <section className="panel stack">
          <h2>Your data</h2>
          <p>Until you sign in, everything is saved in this browser only. Sign in from <Link to="/settings">Settings</Link> to save to an account and use it on any device; you can copy this browser's decks into it. Backups download from Settings too. Press <kbd>/</kbd> to jump to the search box on the decks and collection pages.</p>
        </section>
      </div>
    </>
  );
}
