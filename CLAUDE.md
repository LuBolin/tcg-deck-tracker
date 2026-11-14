# Project rules: TCG Deck Tracker

Design doc: "TCG Deck Tracker — Design Document" (Claude Docs, https://claude.ai/artifact/VgeHf4LwTKwn3oFWWFRk8g). Core values: physical copy tracking, deck variants with reasons, missing-card status.

## Architecture

- `src/domain/` stays game-neutral and pure (no fetch, no storage, no React). Game rules live only in `src/games/<game>/`.
- All storage goes through `Repository` (`src/data/repository.ts`). The UI never touches IndexedDB or Supabase directly. Pick the backend only in `src/app/repo.ts`: Supabase when signed in, else IndexedDB (`repo` forwards to the chosen one; sign-in or sign-out reloads the page).
- Multi-step operations live in `src/app/actions.ts`, not in pages.
- The UI uses no version-control words: deck, variant, change, reason, "made from". Never branch, commit, merge or fork.

## UI map

- `src/ui/Shell.tsx` nav, footer, "/" shortcut · `DecksPage` overview, samples, backup nudge · `ImportPage` + `ListReader` (paste, file, URL, Fix these) · `CollectionPage` + `CollectionCardDialog` · `WantPage` (make, sell, check) · `SharePage` (`/share#d=`) · `SettingsPage` (backup, refresh, theme, delete all) · `HelpPage`.
- `src/ui/deck/`: `DeckPage` (summary, tabs, panels) with `CardList`, `CardDialog`, `EditList`, `DeckStats`, `GatherPanel`, `SharePanel`, `UpdateFromList`, `DeckParts` (purpose, log result, compare, make variant), `group.ts`, `deckGuide.ts`.
- Shared: `components.tsx` (chips, diff, copy button, tag picker, MoreMenu), `toast.tsx` (with Undo), `useGameChoice`, `useTitle`, `theme.ts`, `backup.ts`, `download.ts`, `text.ts`.

## Decisions (do not re-open without new evidence)

- Scope (2026-11-14): Pokémon only for now. `games()` lists Pokémon (plus the dev-only demo). The MTG, Yu-Gi-Oh!, Lorcana and One Piece adapters stay in the repo with their tests but are not listed, so the build leaves them out. The Game picker (`GameField`) hides while one game is listed; decks of an unlisted game are kept, left off the Decks page, and their page says the game is not shown. Build Pokémon features first; keep `src/domain/` game-neutral so other games can return. Colors stay as they are: a red accent would clash with red "missing" chips.
- Each change stores a full snapshot of the deck list; diffs are computed. Lists are small.
- Slot status is computed from the latest list and copy counts, never stored. Fill order: this deck, binder, other decks, then missing.
- "Unlimited" cards (`adapter.unlimited`, Pokémon basic Energy) count as in the deck and never missing, unless Settings → Basic cards turns tracking on (per browser, `src/app/supply.ts`). Every `slotStatuses`/`summarize` call passes `unlimitedFor(game)`.
- Card types for filters are `category`, `subtype` and `limitGroup` (`cardTypes` in `src/domain/cardText.ts`); role tags are for what a card does, not its type.
- Player settings (role names, basic-card tracking, last activity seen) go through `src/app/prefs.ts`: loaded once in `initRepo`, read synchronously, saved through `Repository.getPrefs/setPrefs` (IndexedDB key `prefs`, or table `user_prefs`). Not in backups.
- Version graph: lanes per deck in a family, rows per change in time order (`versionGraph` in `src/domain/variants.ts`). `Deck.originChangeId` records where a variant was made (never moves, unlike `parentChangeId`); `Change.sourceChangeId` records the parent change an applied change copies. Older data falls back to time order and the "change N" note.
- Social (signed in only, `src/data/social.ts`): `profiles` (public handle), `follows`, `decks.is_public`, and the `activity_feed` SQL function. The Activity nav badge counts feed items newer than the `activity-seen` pref.
- Google sign-in shows only when the Supabase project reports the provider enabled (`enabledProviders` reads `/auth/v1/settings`).
- Printing labels (`PrintRow`, table `prints`) say which owned copies are which print (alternate art, rarity). They are labels only: locations and every deck check use `CopyRow` totals, and a card's labels add up to at most its copies. The Collection shows them as rarity marks; the card dialog lists every printing (`adapter.printingsOf`).
- "Use the most common printing" on import keeps each card id and only swaps the shown printing (`adapter.commonPrinting`, lowest rarity first). Ownership never depends on the printing.
- Copies are counted per (game, card, location); location = `binder` or a deck id. No single-copy tracking; foil, condition and language are out of scope.
- Copy changes are all-or-nothing and refuse to go below zero (local and SQL). Deleting a deck moves its copies to the binder.
- Local storage: every write is read-modify-write in one IndexedDB transaction, and instances broadcast changes, so two tabs never overwrite each other (this lost data once).
- Variants hold `parentChangeId`; parent changes after it are applied or dismissed one at a time, in order.
- Card identity = "same in play". MTG: Scryfall `oracle_id`. Pokémon: Trainer/Energy by name; Pokémon by name + HP + attacks + abilities hash.
- Pokémon card data: TCGdex. pokemontcg.io returned 502 on 2026-11-12. Pokémon lists use TCG Live set codes, which match TCGdex `abbreviation.official`.
- Scryfall's batch lookup rejects "A // B" names; send the front face.
- Pokémon legality is per printing in TCGdex; a card counts as legal if any printing with the same functional id is. The deep check (`checkLegality`) runs only for cards whose stored printing says "not legal".
- Printing lookups must also match the line's name; otherwise fall back to a name lookup (a wrong set/number once swapped Krenko, Mob Boss for Krenko's Command).
- Copy limits count by card name across all sections (tournament rule); deck rules come from `GameAdapter.deckRules(format)`.
- Prices are USD market estimates for one printing: Scryfall `prices.usd`, TCGdex `pricing.tcgplayer.*.marketPrice`.
- Yu-Gi-Oh!: id = passcode; TCG banlist (`ban_tcg`) becomes `Card.maxCopies`; Extra Deck monsters go to the Extra Deck even in header-less lists. YGOPRODeck answers 400 when no requested name exists.
- Lorcana: id = "Name - Version" lowercased; Lorcast search does not match quoted full names, so search by words and match exactly.
- One Piece: id = card number (parallels share it); copy limit counts by card number (`copyKey: 'card'`); 1 Leader + exactly 50. Starter decks (ST) and promos (P-) use other API paths.
- Checked and rejected (no CORS, so browsers cannot call them): swu-db (Star Wars: Unlimited); digimoncard.io redirects to a Cloudflare page.
- Share links: `/share#d=<deflate-raw + base64url JSON>`; the hash never reaches a server. `decodeShare` validates every field (links come from anyone). A deck with history is about 1 KB, under Discord's 2000-character limit.
- Service worker (`public/sw.js`, production only): pages network-first, `/assets/` cache-first, other files network-first with cache fallback. Not verified in the desktop app's browser pane (it refuses service workers); check in Chrome.
- Game-specific rules that need card data go in `DeckRules.extraCheck` (MTG Commander color identity, Lorcana max 2 inks, One Piece Leader colors; all via `Card.identity`) or `groupLimits` (Pokémon ACE SPEC / Radiant). Unknown card data never produces a warning.
- Every save of a list carries `baseSeq` (edit, update from list, log a result); only "use this version again" saves a chosen old list on purpose.
- Adapter request caches forget failed requests (`memo` in the Pokémon adapter); a failed printing lookup falls back to the name lookup.
- Import defaults to "Check against my collection" (adds no copies); adding copies is an explicit choice.
- Parse errors keep their section; a retried line keeps the section the adapter chose (Leader, Extra Deck).
- Fixed sections: `GameAdapter.sectionFor(card)` (Yu-Gi-Oh! Extra Deck, One Piece Leader) applies when adding by search; import uses the same rule inside `resolve`.
- Deck URLs: `GameAdapter.importUrl`. Only play.limitlesstcg.com (Pokémon) works from a browser; Moxfield (403) and Archidekt (CORS for localhost:3000 only) do not.
- Set codes may start with a digit ("30C") but must contain a letter.
- Match records: 1-2 digit W-L(-D) not glued to other digits or dashes, so dates do not count.
- Parent changes are applied or dismissed oldest first only (`assertOldestPending`); skipping one would lose it.
- List edits remember the change they started from (`baseSeq`); saving after the deck changed is refused, so nothing is silently undone.
- Deck field updates go through `updateDeck` (re-reads the stored deck) so a stale page cannot undo a rename from another tab.
- Pokémon name-only lines: fetch every printing, sort newest set first (TCGdex returns them unordered), then pick.
- Card role tags ("draw", "removal", "gust") are computed from `Card.text` and type by `src/domain/cardText.ts` (common rules + `adapter.tagRules`), never stored, so better rules apply to cached cards. Rules match short phrases loosely (stemming, accents, typos, a word window); `not` phrases rule out look-alikes. Search uses the same matcher over name, tags and text.
- Deck labels (`Deck.labels`) are the player's own words for when to play a deck; `Deck.locked` puts a deck away (its copies are not gathered and collapse into one chip). "Empty decks" is computed: decks holding no copies.

