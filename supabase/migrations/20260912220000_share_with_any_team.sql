-- Sharing with a team that lives in somebody else's space.
--
-- A team used to be grantable only within the space it was defined in. That
-- made teams a filing convention of one space rather than a group of people,
-- and it failed in the obvious case: somebody is put on a team in the Post-it
-- space, writes a document in their own space, and wants the team to read it.
-- The team picker did not offer the team, and naming it directly was refused
-- by a trigger. There was no way round it short of asking the other space's
-- owner to host your document, which is not sharing, it is surrendering.
--
-- The old rule was reaching for something real, though, and the replacement has
-- to keep it: you should not be able to attach a group of people you know
-- nothing about. So the rule becomes *a team you can see* rather than *a team
-- from here*: one whose space you own, or one you are on yourself. Both of
-- those can already read the roster, which is the property that matters. You
-- can always see who you are handing your document to.
--
-- What you are accepting when you do is worth naming, because it is a real
-- trade and it is not reversible by you. Whoever owns the team's space decides
-- who is on it, so they can add somebody tomorrow and that person will read
-- what you shared today. That is what sharing with a group means anywhere it
-- exists; the interface says so at the point of choosing rather than leaving it
-- to be discovered.

/**
 * Whether a team is one the caller may hand something to.
 *
 * Owner of its space, or on it. Named once so the trigger and the picker cannot
 * drift into disagreeing about which teams exist for you.
 *
 * coalesce for the usual reason: a team id that names nothing makes both halves
 * null, and a null flowing into the trigger's `if not` would let it through.
 */
create or replace function public.can_grant_to_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.owns_team_space(p_team_id) or public.is_team_member(p_team_id),
    false
  );
$$;

/**
 * Refuses a team grant naming a team the actor cannot see.
 *
 * The integrity half, that the team exists at all, is kept separately for the
 * service role: `grants.grantee_id` is polymorphic and carries no foreign key,
 * so without this a migration could write a grant pointing at nothing.
 */
create or replace function public.check_team_grant_grantable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.grantee_type <> 'team' then
    return new;
  end if;

  if not exists (select 1 from public.teams t where t.id = new.grantee_id) then
    raise exception 'no such team' using errcode = 'check_violation';
  end if;

  -- No session: the service role, or a migration. Those carry their own
  -- authority and there is no "you" to check a team against. Ordinary callers
  -- never reach here with a null uid, because inserting into grants at all
  -- requires can_admin, which is false for nobody.
  if (select auth.uid()) is null then
    return new;
  end if;

  if not public.can_grant_to_team(new.grantee_id) then
    raise exception 'that team is not yours to share with'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists grants_team_same_space on public.grants;
drop trigger if exists grants_team_grantable on public.grants;

create trigger grants_team_grantable
  before insert or update on public.grants
  for each row execute function public.check_team_grant_grantable();

drop function if exists public.check_team_grant_same_space();

/**
 * The teams this node could be shared with, for the picker.
 *
 * Gated on being able to share the node in the first place, so it cannot be
 * asked as a general question about which teams somebody is on.
 *
 * same_space is returned rather than worked out in the client because the
 * client does not know a team's space and should not have to ask for one: it
 * decides only whether the row needs qualifying with where the team lives.
 */
create or replace function public.grantable_teams(p_node_id uuid)
returns table (
  team_id uuid,
  team_name text,
  space_name text,
  same_space boolean
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
    t.space_id = (select n.space_id from public.nodes n where n.id = p_node_id)
  from public.teams t
  join public.spaces s on s.id = t.space_id
  where public.can_admin(p_node_id)
    and public.can_grant_to_team(t.id)
  -- The node's own space first: still the common case, and still the one
  -- needing no explanation.
  order by
    (t.space_id = (select n.space_id from public.nodes n where n.id = p_node_id))
      desc,
    s.name,
    t.name;
$$;

revoke all on function public.can_grant_to_team(uuid) from public, anon;
revoke all on function public.grantable_teams(uuid) from public, anon;

grant execute on function public.can_grant_to_team(uuid)
  to authenticated, service_role;
grant execute on function public.grantable_teams(uuid)
  to authenticated, service_role;
