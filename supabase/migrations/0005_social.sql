-- Social: public profiles, follows and an activity feed of followed players' public decks.
-- Also: settings that follow the player, and the fields the version graph draws from.

-- Version graph: the change a variant was made from (never moves), and the parent change an applied change copies.
-- Plain ids, no foreign keys: a missing target only loses a line in the graph.
alter table public.decks add column origin_change_id uuid;
alter table public.changes add column source_change_id uuid;

-- Settings that follow the player across devices (role names, basic-card tracking, last activity seen).
create table public.user_prefs (
  owner_id uuid primary key default auth.uid() references auth.users on delete cascade,
  prefs jsonb not null default '{}'
);
alter table public.user_prefs enable row level security;
create policy user_prefs_owner on public.user_prefs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Public profile: a handle others can find and follow. Readable by everyone.
create table public.profiles (
  id uuid primary key default auth.uid() references auth.users on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name text check (char_length(display_name) <= 40),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy profiles_read on public.profiles for select using (true);
create policy profiles_own_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_own_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_own_delete on public.profiles for delete to authenticated using (id = auth.uid());

create table public.follows (
  follower_id uuid not null default auth.uid() references auth.users on delete cascade,
  followee_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
alter table public.follows enable row level security;
-- Who I follow, and who follows me.
create policy follows_read on public.follows for select to authenticated using (follower_id = auth.uid() or followee_id = auth.uid());
create policy follows_own_insert on public.follows for insert to authenticated with check (follower_id = auth.uid());
create policy follows_own_delete on public.follows for delete to authenticated using (follower_id = auth.uid());

-- Changes to public decks of players I follow, newest first. Row-level security still applies (security invoker).
create or replace function public.activity_feed(p_limit int default 50)
returns table (change_id uuid, deck_id uuid, deck_name text, game text, owner_id uuid, handle text, display_name text,
               seq int, note text, tags text[], result text, created_at timestamptz)
language sql
stable
security invoker
as $$
  select c.id, d.id, d.name, d.game, d.owner_id, p.handle, p.display_name, c.seq, c.note, c.tags, c.result, c.created_at
  from public.follows f
  join public.decks d on d.owner_id = f.followee_id and d.is_public
  join public.changes c on c.deck_id = d.id
  left join public.profiles p on p.id = d.owner_id
  where f.follower_id = auth.uid()
  order by c.created_at desc
  limit least(greatest(p_limit, 1), 200);
$$;

-- import_all again, now restoring is_public and the version graph fields.
create or replace function public.import_all(p_backup jsonb)
returns void
language plpgsql
security invoker
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;

  -- The delete trigger moves deck copies to the binder; then the binder goes too.
  delete from public.decks where owner_id = auth.uid();
  delete from public.copies where owner_id = auth.uid();
  delete from public.prints where owner_id = auth.uid();

  -- Parent links are set after every deck and change exists, and only when the target is in the backup.
  insert into public.decks (id, game, name, format, purpose, labels, locked, is_public, created_at, updated_at)
  select (d->>'id')::uuid, d->>'game', d->>'name', d->>'format', d->>'purpose',
         coalesce(array(select jsonb_array_elements_text(d->'labels')), '{}'), coalesce((d->>'locked')::boolean, false), coalesce((d->>'isPublic')::boolean, false),
         coalesce((d->>'createdAt')::timestamptz, now()), coalesce((d->>'updatedAt')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_backup->'decks', '[]')) d;

  insert into public.changes (id, deck_id, seq, created_at, lines, tags, note, result, source_change_id)
  select (c->>'id')::uuid, (c->>'deckId')::uuid, (c->>'seq')::int, coalesce((c->>'createdAt')::timestamptz, now()),
         coalesce(c->'lines', '[]'),
         coalesce(array(select jsonb_array_elements_text(c->'tags')), '{}'),
         coalesce(c->>'note', ''), coalesce(c->>'result', ''), (c->>'sourceChangeId')::uuid
  from jsonb_array_elements(coalesce(p_backup->'changes', '[]')) c;

  update public.decks x
  set parent_deck_id = case when exists (select 1 from public.decks p where p.id = (d->>'parentDeckId')::uuid and p.owner_id = auth.uid())
                            then (d->>'parentDeckId')::uuid end,
      parent_change_id = case when exists (select 1 from public.changes c where c.id = (d->>'parentChangeId')::uuid and c.deck_id = (d->>'parentDeckId')::uuid)
                              then (d->>'parentChangeId')::uuid end,
      origin_change_id = (d->>'originChangeId')::uuid
  from jsonb_array_elements(coalesce(p_backup->'decks', '[]')) d
  where x.id = (d->>'id')::uuid and (d ? 'parentDeckId');

  insert into public.copies (owner_id, game, card_id, location, qty)
  select auth.uid(), r->>'game', r->>'cardId', r->>'location', sum((r->>'qty')::int)
  from jsonb_array_elements(coalesce(p_backup->'copies', '[]')) r
  where (r->>'qty')::int > 0
  group by 2, 3, 4;

  insert into public.prints (owner_id, game, card_id, print_id, qty, rarity, set_code, number, image_url)
  select auth.uid(), p->>'game', p->>'cardId', p->>'printId', max((p->>'qty')::int),
         max(p->>'rarity'), max(p->>'set'), max(p->>'number'), max(p->>'imageUrl')
  from jsonb_array_elements(coalesce(p_backup->'prints', '[]')) p
  where (p->>'qty')::int > 0
  group by 2, 3, 4;

  insert into public.cards as k (game, id, name, category, subtype, set_code, number, image_url, price, legal, cost, max_copies, identity, limit_group, text, updated_at)
  select c->>'game', c->>'id', c->>'name', c->>'category', c->>'subtype', c->>'set', c->>'number', c->>'imageUrl',
         (c->>'price')::numeric, case when c ? 'legal' then array(select jsonb_array_elements_text(c->'legal')) end,
         (c->>'cost')::numeric, (c->>'maxCopies')::int,
         case when c ? 'identity' then array(select jsonb_array_elements_text(c->'identity')) end,
         c->>'limitGroup', c->>'text', coalesce((c->>'fetchedAt')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_backup->'cards', '[]')) c
  on conflict (game, id) do update set
    name = excluded.name, category = excluded.category, subtype = excluded.subtype, set_code = excluded.set_code,
    number = excluded.number, image_url = excluded.image_url, price = excluded.price, legal = excluded.legal,
    cost = excluded.cost, max_copies = excluded.max_copies, identity = excluded.identity,
    limit_group = excluded.limit_group, text = excluded.text, updated_at = excluded.updated_at
  where k.updated_at <= excluded.updated_at;
end;
$$;
