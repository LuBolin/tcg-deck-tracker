import { useEffect, useState } from 'react';
import { latestLines, refreshCardData } from '../app/actions';
import { currentAccount, repo } from '../app/repo';
import { AccountPanel } from './AccountPanel';
import { games } from '../games';
import { ErrorBox } from './components';
import { markBackedUp } from './backup';
import { applyTheme, readTheme, type Theme } from './theme';
import { setTracksUnlimited, tracksUnlimited } from '../app/supply';
import { roleNames, setRoleName } from '../app/prefs';
import { COMMON_TAG_RULES } from '../domain/cardText';
import { useTitle } from './useTitle';

export function SettingsPage() {
  const [message, setMessage] = useState<string>();
  useTitle("Settings");
  // Links like /settings#roles jump to their panel.
  useEffect(() => { if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView(); }, []);
  const place = currentAccount() ? 'your account' : 'this browser';
  const [error, setError] = useState<string>();

  const exportData = async () => {
    const data = await repo.exportAll();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `tcg-deck-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    markBackedUp();
  };

  const importData = async (file: File) => {
    setError(undefined);
    setMessage(undefined);
    if (!window.confirm(`Replace ALL data in ${place} with the backup? Decks, history and collection there are overwritten.`)) return;
    try {
      await repo.importAll(JSON.parse(await file.text()));
      setMessage('Backup restored.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const [progress, setProgress] = useState<string>();
  const [usage, setUsage] = useState<string>();
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    // Not every browser reports this; the line simply stays hidden then.
    navigator.storage?.estimate?.().then((e) => {
      if (e.usage !== undefined) setUsage(`This app uses about ${(e.usage / 1024 / 1024).toFixed(1)} MB in this browser.`);
    }).catch(() => {});
  }, []);
  const refreshAll = async () => {
    setError(undefined);
    setMessage(undefined);
    try {
      const decks = await repo.listDecks();
      let updated = 0;
      for (const [i, d] of decks.entries()) {
        setProgress(`Refreshing ${i + 1} of ${decks.length}: ${d.name}`);
        const adapter = games().find((g) => g.id === d.game);
        if (adapter) updated += await refreshCardData(repo, adapter, await latestLines(repo, d.id));
      }
      setMessage(`Updated data for ${updated} cards across ${decks.length} decks.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(undefined);
    }
  };

  const clearAll = async () => {
    setError(undefined);
    setMessage(undefined);
    // Cannot be undone, so ask for a typed confirmation rather than one click.
    const typed = window.prompt(`This deletes ALL decks, history and collection data in ${place} and cannot be undone. Type DELETE to confirm.`);
    if (typed?.trim() !== 'DELETE') return;
    try {
      await repo.importAll({ version: 1, decks: [], changes: [], copies: [], cards: [] });
      setMessage('All data deleted.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <h1>Settings</h1>
      <AccountPanel />
      <div className="panel stack">
        <h2>Your data</h2>
        <p className="muted">
          {currentAccount()
            ? 'Your data is stored in your account. Download a backup to keep your own copy.'
            : 'Your data is stored in this browser only. Clearing site data deletes it. Download a backup to keep it safe, or sign in to save it to an account.'}
        </p>
        {usage && <p className="small muted" style={{ margin: 0 }}>{usage}</p>}
        <div className="row">
          <button type="button" className="primary" onClick={exportData}>Download backup</button>
          <label className="btn">
            Restore from backup
            <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])} />
          </label>
        </div>
        {message && <p className="chip ok">{message}</p>}
        <ErrorBox error={error} />
      </div>
      <div className="panel stack">
        <h2>Appearance</h2>
        <div className="segmented" role="group" aria-label="Theme" style={{ alignSelf: 'flex-start' }}>
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button key={t} type="button" aria-pressed={theme === t} className={theme === t ? 'on' : ''} onClick={() => { applyTheme(t); setTheme(t); }}>
              {t === 'system' ? 'Match system' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </div>
      <UnlimitedCards />
      <RoleNames />
      <div className="panel stack">
        <h2>Card data</h2>
        <p className="muted">Prices, legality and banlists change. Each deck refreshes its own cards when they are a week old; this refreshes every deck now.</p>
        <div className="row">
          <button type="button" onClick={refreshAll} disabled={!!progress}>{progress ?? 'Refresh all card data'}</button>
        </div>
      </div>
      <div className="panel stack">
        <h2>Start over</h2>
        <p className="muted">Deletes every deck, change and copy in {place}. Download a backup first if you might want them back.</p>
        <div className="row">
          <button type="button" className="danger" onClick={clearAll}>Delete all data…</button>
        </div>
      </div>
      <div className="panel stack">
        <h2>Card data sources</h2>
        <p className="muted">Card names, images, prices and legality come from these free community services. This app is not made or endorsed by them or by the game publishers.</p>
        <ul>
          {games().filter((g) => g.id !== 'demo').map((g) => (
            <li key={g.id}><strong>{g.name}</strong>: <a href={g.source.url} target="_blank" rel="noreferrer">{g.source.name}</a>{g.source.prices ? ` · prices: ${g.source.prices}` : ''}</li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** Per game: treat basic cards (Pokémon basic Energy) as an endless supply, or count them like any card. */
function UnlimitedCards() {
  const list = games().filter((g) => g.unlimited);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(list.map((g) => [g.id, tracksUnlimited(g.id)])));
  if (list.length === 0) return null;
  return (
    <div className="panel stack">
      <h2>Basic cards</h2>
      {list.map((g) => (
        <div key={g.id} className="stack" style={{ gap: '0.25rem' }}>
          <label className="row">
            <input type="checkbox" checked={!!on[g.id]} onChange={(e) => { setTracksUnlimited(g.id, e.target.checked); setOn({ ...on, [g.id]: e.target.checked }); }} />
            Track my {g.unlimited!.label} ({g.name})
          </label>
          <p className="muted small" style={{ margin: 0 }}>
            {on[g.id]
              ? `Your ${g.unlimited!.label} is counted like any other card: add copies to the binder or a deck, including special prints. Copies count by name, whatever the print.`
              : `Off: ${g.unlimited!.label} is always available, so it never shows as missing or in want-lists. Turn this on to count your copies, for example special-print cards.`}
          </p>
        </div>
      ))}
      <p className="small muted" style={{ margin: 0 }}>Saved in this browser.</p>
    </div>
  );
}

/** Rename the role tags the app works out from card text ("draw" → "card draw"). Empty = the original name. */
function RoleNames() {
  const tags = [...new Set([...COMMON_TAG_RULES, ...games().flatMap((g) => g.tagRules ?? [])].map((r) => r.tag))].sort();
  const [names, setNames] = useState<Record<string, string>>(roleNames);
  const [saved, setSaved] = useState<string>();
  const [error, setError] = useState<string>();
  const save = async (tag: string, value: string) => {
    if ((roleNames()[tag] ?? '') === value.trim()) return;
    try {
      await setRoleName(tag, value);
      setNames(roleNames());
      setSaved(tag);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="panel stack" id="roles">
      <h2>Role names</h2>
      <p className="muted small" style={{ margin: 0 }}>Roles are worked out from each card's text. Give any of them your own name; leave a box empty to keep the original.</p>
      <div className="role-names">
        {tags.map((t) => (
          <label key={t} className="row">
            <span className="role-original">{t}</span>
            <input value={names[t] ?? ''} placeholder={t} aria-label={`Name for the ${t} role`}
              onChange={(e) => setNames({ ...names, [t]: e.target.value })}
              onBlur={(e) => save(t, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
            {saved === t && <span className="small muted" role="status">Saved</span>}
          </label>
        ))}
      </div>
      <ErrorBox error={error} />
    </div>
  );
}
