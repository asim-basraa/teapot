-- Telling somebody something has been shared with them.
--
-- Sharing with an address that has no account has sent an email since the
-- invitation work: that is how they get in at all. Sharing with somebody who
-- already has an account did nothing they could see. The grant landed, the
-- page became theirs to read, and they had no way of knowing unless somebody
-- told them in person. Same for being added to a team.
--
-- What is here is the in-app half: a record of what has been shared with you,
-- what is new since you last looked, and who did it. It needs nothing this
-- product does not already have. Email to somebody who already has an account
-- is a separate question with an infrastructure answer, because the only mail
-- this product sends is sent by the auth service on its own account, and it
-- has no way to send anything else.

-- Who did it -------------------------------------------------------------------
--
-- Set by a trigger rather than by each of the several functions that create
-- grants, because "whoever is asking" is the same answer in all of them and
-- one place cannot be forgotten when the next one is added.

alter table public.grants
  add column if not exists granted_by uuid references public.profiles (id) on delete set null;

alter table public.team_members
  add column if not exists added_at timestamptz not null default now(),
  add column if not exists added_by uuid references public.profiles (id) on delete set null;

create or replace function public.stamp_actor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'grants' and new.granted_by is null then
    new.granted_by := (select auth.uid());
  elsif tg_table_name = 'team_members' and new.added_by is null then
    new.added_by := (select auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists grants_stamp_actor on public.grants;
create trigger grants_stamp_actor
  before insert on public.grants
  for each row execute function public.stamp_actor();

drop trigger if exists team_members_stamp_actor on public.team_members;
create trigger team_members_stamp_actor
  before insert on public.team_members
  for each row execute function public.stamp_actor();

-- When they last looked ---------------------------------------------------------

alter table public.profiles
  add column if not exists shares_seen_at timestamptz;

/**
 * What has been shared with the person asking.
 *
 * Three things count: a page, folder or skill granted to them by name; one
 * granted to a team they are on; and being put on a team in the first place.
 * Grants to everyone and to the public are deliberately absent, because
 * nobody shared those with anybody in particular and a list that fills with
 * them is a list nobody reads.
 *
 * Gated on can_read even though a grant to you implies it. The habit is worth
 * more than the microseconds: this is the only place in the product that
 * assembles a list of nodes from something other than the node table itself,
 * and it would be exactly the sort of place a leak hides.
 */
create or replace function public.shared_with_me()
returns table (
  kind text,
  label text,
  detail text,
  href text,
  role text,
  actor text,
  happened_at timestamptz,
  is_new boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (
    select id, shares_seen_at from public.profiles where id = (select auth.uid())
  ),
  direct as (
    select
      'page'::text as kind,
      n.name as label,
      s.name as detail,
      '/s/' || s.slug ||
        case when n.path = 'index' then '' else '/' || n.path end as href,
      g.role::text as role,
      p.email as actor,
      g.created_at as happened_at
    from public.grants g
    join public.nodes n on n.id = g.node_id
    join public.spaces s on s.id = n.space_id
    left join public.profiles p on p.id = g.granted_by
    where g.grantee_type = 'user'
      and g.grantee_id = (select auth.uid())
      and public.can_read(n.id)
  ),
  through_team as (
    select
      'page'::text,
      n.name,
      t.name || ', in ' || s.name,
      '/s/' || s.slug ||
        case when n.path = 'index' then '' else '/' || n.path end,
      g.role::text,
      p.email,
      -- Whichever happened later: a page given to a team before you joined it
      -- is news on the day you join, not on the day it was given.
      greatest(g.created_at, tm.added_at)
    from public.grants g
    join public.team_members tm
      on tm.team_id = g.grantee_id and tm.user_id = (select auth.uid())
    join public.teams t on t.id = g.grantee_id
    join public.nodes n on n.id = g.node_id
    join public.spaces s on s.id = n.space_id
    left join public.profiles p on p.id = g.granted_by
    where g.grantee_type = 'team'
      and public.can_read(n.id)
  ),
  joined as (
    select
      'team'::text,
      t.name,
      s.name,
      null::text,
      tm.role::text,
      p.email,
      tm.added_at
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    join public.spaces s on s.id = t.space_id
    left join public.profiles p on p.id = tm.added_by
    where tm.user_id = (select auth.uid())
  ),
  everything as (
    select * from direct
    union all select * from through_team
    union all select * from joined
  )
  select
    e.kind, e.label, e.detail, e.href, e.role, e.actor, e.happened_at,
    (me.shares_seen_at is null or e.happened_at > me.shares_seen_at)
  from everything e, me
  order by e.happened_at desc
  limit 50;
$$;

revoke all on function public.shared_with_me() from public, anon;
grant execute on function public.shared_with_me() to authenticated, service_role;

/**
 * Marks everything shared with the caller as seen.
 *
 * Its own function rather than an update on profiles, because profiles are
 * updatable by their owner and this should not be a column somebody can set
 * to a time in the future to make a share look old.
 */
create or replace function public.mark_shares_seen()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.profiles set shares_seen_at = now()
   where id = (select auth.uid());
$$;

revoke all on function public.mark_shares_seen() from public, anon;
grant execute on function public.mark_shares_seen() to authenticated, service_role;

/**
 * How many of those are new, for the badge in the header.
 *
 * A count rather than the list, because the header is rendered on every page
 * and the list walks can_read per row. Counting discloses nothing the list
 * would not: every row counted here is something granted to the person
 * counting.
 */
create or replace function public.new_share_count()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (
    select coalesce(shares_seen_at, '-infinity'::timestamptz) as seen
    from public.profiles where id = (select auth.uid())
  )
  select (
    (select count(*) from public.grants g, me
      where g.grantee_type = 'user'
        and g.grantee_id = (select auth.uid())
        and g.created_at > me.seen)
  + (select count(*) from public.grants g
      join public.team_members tm
        on tm.team_id = g.grantee_id and tm.user_id = (select auth.uid()), me
      where g.grantee_type = 'team'
        and greatest(g.created_at, tm.added_at) > me.seen)
  + (select count(*) from public.team_members tm, me
      where tm.user_id = (select auth.uid()) and tm.added_at > me.seen)
  )::integer;
$$;

revoke all on function public.new_share_count() from public, anon;
grant execute on function public.new_share_count() to authenticated, service_role;
