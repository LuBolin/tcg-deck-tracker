import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { getPref, setPref } from '../app/prefs';
import { ACTIVITY_SEEN } from '../app/activity';
import { currentSocial } from '../app/repo';
import { useLoad } from '../app/useLoad';
import type { FeedItem, Profile } from '../data/social';
import { games } from '../games';
import { Empty, ErrorBox, GameBadge, Loading } from './components';
import { useTitle } from './useTitle';

const SEEN = ACTIVITY_SEEN;

const who = (f: { handle?: string; displayName?: string }) => f.displayName || (f.handle ? `@${f.handle}` : 'A player');

function FeedRow({ f, seen }: { f: FeedItem; seen: string }) {
  const g = games().find((x) => x.id === f.game);
  return (
    <li className={`feed-item ${f.createdAt > seen ? 'unread' : ''}`}>
      <div className="row">
        {f.handle ? <Link to={`/u/${f.handle}`}><strong>{who(f)}</strong></Link> : <strong>{who(f)}</strong>}
        <span>{f.seq === 1 ? 'shared a new deck' : 'changed'}</span>
        {f.handle ? <Link to={`/u/${f.handle}/decks/${f.deckId}`}>{f.deckName}</Link> : <span>{f.deckName}</span>}
        {g && <GameBadge name={g.name} />}
        <time className="muted small" dateTime={f.createdAt}>{new Date(f.createdAt).toLocaleString()}</time>
      </div>
      {(f.note || f.tags.length > 0 || f.result) && (
        <div className="row small">
          {f.tags.map((t) => <span key={t} className="chip accent">{t}</span>)}
          {f.result && <span className="chip">{f.result}</span>}
          {f.note && <span className="muted">{f.note}</span>}
        </div>
      )}
    </li>
  );
}

/** Players I follow and what they changed in their public decks; opening it marks everything as seen. */
export function ActivityPage() {
  useTitle('Activity');
  const social = currentSocial();
  const [seen] = useState(() => getPref<string>(SEEN, '')); // keep this visit's highlights after marking seen
  const { data, error, reload } = useLoad(async () => {
    if (!social) return undefined;
    const [feed, following, me] = await Promise.all([social.feed(100), social.following(), social.myProfile()]);
    return { feed, following, me };
  }, []);
  useEffect(() => {
    if (data?.feed) void setPref(SEEN, data.feed[0]?.createdAt ?? new Date().toISOString()).then(() => window.dispatchEvent(new Event('activity-seen')));
  }, [data]);

  if (!social) return <Empty>Sign in to follow other players and see their deck changes. <Link to="/settings">Sign in</Link></Empty>;
  return (
    <>
      <h1>Activity</h1>
      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        <div className="grid2 activity-layout">
          <section className="panel stack">
            <h2>From players you follow</h2>
            {data.feed.length === 0
              ? <p className="muted">Nothing yet. Follow players to see their public decks change here.</p>
              : <ul className="feed">{data.feed.map((f) => <FeedRow key={f.changeId} f={f} seen={seen} />)}</ul>}
          </section>
          <section className="panel stack">
            {!data.me && <p className="chip warn">Pick a handle in <Link to="/settings">Settings</Link> so other players can find and follow you.</p>}
            {data.me && <p className="small muted" style={{ margin: 0 }}>You are <Link to={`/u/${data.me.handle}`}>@{data.me.handle}</Link>. Make a deck public from its More menu to show it to your followers.</p>}
            <FindPlayers />
            <h2>Following</h2>
            {data.following.length === 0
              ? <p className="muted small">You follow nobody yet.</p>
              : <ul className="plain-list">{data.following.map((p) => (
                  <li key={p.id} className="row"><Link to={`/u/${p.handle}`}>{who(p)}</Link>{p.displayName && <span className="muted small">@{p.handle}</span>}
                    <button type="button" className="small ghost" onClick={() => social.unfollow(p.id).then(reload)}>Unfollow</button></li>
                ))}</ul>}
          </section>
        </div>
      )}
    </>
  );
}

function FindPlayers() {
  const social = currentSocial()!;
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Profile[]>();
  useEffect(() => {
    if (q.trim().length < 2) { setFound(undefined); return; }
    let live = true;
    const t = setTimeout(() => social.findProfiles(q).then((r) => live && setFound(r), () => live && setFound([])), 300);
    return () => { live = false; clearTimeout(t); };
  }, [q, social]);
  return (
    <div className="stack" style={{ gap: '0.4rem' }}>
      <h2 style={{ margin: 0 }}>Find players</h2>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Handle, for example ash_k" aria-label="Find players by handle" />
      {found && (found.length === 0
        ? <p className="muted small">No players with a handle starting with “{q.trim()}”.</p>
        : <ul className="plain-list">{found.filter((p) => p.id !== social.userId).map((p) => <li key={p.id}><Link to={`/u/${p.handle}`}>{who(p)}</Link> <span className="muted small">@{p.handle}</span></li>)}</ul>)}
    </div>
  );
}

/** A player's public profile: their public decks and a follow button. */
export function ProfilePage() {
  const { handle = '' } = useParams();
  const social = currentSocial();
  const { data, error, reload } = useLoad(async () => {
    if (!social) return undefined;
    const p = await social.profile(handle);
    if (!p) return null;
    const [decks, followers, following] = await Promise.all([social.publicDecks(p.id), social.followerCount(p.id), social.following()]);
    return { p, decks, followers, isFollowing: following.some((f) => f.id === p.id) };
  }, [handle]);
  useTitle(data ? who(data.p) : `@${handle}`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();

  if (!social) return <Empty>Sign in to see players' public decks and follow them. <Link to="/settings">Sign in</Link></Empty>;
  if (error) return <Empty><ErrorBox error={error} /></Empty>;
  if (data === undefined) return <Loading />;
  if (data === null) return <Empty>No player is called @{handle}. <Link to="/activity">Find players</Link></Empty>;
  const { p, decks, followers, isFollowing } = data;
  const mine = p.id === social.userId;
  const toggle = async () => {
    setBusy(true);
    setActionError(undefined);
    try {
      await (isFollowing ? social.unfollow(p.id) : social.follow(p.id));
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="spread">
        <div>
          <h1 style={{ marginBottom: 0 }}>{who(p)}</h1>
          <p className="muted" style={{ marginTop: '0.2rem' }}>@{p.handle} · {followers} {followers === 1 ? 'follower' : 'followers'}</p>
        </div>
        {!mine && <button type="button" className={isFollowing ? '' : 'primary'} onClick={toggle} disabled={busy} aria-pressed={isFollowing}>{isFollowing ? 'Following' : 'Follow'}</button>}
      </div>
      <ErrorBox error={actionError} />
      <section className="panel stack">
        <h2>Public decks</h2>
        {decks.length === 0
          ? <p className="muted">{mine ? 'None yet. Open a deck and choose More → Make public.' : 'No public decks yet.'}</p>
          : <ul className="plain-list">{decks.map((d) => {
              const g = games().find((x) => x.id === d.game);
              return (
                <li key={d.id} className="row">
                  <Link to={`/u/${p.handle}/decks/${d.id}`}><strong>{d.name}</strong></Link>
                  {g && <GameBadge name={g.name} />}
                  {d.purpose && <span className="muted small">{d.purpose}</span>}
                  <span className="muted small">updated {new Date(d.updatedAt).toLocaleDateString()}</span>
                </li>
              );
            })}</ul>}
      </section>
    </>
  );
}
