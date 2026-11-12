import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { createDeck } from '../app/actions';
import { readList, toDeckLines } from '../app/importing';
import { repo } from '../app/repo';
import { useLoad } from '../app/useLoad';
import { countCards } from '../domain/decklist';
import { coverArt, deckValue, formatRecord, formatUsd, totalRecord, type MatchRecord } from '../domain/insights';
import { slotStatuses, summarize, type DeckSummary } from '../domain/status';
import type { DeckLine } from '../domain/types';
import { deckTree, type DeckNode } from '../domain/variants';
import { games } from '../games';
import { validateDeck } from '../domain/rules';
import type { GameAdapter } from '../games/types';
import { Empty, ErrorBox, GameBadge, Loading } from './components';
import { plural } from './text';
import { useToast } from './toast';
import { shouldNudgeBackup, snoozeBackupNudge } from './backup';
import { useTitle } from './useTitle';

const getGameOrNull = (id: string) => games().find((g) => g.id === id);

interface DeckInfo { summary: DeckSummary; mainCount: number; value: number; cover?: string; lastNote?: string; record: MatchRecord; issues: number }

async function load() {
  const decks = await repo.listDecks();
  const info = new Map<string, DeckInfo>();
  for (const g of new Set(decks.map((d) => d.game))) {
    const copies = await repo.listCopies(g);
    const gameDecks = decks.filter((d) => d.game === g);
    const linesByDeck = new Map<string, DeckLine[]>();
    const notes = new Map<string, string>();
    const records = new Map<string, MatchRecord>();
    for (const d of gameDecks) {
      const changes = await repo.listChanges(d.id);
      linesByDeck.set(d.id, changes.at(-1)?.lines ?? []);
      const last = [...changes].reverse().find((c) => c.note && c.seq > 1);
      if (last) notes.set(d.id, last.note);
      records.set(d.id, totalRecord(changes.map((c) => c.result)));
    }
    const ids = [...new Set([...linesByDeck.values()].flat().map((l) => l.cardId))];
    const cards = new Map((await repo.getCards(g, ids)).map((c) => [c.id, c]));
    for (const d of gameDecks) {
      const lines = linesByDeck.get(d.id)!;
      info.set(d.id, {
        summary: summarize(d.id, lines, copies),
        mainCount: countCards(lines, 'main'),
        value: deckValue(lines, cards, slotStatuses(d.id, lines, copies)).total,
        cover: coverArt(lines, cards),
        lastNote: notes.get(d.id),
        record: records.get(d.id)!,
        issues: getGameOrNull(g) ? validateDeck(lines, getGameOrNull(g)!.deckRules(d.format), cards).length : 0,
      });
    }
  }
  return { decks, info };
}


type Sort = 'name' | 'recent' | 'missing';
const SORT_KEY = 'decks-sort';

