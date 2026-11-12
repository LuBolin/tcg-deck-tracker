-- TCG Deck Tracker: initial schema. Game-neutral: `game` is a text id ('pokemon', 'mtg', ...).
-- Mirrors src/domain/types.ts and the Repository interface in src/data/repository.ts.

create table public.decks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  game text not null,
  name text not null,
  format text,
  purpose text,
  parent_deck_id uuid references public.decks on delete set null,
  parent_change_id uuid,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index decks_owner_idx on public.decks (owner_id);

-- Every save of a deck: a full snapshot of the list plus the reason for the change.
create table public.changes (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks on delete cascade,
  seq int not null check (seq > 0),
  created_at timestamptz not null default now(),
  lines jsonb not null,           -- DeckLine[]
  tags text[] not null default '{}',
  note text not null default '',
  result text not null default '',
  unique (deck_id, seq)
);

alter table public.decks
  add constraint decks_parent_change_fk foreign key (parent_change_id)
  references public.changes on delete set null;

-- Physical copies: a count per card per location. location = 'binder' or a deck id.
create table public.copies (
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  game text not null,
  card_id text not null,
  location text not null,
  qty int not null check (qty >= 0),
  primary key (owner_id, game, card_id, location)
);

-- Shared card-data cache filled from each game's public card source.
create table public.cards (
  game text not null,
  id text not null,
  name text not null,
  category text,
  set_code text,
  number text,
  image_url text,
  price numeric(10, 2),           -- USD market estimate for the default printing
  legal text[],                   -- formats the card is legal in; null = unknown
  cost numeric,                   -- mana/ink cost for curves
  max_copies int check (max_copies >= 0), -- banlist limit; null = the format's normal limit
  subtype text,                   -- Pokémon stage, Trainer type, ...
  identity text[],                -- colors / inks for deck color rules
  limit_group text,               -- deck-wide limit group, e.g. 'ACE SPEC'
  updated_at timestamptz not null default now(),  -- maps to Card.fetchedAt
  primary key (game, id)
);

-- Row-level security ----------------------------------------------------------

alter table public.decks enable row level security;
alter table public.changes enable row level security;
alter table public.copies enable row level security;
alter table public.cards enable row level security;

create policy decks_owner on public.decks
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy decks_public_read on public.decks
  for select using (is_public);

create policy changes_owner on public.changes
  for all
  using (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = auth.uid()))
  with check (exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = auth.uid()));
create policy changes_public_read on public.changes
  for select using (exists (select 1 from public.decks d where d.id = deck_id and d.is_public));

create policy copies_owner on public.copies
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy cards_read on public.cards for select using (true);
-- shortcut: any signed-in user can write the shared card cache; move writes to an edge function if abuse shows up.
create policy cards_write on public.cards for insert to authenticated with check (true);
create policy cards_update on public.cards for update to authenticated using (true);

-- Functions -------------------------------------------------------------------

-- Apply copy deltas all-or-nothing. Raises if any location would go below zero.
create or replace function public.adjust_copies(p_game text, p_deltas jsonb)
returns void
language plpgsql
security invoker
as $$
declare
  d jsonb;
begin
  for d in select * from jsonb_array_elements(p_deltas) loop
    if (d->>'delta')::int < 0 then
      -- The qty >= 0 check rejects going below zero; no row means no copies there.
      update public.copies set qty = qty + (d->>'delta')::int
      where owner_id = auth.uid() and game = p_game and card_id = d->>'cardId' and location = d->>'location';
      if not found then
        raise exception 'Not enough copies of % at %', d->>'cardId', d->>'location';
      end if;
    else
      insert into public.copies as c (owner_id, game, card_id, location, qty)
      values (auth.uid(), p_game, d->>'cardId', d->>'location', (d->>'delta')::int)
      on conflict (owner_id, game, card_id, location)
      do update set qty = c.qty + excluded.qty;
    end if;
  end loop;
  delete from public.copies where owner_id = auth.uid() and game = p_game and qty = 0;
end;
$$;

-- When a deck is deleted, its copies go back to the binder, so no owned card is lost.
create or replace function public.copies_to_binder_on_deck_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Account being deleted (decks cascade from auth.users): its copies go too, nothing to keep.
  if not exists (select 1 from auth.users where id = old.owner_id) then
    return old;
  end if;
  insert into public.copies as c (owner_id, game, card_id, location, qty)
  select owner_id, game, card_id, 'binder', qty
  from public.copies
  where owner_id = old.owner_id and location = old.id::text
  on conflict (owner_id, game, card_id, location) do update set qty = c.qty + excluded.qty;
  delete from public.copies where owner_id = old.owner_id and location = old.id::text;
  return old;
end;
$$;

create trigger decks_copies_to_binder
  before delete on public.decks
  for each row execute function public.copies_to_binder_on_deck_delete();