## Commands

- `npm run dev` (port 5173), `npm test`, `npm run build`, `npx eslint .`
- `npm run test:sql`: checks the Supabase migration on PGlite (copy functions, constraints, triggers, account deletion) and row-level security with simulated users. Real Supabase auth and PostgREST are not covered.

## Deploy and live data

- Live site: https://lubolin.github.io/tcg-deck-tracker/ (GitHub Pages, `.github/workflows/deploy.yml`). Push to `main` = live. The user expects a deploy after changes. Push over ssh; `gh` is logged in.
- Supabase project `tdsetnriauohyanfzuzt` (URL and publishable key in `.env`). Migrations 0001-0006 are applied (0006 on 2026-11-14).
- Run each new `supabase/migrations/000N` file in the Supabase SQL editor BEFORE pushing app code that uses it. Method that worked: push the commit to a temp branch; in the dashboard SQL editor (browser pane) run `window.monaco.editor.getModels()[0].setValue(await (await fetch('https://raw.githubusercontent.com/LuBolin/tcg-deck-tracker/<sha>/supabase/migrations/<file>')).text())`, click Run, confirm the "destructive operations" warning (deletes inside `import_all`); push `main`; delete the temp branch.
- The user's account holds real decks ("crustle 1/2", "Sample: Dragapult ex"). Never use Delete all; clean up only your own test data.
- Never create accounts or enter secrets for the user (Google client secret, a second test account). Ask the user.
- Supabase's built-in email sender is rate-limited; set up custom SMTP before inviting other players.

