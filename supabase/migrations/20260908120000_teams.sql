-- Teams: membership by email, roster reading, and team grants.
--
-- effective_role already resolves team grants; nothing here touches it. What
-- was missing is the ability to *manage* a team without being able to read the
-- profiles table, and a guarantee that a team grant cannot reach across spaces.

/**
 * Whether the current user owns the space a team belongs to.
 *
 * Teams are a space-level construct, so the space owner administers them. This
 * mirrors the RLS policies on `teams` and `team_members` rather than inventing
 * a second rule: if this says yes, those policies would have allowed the write
 * anyway.
 *
 * Returns false rather than null for a team that does not exist, so a caller
 * writing `if not owns_team_space(...)` gets the branch they expect. See the
 * predicate null-safety migration for why that matters.
 */
create or replace function public.owns_team_space(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select s.owner_id = (select auth.uid())
      from public.teams t
      join public.spaces s on s.id = t.space_id
      where t.id = p_team_id
    ),
    false
  );
$$;

/**
 * A team grant must name a team from the node's own space.
 *
 * Without this, an administrator of a node in someone else's space could point
 * a team they own at it, and every later change to that team's membership
 * would silently change who can read a space its owner never shared with them.
 * Granting individuals is already possible and is not the concern: the problem
 * is a grant whose meaning keeps changing under a roster the space owner
 * cannot see.
 *
 * Enforced as a trigger rather than inside a helper function so it holds no
 * matter which path writes the row.
 */
create or replace function public.check_team_grant_same_space()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.grantee_type <> 'team' then
    return new;
  end if;

  if not exists (
    select 1
    from public.teams t
    join public.nodes n on n.space_id = t.space_id
    where t.id = new.grantee_id
      and n.id = new.node_id
  ) then
    raise exception 'a team can only be granted access within its own space'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists grants_team_same_space on public.grants;

create trigger grants_team_same_space
  before insert or update on public.grants
  for each row execute function public.check_team_grant_same_space();

/**
 * Deleting a team removes the grants that named it.
 *
 * `grants.grantee_id` is polymorphic, so it can carry no foreign key and
 * nothing cascades on its own. The access is already gone the moment the
 * memberships cascade away, but the rows are not: the sharing dialog would go
 * on listing a grant it can no longer name, which is precisely the "who can see
 * this and why" question the audit view exists to answer.
 */
create or replace function public.delete_team_grants()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.grants
   where grantee_type = 'team' and grantee_id = old.id;
  return old;
end;
$$;

drop trigger if exists teams_delete_grants on public.teams;

create trigger teams_delete_grants
  after delete on public.teams
  for each row execute function public.delete_team_grants();

/**
 * Adds someone to a team by email address.
 *
 * The same controlled hole as grant_to_email, for the same reason: profiles are
 * private, so nothing running as the caller can resolve an address to an id.
 * Ownership of the team's space is checked first and before the address is
 * looked at, so this cannot be used to discover who has an account.
 *
 * Re-adding an existing member changes their team role rather than failing.
 */
create or replace function public.add_team_member(
  p_team_id uuid,
  p_email text,
  p_role public.team_member_role default 'member'
)
returns public.team_members
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target uuid;
  v_member public.team_members;
begin
  if not public.owns_team_space(p_team_id) then
    -- Indistinguishable from a team that does not exist.
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  select id into v_target
  from public.profiles
  where lower(email) = lower(trim(p_email));

  if v_target is null then
    raise exception 'no account exists for %', trim(p_email)
      using errcode = 'P0002';
  end if;

  insert into public.team_members (team_id, user_id, role)
  values (p_team_id, v_target, p_role)
  on conflict (team_id, user_id) do update set role = excluded.role
  returning * into v_member;

  return v_member;
end;
$$;

