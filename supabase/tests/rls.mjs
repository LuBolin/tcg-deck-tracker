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
await db.exec(readFileSync(process.argv[2], 'utf8'));
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
console.log('RLS checks passed');