## Working with the user

- They often work remotely (phone) and are not watching. Keep closing messages self-contained.
- They want things to work without manual entry; import formats come first.
- Variants are first-class with their own labels; the original deck is only the default.
- Card grouping follows exact game text (different Crustles stay separate).
- Sign-in panel wording is "Sign in or create an account" (they said the old one did not look like account creation).

## More decisions

- Printing labels: + labels an existing copy, or adds a new binder copy when every copy is labelled; - removes only the label.
- "Use the most common printing" on import is off by default.
- Printing in a deck (card dialog): a line's `set`/`number`/`imageUrl` pick the shown and exported printing, saved as a new change (`actions.setPrinting`). Display only; ownership and prices ignore it.
- Deck icon: `Deck.coverCardId` (column `cover_card_id`, migration 0006), set from the card dialog; falls back to the priciest card when unset or no longer in the list.
- Deck rename: tap the deck name (inline input; Enter saves, Esc cancels). The More menu's Rename opens the same input.

## Open work

- Google sign-in: app side done. Blocked on the user creating a Google Cloud OAuth client (Web app, redirect URI `https://tdsetnriauohyanfzuzt.supabase.co/auth/v1/callback`) and pasting ID and secret in Supabase > Auth > Providers > Google. They have step-by-step instructions and said "do other stuff first". Check: `curl https://tdsetnriauohyanfzuzt.supabase.co/auth/v1/settings -H "apikey: <publishable key>"` shows `"google":true`.
- Not tested live: profile, follow and public-deck writes (`saveProfile`, `follow`, `isPublic`; need a second account the user must create); Settings backup download / restore from file; "Copy this browser's data to my account" with real local data. Read paths were checked live; SQL and RLS are covered by `npm run test:sql`.
- Offered, user has not decided: lazy-load supabase-js (bundle ~145 -> 206 KB gz); per-print basic Energy counts; per-deck owned-print counts (a deck can show a printing, but owned print labels are collection-wide); dedupe effect-search results (one card repeats per printing); email/push notifications (only the Activity badge exists).
- Commits use the user's git identity. Their GitHub no-reply address was offered instead; no answer yet.

## Tooling gotchas

- The browser pane is often tiny: `resize_window` 1000x800, click by ref, verify with DOM/JS rather than screenshots.
- Stopping `npm run dev` with TaskStop leaves vite on port 5173. Stop it by port (PowerShell `Get-NetTCPConnection -LocalPort 5173`).
- Python heredocs in Bash break on quotes. Write edit scripts to the scratchpad and run them.
- TCGdex can search Trainer/Energy rule text (`effect=like:`) but not attack or ability text.
