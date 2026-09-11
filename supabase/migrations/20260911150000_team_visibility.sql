-- Lets a team member see the team they are on.
--
-- QA asked two fair questions of the teams feature:
--
--   * If a user is added to a team but nothing is shared with that team, what
--     was the point of adding them?
--   * If a member cannot see inside the team, or who else is on it, how is the
--     feature meant to work?
--
-- The first is by design and badly signposted. A team is a reusable grantee,
-- not a bundle of access: joining one grants nothing on its own, because the
-- alternative is that adding somebody silently hands them everything the team
-- was ever given. What was missing is anybody saying so.
--
-- The second is a real gap, and an asymmetric one. "Why can this person see
-- this page" had an answer for the space owner and none at all for the member,
-- who would find a folder in their list with no account of where it came from.
--
-- So: three reads, all of them read-only. Membership still confers no write.

/**
 * Who is on a team: now the members too, not only the space owner.
 *
 * This does show a member their team-mates' addresses. That is the intent
 * rather than a leak: they are on a named team together, the owner put them
 * there, and knowing who else can read what you write is the sort of thing you
 * are entitled to know. It stops at the team — nothing here reveals anybody in
 * the space who is not on a team with you.
 */
create or replace function public.team_roster(p_team_id uuid)
returns table (
  user_id uuid,
  email text,
  display_name text,
  role public.team_member_role
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select tm.user_id, p.email, p.display_name, tm.role
  from public.team_members tm
  join public.profiles p on p.id = tm.user_id
  where tm.team_id = p_team_id
    and (public.owns_team_space(p_team_id) or public.is_team_member(p_team_id))
  order by p.email;
$$;

/**
 * What a team reaches: the pages and folders shared with it.
 *
 * Answers "why can I see this" for a member and "what does this team actually
 * get" for the owner, from one place, so the two can never disagree.
 *
 * can_read is applied on top of the team grant even though a team grant is
 * itself a reason to be able to read. It costs a little and it means this can
 * never become a way to enumerate nodes if the rules around grants ever change.
 */
create or replace function public.team_reach(p_team_id uuid)
returns table (
  node_id uuid,
  label text,
  href text,
  role public.grant_role,
  space_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    n.id,
    n.name,
    '/s/' || s.slug ||
      case when n.path = 'index' then '' else '/' || n.path end,
    g.role,
    s.name
  from public.grants g
  join public.nodes n on n.id = g.node_id
  join public.spaces s on s.id = n.space_id
  where g.grantee_type = 'team'
    and g.grantee_id = p_team_id
    and (public.owns_team_space(p_team_id) or public.is_team_member(p_team_id))
    and public.can_read(n.id)
  order by s.name, n.path;
$$;

/**
 * The teams the caller is on.
 *
 * reach_count is deliberately allowed to be zero and is shown as such: a team
 * that reaches nothing yet is the ordinary state of a team somebody has only
 * just made, and the screen says so in words rather than leaving a member to
 * wonder whether something is broken.
 */
create or replace function public.my_teams()
returns table (
  team_id uuid,
  team_name text,
  space_name text,
  space_slug text,
  my_role public.team_member_role,
  member_count integer,
  reach_count integer,
  added_at timestamptz,
  added_by text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    t.id,
    t.name,
    s.name,
    s.slug,
    tm.role,
    (select count(*)::integer from public.team_members m where m.team_id = t.id),
    (select count(*)::integer from public.team_reach(t.id)),
    tm.added_at,
    p.email
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  join public.spaces s on s.id = t.space_id
  left join public.profiles p on p.id = tm.added_by
  where tm.user_id = (select auth.uid())
  order by s.name, t.name;
$$;

/**
 * Everything every team of mine reaches, in one round trip.
 *
 * The member screen needs the reach of each team at once, and asking per team
 * would be a query apiece. Grouping happens in the page.
 */
create or replace function public.my_team_reach()
returns table (
  team_id uuid,
  node_id uuid,
  label text,
  href text,
  role public.grant_role,
  space_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select tm.team_id, r.node_id, r.label, r.href, r.role, r.space_name
  from public.team_members tm
  cross join lateral public.team_reach(tm.team_id) r
  where tm.user_id = (select auth.uid())
  order by r.space_name, r.label;
$$;

revoke all on function public.team_reach(uuid) from public, anon;
revoke all on function public.my_teams() from public, anon;
revoke all on function public.my_team_reach() from public, anon;

grant execute on function public.team_reach(uuid) to authenticated, service_role;
grant execute on function public.my_teams() to authenticated, service_role;
grant execute on function public.my_team_reach() to authenticated, service_role;

/**
 * Redirects the "you were added to a team" line at somewhere to go.
 *
 * Identical to the previous definition but for the `joined` branch, which set
 * href to null because there was no screen for a member to be sent to. There is
 * now, so the one notification a member did get stops being a dead end.
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
      '/teams'::text,
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
