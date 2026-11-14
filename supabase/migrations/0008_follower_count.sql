-- Follower count for any player page. Follows stay private to both sides (row-level security),
-- so counting rows from a third player's view saw only their own follow. This returns the number only.
create or replace function public.follower_count(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*) from public.follows where followee_id = p_user;
$$;

grant execute on function public.follower_count(uuid) to anon, authenticated;
