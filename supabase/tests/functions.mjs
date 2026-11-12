// Checks the Supabase migration on an in-memory Postgres (PGlite): copy functions, constraints and triggers.
// Run: npm run test:sql
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
// Minimal stand-ins for Supabase's auth schema and roles.
await db.exec(`
create schema auth; create table auth.users (id uuid primary key);
create role authenticated; create role anon;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
insert into auth.users values ('00000000-0000-0000-0000-000000000001');
select set_config('test.uid', '00000000-0000-0000-0000-000000000001', false);
`);
for (const f of process.argv.slice(2)) await db.exec(readFileSync(f, 'utf8')); // migrations in order
const q = async (s) => (await db.query(s)).rows;
const deck = (await q(`insert into decks (game, name) values ('demo','Main') returning id`))[0].id;
await q(`select adjust_copies('demo', '[{"cardId":"a","location":"binder","delta":3}]')`);
await q(`select adjust_copies('demo', '[{"cardId":"a","location":"binder","delta":-2},{"cardId":"a","location":"${deck}","delta":2}]')`);
console.log('after move', await q(`select card_id, location = 'binder' as binder, qty from copies order by 2`));
for (const bad of [`[{"cardId":"a","location":"binder","delta":-5}]`, `[{"cardId":"zz","location":"binder","delta":-1}]`]) {
  await assert.rejects(q(`select adjust_copies('demo', '${bad}')`), 'overdraw must be rejected');
}
assert.deepEqual((await q(`select qty from copies order by qty`)).map((r) => r.qty), [1, 2], 'rejected moves change nothing');
await q(`insert into changes (deck_id, seq, lines) values ('${deck}', 1, '[]')`);
await q(`delete from decks where id = '${deck}'`);
assert.deepEqual(await q(`select location, qty from copies`), [{ location: 'binder', qty: 3 }], 'deleting a deck moves its copies to the binder');
assert.equal((await q(`select count(*)::int n from changes`))[0].n, 0);
// Account deletion: decks and copies cascade away without the binder trigger failing.
const d2 = (await q(`insert into decks (game, name) values ('demo','D2') returning id`))[0].id;
await q(`select adjust_copies('demo', '[{"cardId":"b","location":"${d2}","delta":2}]')`);
try {
  await q(`delete from auth.users where id = '00000000-0000-0000-0000-000000000001'`);
  assert.equal((await q(`select count(*)::int n from copies`))[0].n, 0);
} catch (e) { assert.fail('account delete failed: ' + e.message); }
console.log('Function checks passed');