export function DecksPage() {
  const { data, error, reload } = useLoad(load, []);
  useTitle("Decks");
  const [query, setQuery] = useState('');
  const [nudge, setNudge] = useState(true);
  const [sort, setSort] = useState<Sort>(() => {
    try { return (localStorage.getItem(SORT_KEY) as Sort) || 'name'; } catch { return 'name'; }
  });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  const q = query.trim().toLowerCase();
  const showNudge = nudge && shouldNudgeBackup(data.decks.length);
  const compare = (a: DeckNode, b: DeckNode) =>
    sort === 'recent' ? b.deck.updatedAt.localeCompare(a.deck.updatedAt)
    : sort === 'missing' ? data.info.get(b.deck.id)!.summary.missing - data.info.get(a.deck.id)!.summary.missing
    : a.deck.name.localeCompare(b.deck.name);
  /** Sort every level; when searching, keep decks that match or have a matching variant. */
  const arrange = (nodes: DeckNode[]): DeckNode[] =>
    nodes
      .map((n) => ({ ...n, children: arrange(n.children) }))
      .filter((n) => !q || n.deck.name.toLowerCase().includes(q) || n.children.length > 0)
      .sort(compare);
  const byGame = games()
    .map((g) => ({ game: g, total: data.decks.filter((d) => d.game === g.id).length, roots: arrange(deckTree(data.decks.filter((d) => d.game === g.id))) }))
    .filter((x) => x.total > 0);
  const chooseSort = (v: Sort) => {
    setSort(v);
    try { localStorage.setItem(SORT_KEY, v); } catch { /* per-viewer convenience only */ }
  };

  const row = (n: DeckNode): React.ReactNode => {
    const i = data.info.get(n.deck.id)!;
    return (
      <li key={n.deck.id}>
        <Link to={`/decks/${n.deck.id}`} className="deck-row deck-link">
          <span className="deck-cover" aria-hidden>{i.cover && <img src={i.cover} alt="" loading="lazy" />}</span>
          <span className="deck-main">
            <span className="deck-name">{n.deck.name}</span>
            <span className="muted small">
              {[n.deck.format, plural(i.mainCount, 'card'), i.value > 0 ? formatUsd(i.value) : undefined, i.record.events ? `record ${formatRecord(i.record)}` : undefined].filter(Boolean).join(' · ')}
            </span>
            {n.deck.purpose
              ? <span className="small last-note">When: {n.deck.purpose}</span>
              : i.lastNote && <span className="muted small last-note">“{i.lastNote}”</span>}
          </span>
          <span className="row deck-chips">
            {i.summary.missing > 0 ? <span className="chip bad">{i.summary.missing} missing</span> : <span className="chip ok">complete</span>}
            {i.summary.inOtherDecks > 0 && <span className="chip warn">{i.summary.inOtherDecks} in other decks</span>}
            {i.summary.inBinder > 0 && <span className="chip info">{i.summary.inBinder} in binder</span>}
            {i.issues > 0 && <span className="chip warn">{plural(i.issues, 'rule problem')}</span>}
          </span>
        </Link>
        {n.children.length > 0 && <ul className="deck-tree">{n.children.map(row)}</ul>}
      </li>
    );
  };

  return (
    <>
      <div className="spread">
        <h1>Your decks</h1>
        <Link className="btn primary" to="/import">Import a deck</Link>
      </div>
      {byGame.length === 0 && <Welcome onCreated={reload} />}
      {showNudge && (
        <div className="notice spread">
          <span>Your decks are saved only in this browser. Download a backup so clearing site data cannot erase them.</span>
          <span className="row">
            <Link className="btn small primary" to="/settings">Back up now</Link>
            <button type="button" className="small" onClick={() => { snoozeBackupNudge(); setNudge(false); }}>Later</button>
          </span>
        </div>
      )}
      {data.decks.length > 3 && (
        <div className="row" style={{ marginBottom: '0.75rem' }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a deck" aria-label="Find a deck" style={{ flex: 1, minWidth: '10rem' }} />
          <select value={sort} onChange={(e) => chooseSort(e.target.value as Sort)} aria-label="Sort decks">
            <option value="name">By name</option>
            <option value="recent">Recently changed</option>
            <option value="missing">Most missing</option>
          </select>
        </div>
      )}
      {byGame.map(({ game, roots, total }) => (
        <section key={game.id} className="panel">
          <div className="row" style={{ marginBottom: '0.5rem' }}>
            <GameBadge name={game.name} />
            <span className="muted small">{plural(total, 'deck')} · indented decks are variants</span>
          </div>
          {roots.length ? <ul className="deck-tree">{roots.map(row)}</ul> : <p className="muted small">No deck names match.</p>}
        </section>
      ))}
    </>
  );
}

const SAMPLES: Record<string, { name: string; format: string; list: string }> = {
  pokemon: {
    name: 'Sample: Dragapult ex',
    format: 'Expanded',
    list: '4 Dreepy TWM 128\n4 Drakloak TWM 129\n3 Dragapult ex TWM 130\n2 Budew PRE 4\n4 Arven\n4 Iono\n4 Professor\'s Research\n4 Buddy-Buddy Poffin\n4 Ultra Ball\n4 Nest Ball\n4 Rare Candy\n3 Night Stretcher\n2 Super Rod\n2 Counter Catcher\n2 Boss\'s Orders\n6 Basic {R} Energy\n4 Basic {P} Energy',
  },
  yugioh: {
    name: 'Sample: Blue-Eyes',
    format: 'Advanced',
    list: 'Main Deck\n3 Blue-Eyes White Dragon\n3 Sage with Eyes of Blue\n3 Dictator of D.\n2 Blue-Eyes Alternative White Dragon\n3 Maiden of White\n1 Dragon Spirit of White\n3 Ash Blossom & Joyous Spring\n3 The Melody of Awakening Dragon\n3 Trade-In\n3 Bingo Machine, Go!!!\n2 Return of the Dragon Lords\n3 Pot of Desires\n1 Monster Reborn\n1 Harpie\'s Feather Duster\n3 Infinite Impermanence\n3 Called by the Grave\n\nExtra Deck\n1 Blue-Eyes Twin Burst Dragon\n1 Accesscode Talker',
  },
  lorcana: {
    name: 'Sample: Lorcana mix (shows rule warnings)',
    format: 'Core',
    list: '4 Elsa - Spirit of Winter\n4 Mickey Mouse - Brave Little Tailor\n4 Be Prepared\n4 Dinglehopper\n4 Friends on the Other Side\n4 Stitch - Rock Star\n4 Simba - Protective Cub\n4 Moana - Of Motunui\n4 Maleficent - Monstrous Dragon\n4 Hades - King of Olympus\n4 Let It Go\n4 Magic Broom - Bucket Brigade\n4 Rapunzel - Gifted with Healing\n4 Gaston - Arrogant Hunter\n4 Belle - Strange but Special',
  },
  onepiece: {
    name: 'Sample: Red Zoro',
    format: 'Standard',
    list: '1xOP01-001\n4xOP01-004\n4xOP01-006\n4xOP01-013\n4xOP01-015\n4xOP01-016\n4xOP01-017\n4xOP01-021\n4xOP01-022\n4xOP01-024\n4xOP01-025\n4xOP01-026\n4xOP01-029\n2xOP01-030',
  },
  mtg: {
    name: 'Sample: Mono-Red Burn',
    format: 'Modern',
    list: 'Deck\n4 Monastery Swiftspear\n4 Goblin Guide\n4 Lightning Bolt\n4 Lava Spike\n4 Rift Bolt\n4 Skewer the Critics\n4 Boros Charm\n4 Light Up the Stage\n4 Eidolon of the Great Revel\n4 Skullcrack\n2 Fireblast\n18 Mountain\n\nSideboard\n2 Smash to Smithereens',
  },
};

function Welcome({ onCreated }: { onCreated: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState<string>();
  const trySample = async (adapter: GameAdapter) => {
    const sample = SAMPLES[adapter.id];
    setBusy(adapter.id);
    try {
      const { resolved } = await readList(adapter, sample.list);
      const deck = await createDeck(repo, { game: adapter.id, name: sample.name, format: sample.format, lines: toDeckLines(resolved) });
      const skipped = resolved.filter((r) => !r.card).length;
      toast(`Sample deck added${skipped ? ` (${skipped} lines not found)` : ''}. Its cards show as missing until you add copies.`);
      onCreated();
      navigate(`/decks/${deck.id}`);
    } catch (e) {
      toast(`Could not load the sample: ${e instanceof Error ? e.message : e}`, 'bad');
      setBusy(undefined);
    }
  };
  return (
    <Empty>
      <h2>Track your decks, your cards, and why you changed them</h2>
      <ol className="welcome-steps">
        <li><strong>Import</strong> a deck list you already have. Cards you do not own stay in the deck, flagged as missing.</li>
        <li><strong>Edit</strong> with a reason. Make variants for other metas or a budget build.</li>
        <li><strong>See where every card is</strong> and post a want-list for what you are missing.</li>
      </ol>
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link className="btn primary" to="/import">Import your first deck</Link>
      </div>
      <p className="small" style={{ margin: '1.25rem 0 0.5rem' }}>Or look around with a sample deck:</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        {games().filter((g) => SAMPLES[g.id]).map((g) => (
          <button key={g.id} type="button" className="small" onClick={() => trySample(g)} disabled={!!busy}>
            {busy === g.id ? 'Loading…' : g.name}
          </button>
        ))}
      </div>
    </Empty>
  );
}
