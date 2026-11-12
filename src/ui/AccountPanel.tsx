import { useEffect, useState } from 'react';
import { currentAccount, currentSocial, enabledProviders, localRepo, repo, supabase } from '../app/repo';
import { Link } from 'react-router';
import { HANDLE } from '../data/social';
import { ErrorBox } from './components';
import { plural } from './text';

/** Sign in with an emailed link, sign out, and copy this browser's data into the account. */
export function AccountPanel() {
  const account = currentAccount();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  // Google sign-in shows only once it is switched on in the Supabase project.
  const [google, setGoogle] = useState(false);
  useEffect(() => { if (!account) enabledProviders().then((p) => setGoogle(p.includes('google')), () => {}); }, [account]);
  const sb = supabase;
  if (!sb) return null;

  const run = async (work: () => Promise<string | undefined>) => {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      setMessage(await work());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const signInWithGoogle = () =>
    run(async () => {
      // Leaves for Google and comes back signed in; the page reloads into the account.
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${import.meta.env.BASE_URL}` } });
      if (error) throw new Error(error.message);
      return undefined;
    });

  const sendLink = () =>
    run(async () => {
      const { error } = await sb.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${location.origin}${import.meta.env.BASE_URL}` },
      });
      if (error) throw new Error(error.message);
      return `Check ${email.trim()} and open the link to finish. It signs you in, or creates your account the first time.`;
    });

  const copyLocal = () =>
    run(async () => {
      const data = await localRepo.exportAll();
      if (data.decks.length === 0 && data.copies.length === 0) return 'This browser has no decks or cards to copy.';
      const ok = window.confirm(
        `Replace everything in your account with this browser's data (${plural(data.decks.length, 'deck')})? Decks, history and collection in your account are overwritten. This browser keeps its copy.`,
      );
      if (!ok) return undefined;
      await repo.importAll(data);
      return `Copied ${plural(data.decks.length, 'deck')} to your account.`;
    });

  return (
    <div className="panel stack" id="account">
      <h2>{account ? 'Account' : 'Sign in or create an account'}</h2>
      {account ? (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Signed in as <strong>{account.email}</strong>. Your decks and collection are saved to your account and open on any device where you sign in.
          </p>
          <ProfileEditor />
          <div className="row">
            <button type="button" onClick={copyLocal} disabled={busy}>Copy this browser's data to my account…</button>
            <button type="button" onClick={() => run(async () => { await sb.auth.signOut(); return undefined; })} disabled={busy}>Sign out</button>
          </div>
        </>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void sendLink(); }}>
          <p className="muted" style={{ margin: 0 }}>
            Save your decks and collection to an account and use them on any device. Enter your email and we send you a link.
            New here? The same link creates your account. No password needed.
          </p>
          {google && (
            <>
              <button type="button" className="google-btn" disabled={busy} onClick={signInWithGoogle}>
                <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>
                Continue with Google
              </button>
              <div className="or-line small muted"><span>or with email</span></div>
            </>
          )}
          <div className="row">
            <input type="email" required autoComplete="email" placeholder="you@example.com" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" className="primary" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Continue with email'}</button>
          </div>
        </form>
      )}
      {message && <p className="chip ok">{message}</p>}
      <ErrorBox error={error} />
    </div>
  );
}

/** The public handle other players find and follow you by. */
function ProfileEditor() {
  const social = currentSocial();
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<string>();
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    social?.myProfile().then((p) => { setHandle(p?.handle ?? ''); setName(p?.displayName ?? ''); setSaved(p?.handle); setLoaded(true); }, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [social]);
  if (!social) return null;
  const valid = HANDLE.test(handle.trim().toLowerCase());
  const save = async () => {
    setError(undefined);
    try {
      await social.saveProfile(handle, name);
      setSaved(handle.trim().toLowerCase());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <form className="stack" style={{ gap: '0.4rem' }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h3 style={{ margin: 0 }}>Public profile</h3>
      <p className="muted small" style={{ margin: 0 }}>Other players find and follow you by your handle. Only decks you make public are shown.</p>
      <div className="row">
        <label className="field">Handle<input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="ash_k" disabled={!loaded} aria-invalid={!!handle && !valid} /></label>
        <label className="field" style={{ flex: 1, minWidth: '10rem' }}>Display name (optional)<input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} disabled={!loaded} /></label>
        <button type="submit" style={{ alignSelf: 'flex-end' }} disabled={!loaded || !valid}>Save profile</button>
      </div>
      {handle && !valid && <span className="small bad-text">3 to 20 lowercase letters, digits or underscores.</span>}
      {saved && <span className="small muted">Your profile: <Link to={`/u/${saved}`}>@{saved}</Link></span>}
      <ErrorBox error={error} />
    </form>
  );
}
