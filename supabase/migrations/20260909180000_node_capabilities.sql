-- Both capability answers in one round trip.
--
-- The page asked can_edit and can_admin at the same moment, on the same
-- Supabase client, with Promise.all. That is the only concurrency in a render,
-- and it sits exactly where an intermittent failure kept appearing: a page
-- rendered without its Edit link, or with an empty comment panel, for somebody
-- who plainly had the right to both.
--
-- Two calls dispatched together can each decide the session needs refreshing.
-- Refresh tokens rotate, so one of them can be left holding a token that was
-- just invalidated, and a request that goes out unauthenticated does not fail
-- loudly here: can_edit simply answers false, and node_comments simply returns
-- nothing. A permission check that degrades to "no" in silence is the worst
-- shape a bug can take, because it looks exactly like the rule working.
--
-- One question, one call. Cheaper too: half the round trips for something
-- every page render needs.
create or replace function public.node_capabilities(p_node_id uuid)
returns table (can_edit boolean, can_admin boolean)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    coalesce(public.can_edit(p_node_id), false),
    coalesce(public.can_admin(p_node_id), false);
$$;

-- Anonymous callers too: a published page renders for them, and it renders
-- without the affordances this answers about.
revoke all on function public.node_capabilities(uuid) from public;
grant execute on function public.node_capabilities(uuid)
  to anon, authenticated, service_role;
