# TCG Deck Tracker

A deck manager for physical trading card game players. It tracks:

- **Deck variants with reasons.** Every save is a change with a card diff, reason tags, a note and an optional match result. Variants remember the deck they were made from and can apply its later changes.
- **Physical copies.** Every owned copy is in one place: the binder or one deck. Each card slot shows *in deck*, *in binder*, *in another deck* or *missing*.
- **Missing cards.** Decks stay full size; missing slots are flagged. Want-lists turn them into a plain-text message for community chats, which other players paste back in to see what they can sell.

Also included:

| Area | Features |
| --- | --- |
| Decks | "When to play this" note (also asked when making a variant), card filter (missing / not in deck), custom reason tags, log a match result (W-L record per deck and variant), compare any two decks, compare an old version with now, restore an old version, filter history by tag, update from a newer pasted list, duplicate as an independent copy |
| Cards | Images (hover, image grid, card dialog), market prices (deck value, cost to complete), "also played in" other decks |
| Rules | Deck size, copy limits, banlists, format legality, Commander singleton and color identity, Pokémon ACE SPEC/Radiant limits and at least one Basic, Lorcana two-ink limit, One Piece Leader colors |
| Stats | Category and subtype makeup, cost curve with average, opening-hand odds (single cards or any of several) |
| Physical cards | Gather panel to rebuild a deck from the binder and other decks (with undo), "I got N copies", collection with "needed by", missing filter, sorting and a card dialog |
| Import / export | Pasted lists, collection CSV import and export (ManaBox, Moxfield, Dragon Shield, TCGplayer columns), Limitless deck URLs, game auto-detect, progress for long lists, `.ydk` export and download, list with change notes |
| Sharing | Share links that carry the deck and its reasons inside the URL (no server; readers see what they are missing and can save a copy), want-lists and selling lists for community chats |
| Appearance | Light, dark or match the system |
| Help | In-app Help page explaining card statuses, variants, want-lists, sharing and shortcuts |
| Safety | Two-tab-safe local storage, refresh all card data, backup/restore, backup reminder, typed confirmation before deleting everything |

Games (card data, all free and keyless):

| Game | Source | Same-in-play id | List formats |
| --- | --- | --- | --- |
| Pokémon | [TCGdex](https://tcgdex.dev) | name (+ HP/attacks/abilities for Pokémon) | Pokémon TCG Live / Limitless text, or a play.limitlesstcg.com player decklist URL |
| Magic: The Gathering | [Scryfall](https://scryfall.com/docs/api) | `oracle_id` | MTG Arena, plain text, MTGO blank-line sideboard |
| Yu-Gi-Oh! | [YGOPRODeck](https://ygoprodeck.com/api-guide/) | passcode | Main/Extra/Side text, `.ydk` |
| Disney Lorcana | [Lorcast](https://lorcast.com/docs/api) | name + version | Dreamborn / Inktable / Pixelborn text |
| One Piece | [OPTCG API](https://optcgapi.com) | card number | `4xOP01-016` (OPTCGSim and deck sites) |

The core is game-neutral; collection CSVs work for every game.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # domain, storage and adapter tests
npm run test:sql # Supabase schema, functions and row-level security on an in-memory Postgres
npm run build
```

Data is stored in the browser (IndexedDB) until Supabase is connected. Settings → Download backup exports everything as JSON.

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml`: tests, build, then GitHub Pages at https://lubolin.github.io/tcg-deck-tracker/. Builds use the base path `/tcg-deck-tracker/` (`vite.config.ts`); the workflow copies `index.html` to `404.html` so deep links such as `/decks/…` open. Another host needs that base path changed and an SPA fallback to `index.html`.

## Structure

| Path | What it holds |
| --- | --- |
| `src/domain/` | Game-neutral rules: deck lists and diffs, slot status, copies, variants, list parsing, want-lists. No I/O. |
| `src/games/` | One adapter per game (`GameAdapter` in `types.ts`): list format, export, card lookup, search. `demo/` is an offline game for tests and dev. |
| `src/data/` | `Repository` interface and the local IndexedDB implementation. |
| `src/app/` | Use cases (`actions.ts`) that combine domain rules with storage; the repository choice (`repo.ts`). |
| `src/ui/` | React pages. |
| `supabase/migrations/` | Postgres schema, row-level security and functions for the Supabase backend. |

## Add a game

1. Write `src/games/<game>/index.ts` implementing `GameAdapter`: `source`, sections, categories, `deckRules(format)`, `listFormat` (and `preprocess` for non-line formats), `formatLine`/`formatList`, `resolve` and `search`. The card `id` must be the same for printings that are the same in play. Fill `price`, `legal`, `cost` and `maxCopies` (banlist) on cards when the source has them.
2. Add it to the list in `src/games/index.ts`.
3. Add tests with a fake fetch, like `src/games/games.test.ts`.

## Supabase

Signed-out users keep data in the browser. Signed-in users (email link) store it in Supabase through `src/data/supabaseRepository.ts`; `src/app/repo.ts` picks the storage before the first render. Settings → Account can copy the browser's data into the account.

Setup:

1. Put the project URL and the **publishable** key in `.env` (both are public; never the secret key).
2. In the SQL editor, run `supabase/migrations/0001_init.sql`, then `0002_import_all.sql`.
3. Authentication → URL Configuration: Site URL `https://lubolin.github.io/tcg-deck-tracker/`; redirect URLs that URL plus `http://localhost:5173/`.
4. Supabase's built-in email sender is rate-limited and meant for testing; set up custom SMTP before inviting other players.

Field map for `SupabaseRepository` (camelCase in the app, snake_case in SQL):

| App type | Table | Notes |
| --- | --- | --- |
| `Deck` | `decks` | `parentDeckId` → `parent_deck_id`, `parentChangeId` → `parent_change_id`, `owner_id` defaults to `auth.uid()` |
| `Change` | `changes` | `lines` is JSON (`DeckLine[]`); `(deck_id, seq)` is unique, so a lost race on the next `seq` fails instead of overwriting |
| `CopyRow` | `copies` | write only through `adjust_copies(p_game, p_deltas)`, which is all-or-nothing |
| `Card` | `cards` | shared cache; `set` → `set_code`, `imageUrl` → `image_url`, `maxCopies` → `max_copies`, `limitGroup` → `limit_group`, `fetchedAt` → `updated_at` |
| `Repository.importAll` | `import_all(p_backup)` | replaces the user's data in one transaction |
| `Repository.deleteDeck` | `decks` delete | the `decks_copies_to_binder` trigger moves the deck's copies to the binder |

## Next steps

1. **Supabase**: write `SupabaseRepository` (field map above), add sign-in, switch `src/app/repo.ts`. Then public deck pages can use `is_public` instead of share links.
2. **A small server function** (for example a Supabase Edge Function) unlocks sources that block browser requests: Star Wars: Unlimited (swu-db, no CORS), Moxfield and Archidekt deck URLs, Digimon (digimoncard.io).
3. **Dev tooling**: vitest's remaining audit advisory needs a major upgrade (vitest 5); it affects only the test runner, not the app.
4. **Offline**: the service worker in `public/sw.js` is untested in a real browser (the desktop app's preview refuses service workers); check it in Chrome after a production build.
