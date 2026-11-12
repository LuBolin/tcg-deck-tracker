import { useEffect, useState } from 'react';
import { unreadActivity } from '../app/activity';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { APP_NAME, currentAccount, supabase } from '../app/repo';

export function Shell() {
  const { pathname } = useLocation();
  // New activity from followed players: checked on load, every few minutes, and cleared by opening Activity.
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!currentAccount()) return;
    const check = () => unreadActivity().then(setUnread, () => {});
    check();
    const t = setInterval(check, 3 * 60_000);
    const seen = () => setUnread(0);
    window.addEventListener('activity-seen', seen);
    return () => { clearInterval(t); window.removeEventListener('activity-seen', seen); };
  }, []);
  // Deck pages and import belong to the Decks section.
  const inDecks = pathname === '/' || pathname.startsWith('/decks') || pathname.startsWith('/import');

  // "/" jumps to the page's search box (Find a deck, Find a card), unless the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || t.closest('input, textarea, select, [contenteditable]')) return;
      const box = document.querySelector<HTMLInputElement>('main input[aria-label^="Find"]');
      if (box) { e.preventDefault(); box.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand"><span className="brand-mark" aria-hidden />{APP_NAME}</Link>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" className={() => (inDecks ? 'active' : '')} aria-current={inDecks ? 'page' : undefined}>Decks</NavLink>
          <NavLink to="/collection">Collection</NavLink>
          <NavLink to="/want">Want-lists</NavLink>
          {currentAccount() && (
            <NavLink to="/activity" aria-label={unread ? `Activity, ${unread} new` : 'Activity'}>
              Activity{unread > 0 && <span className="nav-badge" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
            </NavLink>
          )}
          <NavLink to="/settings">Settings</NavLink>
          <NavLink to="/help">Help</NavLink>
          {supabase && !currentAccount() && <Link to="/settings" className="nav-cta">Sign in</Link>}
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <footer className="footer small muted">
        {currentAccount()
          ? <>Saved to your account ({currentAccount()!.email}). <Link to="/settings">Account and backups</Link></>
          : <>Your decks are saved in this browser only. <Link to="/settings">{supabase ? 'Sign in or back up' : 'Back up or restore'}</Link></>} · Card data from community services (see Settings). Press / to search.
      </footer>
    </>
  );
}
