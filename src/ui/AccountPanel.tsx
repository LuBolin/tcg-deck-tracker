import { useState } from 'react';
import { currentAccount, localRepo, repo, supabase } from '../app/repo';
import { ErrorBox } from './components';
import { plural } from './text';

/** Sign in with an emailed link, sign out, and copy this browser's data into the account. */
export function AccountPanel() {
  const account = currentAccount();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
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

  const sendLink = () =>
    run(async () => {
      const { error } = await sb.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${location.origin}${import.meta.env.BASE_URL}` },
      });
      if (error) throw new Error(error.message);
      return `Check ${email.trim()} for a sign-in link. Open it in this browser or any other.`;
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
    <div className="panel stack">
      <h2>Account</h2>
      {account ? (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Signed in as <strong>{account.email}</strong>. Your decks and collection are saved to your account and open on any device where you sign in.
          </p>
          <div className="row">
            <button type="button" onClick={copyLocal} disabled={busy}>Copy this browser's data to my account…</button>
            <button type="button" onClick={() => run(async () => { await sb.auth.signOut(); return undefined; })} disabled={busy}>Sign out</button>
          </div>
        </>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void sendLink(); }}>
          <p className="muted" style={{ margin: 0 }}>Sign in to save your decks to an account and use them on every device. No password: we email you a link.</p>
          <div className="row">
            <input type="email" required autoComplete="email" placeholder="you@example.com" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" className="primary" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
          </div>
        </form>
      )}
      {message && <p className="chip ok">{message}</p>}
      <ErrorBox error={error} />
    </div>
  );
}
