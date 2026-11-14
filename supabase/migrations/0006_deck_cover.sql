-- Deck icon: the card whose art stands for the deck (null = the priciest card).
alter table public.decks add column cover_card_id text;

-- import_all again, now restoring the deck icon.
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
  insert into public.decks (id, game, name, format, purpose, labels, locked, is_public, cover_card_id, created_at, updated_at)
  select (d->>'id')::uuid, d->>'game', d->>'name', d->>'format', d->>'purpose',
         coalesce(array(select jsonb_array_elements_text(d->'labels')), '{}'), coalesce((d->>'locked')::boolean, false), coalesce((d->>'isPublic')::boolean, false), d->>'coverCardId',
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