/**
 * Who is on a team, with their addresses.
 *
 * Gated on owning the space, because the addresses of other members are not
 * something an ordinary member has been given. The team_members RLS policy
 * already lets a member see their own row; this is the owner's management view.
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
    and public.owns_team_space(p_team_id)
  order by p.email;
$$;

/**
 * Removes someone from a team.
 *
 * A plain delete would also work, since RLS on team_members requires owning the
 * space. This exists so the caller gets the same not-found shape as the other
 * team operations rather than a silent no-op they have to interpret.
 */
create or replace function public.remove_team_member(
  p_team_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.owns_team_space(p_team_id) then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  delete from public.team_members
   where team_id = p_team_id and user_id = p_user_id;

  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
end;
$$;

/**
 * Shares a node with a team.
 *
 * Exists rather than a plain insert because the uniqueness rule on `grants` is
 * a partial index, so "insert or change the role" needs an ON CONFLICT clause
 * carrying the same predicate, which no client-side upsert can express. The
 * admin check is the same one RLS would apply; stating it here is what makes
 * the SECURITY DEFINER safe.
 *
 * The same-space trigger still runs, so a team from another space is refused
 * here exactly as it would be anywhere else.
 */
create or replace function public.grant_to_team(
  p_node_id uuid,
  p_team_id uuid,
  p_role public.grant_role
)
returns public.grants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_grant public.grants;
begin
  if coalesce(public.can_admin(p_node_id), false) is not true then
    -- Deliberately indistinguishable from a node that does not exist.
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  insert into public.grants (node_id, grantee_type, grantee_id, role)
  values (p_node_id, 'team', p_team_id, p_role)
  on conflict (node_id, grantee_type, grantee_id) where grantee_id is not null
  do update set role = excluded.role
  returning * into v_grant;

  return v_grant;
end;
$$;

-- Effective grants, now naming teams -----------------------------------------

-- Recreated rather than replaced: the returned row type gains a column, and
-- Postgres will not change that in place. A team grant used to show as the bare
-- word "team" in the sharing dialog, which answers nothing when a space has
-- several.
drop function if exists public.node_effective_grants(uuid);

create function public.node_effective_grants(p_node_id uuid)
returns table (
  grant_id uuid,
  origin_node_id uuid,
  origin_path text,
  inherited boolean,
  grantee_type public.grantee_type,
  grantee_id uuid,
  grantee_email text,
  grantee_name text,
  role public.grant_role
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive ancestry as (
    select n.id, n.parent_id, n.path
    from public.nodes n
    where n.id = p_node_id
    union all
    select parent.id, parent.parent_id, parent.path
    from public.nodes parent
    join ancestry child on parent.id = child.parent_id
  )
  select
    g.id,
    g.node_id,
    a.path,
    a.id <> p_node_id,
    g.grantee_type,
    g.grantee_id,
    p.email,
    t.name,
    g.role
  from public.grants g
  join ancestry a on a.id = g.node_id
  left join public.profiles p
    on p.id = g.grantee_id and g.grantee_type = 'user'
  left join public.teams t
    on t.id = g.grantee_id and g.grantee_type = 'team'
  where public.can_admin(p_node_id)
  order by (a.id <> p_node_id), p.email nulls first;
$$;

revoke all on function public.owns_team_space(uuid) from public, anon;
revoke all on function public.add_team_member(uuid, text, public.team_member_role)
  from public, anon;
revoke all on function public.remove_team_member(uuid, uuid) from public, anon;
revoke all on function public.team_roster(uuid) from public, anon;
revoke all on function public.grant_to_team(uuid, uuid, public.grant_role)
  from public, anon;
revoke all on function public.node_effective_grants(uuid) from public, anon;

grant execute on function public.owns_team_space(uuid) to authenticated, service_role;
grant execute on function public.add_team_member(uuid, text, public.team_member_role)
  to authenticated, service_role;
grant execute on function public.remove_team_member(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.team_roster(uuid) to authenticated, service_role;
grant execute on function public.grant_to_team(uuid, uuid, public.grant_role)
  to authenticated, service_role;
grant execute on function public.node_effective_grants(uuid)
  to authenticated, service_role;
