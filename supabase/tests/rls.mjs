// Checks row-level security: one user cannot read or change another user's data; public decks are readable.
// Run: npm run test:sql
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b';
await db.exec(`
create schema auth; create table auth.users (id uuid primary key);
create role authenticated; create role anon;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
insert into auth.users values ('${A}'), ('${B}');
`);
for (const f of process.argv.slice(2)) await db.exec(readFileSync(f, 'utf8')); // migrations in order
await db.exec(`grant usage on schema public, auth to authenticated, anon;
grant all on all tables in schema public to authenticated; grant select on all tables in schema public to anon;
grant execute on all functions in schema public, auth to authenticated, anon;`);
const as = async (uid, role, sql) => {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); set role ${role};`);
  try { return (await db.query(sql)).rows; } catch (e) { return 'ERROR: ' + e.message; } finally { await db.exec('reset role'); }
};
const deckA = (await as(A, 'authenticated', `insert into decks (game, name) values ('demo', 'A private') returning id`))[0].id;
const pubA = (await as(A, 'authenticated', `insert into decks (game, name, is_public) values ('demo', 'A public', true) returning id`))[0].id;
await as(A, 'authenticated', `insert into changes (deck_id, seq, lines) values ('${deckA}', 1, '[]'), ('${pubA}', 1, '[]')`);
await as(A, 'authenticated', `select adjust_copies('demo', '[{"cardId":"x","location":"binder","delta":3}]')`);
console.log('A sees own decks:', (await as(A, 'authenticated', 'select name from decks order by name')).map((r) => r.name));
console.log('B sees decks:', (await as(B, 'authenticated', 'select name from decks order by name')).map((r) => r.name));
console.log('B sees changes:', (await as(B, 'authenticated', 'select count(*)::int n from changes'))[0].n, '(only the public deck)');
console.log('B sees copies:', (await as(B, 'authenticated', 'select count(*)::int n from copies'))[0].n);
console.log('B edits A deck:', await as(B, 'authenticated', `update decks set name = 'hacked' where id = '${deckA}' returning id`));
console.log('B adds change to A deck:', await as(B, 'authenticated', `insert into changes (deck_id, seq, lines) values ('${deckA}', 2, '[]')`));
console.log('B inserts deck as A:', await as(B, 'authenticated', `insert into decks (owner_id, game, name) values ('${A}', 'demo', 'spoof')`));
console.log('anon sees decks:', (await as(null, 'anon', 'select name from decks')).map?.((r) => r.name));
console.log('A deck name still:', (await as(A, 'authenticated', `select name from decks where id = '${deckA}'`))[0].name);

// Fail loudly if any isolation rule breaks.
assert.deepEqual((await as(B, 'authenticated', 'select name from decks order by name')).map((r) => r.name), ['A public']);
assert.equal((await as(B, 'authenticated', 'select count(*)::int n from copies'))[0].n, 0);
assert.deepEqual(await as(B, 'authenticated', `update decks set name = 'hacked' where id = '${deckA}' returning id`), []);
assert.match(String(await as(B, 'authenticated', `insert into changes (deck_id, seq, lines) values ('${deckA}', 3, '[]')`)), /row-level security/);
assert.match(String(await as(B, 'authenticated', `insert into decks (owner_id, game, name) values ('${A}', 'demo', 'spoof')`)), /row-level security/);
assert.deepEqual((await as(null, 'anon', 'select name from decks')).map((r) => r.name), ['A public']);
// import_all replaces only the caller's data, in one transaction, and keeps valid parent links.
const P = '10000000-0000-0000-0000-000000000001', V = '10000000-0000-0000-0000-000000000002', C1 = '20000000-0000-0000-0000-000000000001';
const backup = (extra = {}) => JSON.stringify({ version: 1,
  decks: [{ id: P, game: 'demo', name: 'Parent', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
          { id: V, game: 'demo', name: 'Variant', labels: ['budget'], locked: true, parentDeckId: P, parentChangeId: C1, createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' }],
  changes: [{ id: C1, deckId: P, seq: 1, createdAt: '2026-01-01T00:00:00Z', lines: [{ cardId: 'x', name: 'X', qty: 2, section: 'main' }], tags: ['new'], note: 'first', result: '' }],
  copies: [{ game: 'demo', cardId: 'x', location: P, qty: 2 }, { game: 'demo', cardId: 'x', location: 'binder', qty: 1 }],
  cards: [{ game: 'demo', id: 'x', name: 'X', legal: ['standard'], price: 1.5, text: 'Draw a card.' }], ...extra }).replaceAll("'", "''");
assert.doesNotMatch(String(await as(B, 'authenticated', `select import_all('${backup()}')`)), /ERROR/);
assert.deepEqual(await as(B, 'authenticated', `select name, parent_deck_id, parent_change_id from decks order by name`), [
  { name: 'A public', parent_deck_id: null, parent_change_id: null },
  { name: 'Parent', parent_deck_id: null, parent_change_id: null },
  { name: 'Variant', parent_deck_id: P, parent_change_id: C1 },
], 'B sees its imported decks and A\'s public deck');
assert.deepEqual((await as(B, 'authenticated', `select qty from copies order by qty`)).map((r) => r.qty), [1, 2]);
assert.deepEqual((await as(A, 'authenticated', `select name from decks where owner_id = '${A}' order by name`)).map((r) => r.name), ['A private', 'A public'], 'A is untouched');
// A failing import (change for a missing deck) leaves everything as it was.
assert.deepEqual(await as(B, 'authenticated', `select text from cards where id = 'x'`), [{ text: 'Draw a card.' }], 'card text is restored');
assert.deepEqual(await as(B, 'authenticated', `select labels, locked from decks where id = '${V}'`), [{ labels: ['budget'], locked: true }], 'labels and locked are restored');
const bad = backup({ changes: [{ id: '20000000-0000-0000-0000-000000000009', deckId: '10000000-0000-0000-0000-000000000099', seq: 1, lines: [], tags: [] }] });
assert.match(String(await as(B, 'authenticated', `select import_all('${bad}')`)), /ERROR/);
assert.equal((await as(B, 'authenticated', `select count(*)::int n from decks where owner_id = '${B}'`))[0].n, 2, 'failed import rolls back');
// Empty backup = delete all of B's data.
await as(B, 'authenticated', `select import_all('{"version":1,"decks":[],"changes":[],"copies":[],"cards":[]}')`);
assert.equal((await as(B, 'authenticated', `select count(*)::int n from copies`))[0].n, 0);
assert.match(String(await as(null, 'anon', `select import_all('{}')`)), /Sign in first/);
// Printing labels: private to their owner, restored by import_all, cleared with the rest.
await as(B, 'authenticated', `select import_all('{"version":1,"decks":[],"changes":[],"copies":[{"game":"demo","cardId":"x","location":"binder","qty":2}],"cards":[],"prints":[{"game":"demo","cardId":"x","printId":"s-186","qty":1,"rarity":"Illustration rare"}]}')`);
assert.deepEqual(await as(B, 'authenticated', `select print_id, qty, rarity from prints`), [{ print_id: 's-186', qty: 1, rarity: 'Illustration rare' }]);
assert.deepEqual(await as(A, 'authenticated', `select * from prints`), [], 'A cannot see B\'s printings');
assert.match(String(await as(A, 'authenticated', `insert into prints (owner_id, game, card_id, print_id, qty) values ('${B}', 'demo', 'x', 'p', 1)`)), /row-level security/);
await as(B, 'authenticated', `select import_all('{"version":1,"decks":[],"changes":[],"copies":[],"cards":[]}')`);
assert.equal((await as(B, 'authenticated', `select count(*)::int n from prints`))[0].n, 0, 'old backups without prints clear them');
console.log('RLS checks passed');

