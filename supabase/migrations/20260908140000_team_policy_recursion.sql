-- Fixes infinite recursion between the teams and team_members policies.
--
-- The two policies consulted each other: reading `teams` asked whether you were
-- a member, which read `team_members`, whose policy asked which space the team
-- belonged to, which read `teams` again. Postgres detects the cycle and refuses
-- the query outright with 42P17.
--
-- It was invisible until now because nothing selected `teams` as an ordinary
-- user: the table existed only to be joined inside effective_role, which is
-- SECURITY DEFINER and so never applies these policies at all. The first screen
-- that listed teams hit it immediately.
--
-- The fix is the same one the rest of the schema already uses: a policy may not
-- reach into another RLS-protected table to answer its own question. It asks a
-- SECURITY DEFINER predicate instead, which reads the row directly and cannot
-- recurse.

/**
 * Whether the current user is on a team.
 *
 * SECURITY DEFINER so that reading it from a policy on `teams` does not
 * re-enter the policy on `team_members`.
 */
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_team_member(uuid) from public, anon;
grant execute on function public.is_team_member(uuid) to authenticated, service_role;

drop policy if exists teams_select_member_or_owner on public.teams;

-- The owner branch stays an inline subquery on `spaces` rather than calling
-- owns_team_space: that predicate is STABLE, so on a read-back immediately
-- after an insert it would run against a snapshot taken before the new team
-- existed and refuse the row its own owner just created.
create policy teams_select_member_or_owner on public.teams
  for select using (
    exists (
      select 1 from public.spaces s
      where s.id = teams.space_id and s.owner_id = (select auth.uid())
    )
    or public.is_team_member(teams.id)
  );

drop policy if exists team_members_select_self_or_owner on public.team_members;

create policy team_members_select_self_or_owner on public.team_members
  for select using (
    user_id = (select auth.uid())
    or public.owns_team_space(team_members.team_id)
  );

drop policy if exists team_members_write_space_owner on public.team_members;

-- Safe to use the predicate here: a membership row always names a team that
-- already exists, so there is no not-yet-visible row for the snapshot to miss.
create policy team_members_write_space_owner on public.team_members
  for all using (public.owns_team_space(team_members.team_id))
  with check (public.owns_team_space(team_members.team_id));
