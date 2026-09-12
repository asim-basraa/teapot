-- Being in a space, as distinct from being shared something in it.
--
-- These were the same mechanism and should never have been. Sharing answers
-- "this one page, this one person". Membership answers "you work here". Running
-- the second through the first meant a colleague had to be handed every folder
-- one at a time, and the top of the space could not be handed over at all,
-- because a top-level item has no parent for a grant to hang on.
--
-- So a space has members now: people, or teams, added to the space itself. A
-- member sees everything in it and may change anything in it, which is what a
-- shared working space is for and what page history exists to make safe. What a
-- member may *delete* is only what they wrote, and that is the rule this whole
-- migration turns on.
--
-- Deleting belongs to the author and to nobody else, the space's owner
-- included. Owning a space is owning the room, not the things people brought
-- into it: you decide who comes in, and you can take the room away, but you do
-- not get to destroy somebody's work because it is standing in it. It also
-- means work keeps its author when it moves — putting a page into a shared
-- space does not hand it over.
--
-- The cost of that is real and is not paid here: there is no way for an owner
-- to clear something out of their own space, and an item whose author's account
-- is gone can no longer be deleted by anyone. Taking a page out of a space is
-- a move rather than a deletion, and moving between spaces does not exist yet.

create table if not exists public.space_members (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  -- The same shape grants use, so "a person or a team" is said one way in this
  -- schema rather than two. Public and everyone-signed-in are grants, not
  -- membership: being in a space is something a named somebody is.
  member_type public.grantee_type not null,
  member_id uuid not null,
  added_at timestamptz not null default now(),
  added_by uuid references public.profiles (id) on delete set null,
  constraint space_members_named check (member_type in ('user', 'team')),
  unique (space_id, member_type, member_id)
);

create index if not exists space_members_space_idx on public.space_members (space_id);
create index if not exists space_members_member_idx
  on public.space_members (member_type, member_id);

alter table public.space_members enable row level security;

/**
 * Whether somebody is in a space, by membership or by owning it.
 *
 * SECURITY DEFINER so the policy on space_members can ask it without reading
 * space_members through its own policy, which is how the teams pair once
 * deadlocked into 42P17.
 *
 * Takes the user rather than reading auth.uid(), because effective_role does
 * and answers questions about people other than the caller.
 */
create or replace function public.is_space_member(p_user_id uuid, p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    p_user_id is not null
    and (
      exists (
        select 1 from public.spaces s
        where s.id = p_space_id and s.owner_id = p_user_id
      )
      or exists (
        select 1
        from public.space_members m
        where m.space_id = p_space_id
          and (
            (m.member_type = 'user' and m.member_id = p_user_id)
            or (
              m.member_type = 'team'
              and exists (
                select 1 from public.team_members tm
                where tm.team_id = m.member_id and tm.user_id = p_user_id
              )
            )
          )
      )
    ),
    false
  );
$$;

/** The caller's own case, for policies and for the screens. */
create or replace function public.in_space(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_space_member((select auth.uid()), p_space_id);
$$;

-- Everybody in a space can see who else is in it, for the same reason a team's
-- roster is open to the team: "who else can read what I write here" is the only
-- question membership raises, and a product about access that will not answer
-- it is not being careful, it is being unhelpful.
create policy space_members_select_insiders on public.space_members
  for select using (public.in_space(space_id));

-- Managing the roster is the owner's alone, which is the other half of what
-- owning a space means.
create policy space_members_write_owner on public.space_members
  for all
  using (
    exists (
      select 1 from public.spaces s
      where s.id = space_members.space_id and s.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.spaces s
      where s.id = space_members.space_id and s.owner_id = (select auth.uid())
    )
  );

/**
 * Records who added somebody, like the grants and teams tables do.
 */
create or replace function public.stamp_space_member_actor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.added_by is null then
    new.added_by := (select auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists space_members_stamp_actor on public.space_members;
create trigger space_members_stamp_actor
  before insert on public.space_members
  for each row execute function public.stamp_space_member_actor();

-- What membership confers ------------------------------------------------------

/**
 * Recreated to know about membership.
 *
 * Identical to the previous definition but for one branch: somebody in the
 * space holds at least editor on everything in it. At least, rather than
 * exactly, because a grant may still say admin and a floor must not cap.
 *
 * Membership is checked after ownership and before the grants, so the ordinary
 * case costs one lookup on a small table.
 */
create or replace function public.effective_role(p_user_id uuid, p_node_id uuid)
returns public.grant_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive ancestry as (
    select n.id, n.parent_id, n.space_id
    from public.nodes n
    where n.id = p_node_id

    union all

    select parent.id, parent.parent_id, parent.space_id
    from public.nodes parent
    join ancestry child on parent.id = child.parent_id
  ),
  granted as (
    select g.role
    from public.grants g
    join ancestry a on a.id = g.node_id
    where
      g.grantee_type = 'public'
      or (
        p_user_id is not null
        and g.grantee_type = 'authenticated'
      )
      or (
        p_user_id is not null
        and g.grantee_type = 'user'
        and g.grantee_id = p_user_id
      )
      or (
        p_user_id is not null
        and g.grantee_type = 'team'
        and exists (
          select 1
          from public.team_members tm
          where tm.team_id = g.grantee_id
            and tm.user_id = p_user_id
        )
      )
  ),
  strongest as (
    select g.role from granted g order by g.role desc limit 1
  )
  select case
    when p_user_id is not null and exists (
      select 1
      from public.nodes n
      join public.spaces s on s.id = n.space_id
      where n.id = p_node_id
        and s.owner_id = p_user_id
    )
      then 'admin'::public.grant_role
    when public.is_space_member(
      p_user_id,
      (select n.space_id from public.nodes n where n.id = p_node_id)
    )
      then greatest(
        'editor'::public.grant_role,
        coalesce((select role from strongest), 'editor'::public.grant_role)
      )
    -- Enum comparison follows declaration order (viewer < editor < admin),
    -- so ordering descending yields the strongest matching grant.
    else (select role from strongest)
  end;
$$;

-- Starting something at the top of a space ------------------------------------

-- Membership replaces "holds editor on something in here", which was a
-- stand-in for it while there was nothing better to ask.
drop policy if exists nodes_insert_editable on public.nodes;
create policy nodes_insert_editable on public.nodes
  for insert with check (
    case
      when parent_id is null then public.in_space(space_id)
      else public.can_edit(parent_id)
    end
  );

drop function if exists public.writes_in_space(uuid);

-- A top-level node no longer needs a grant minted for whoever made it:
-- membership is why they can see it, and it covers the whole space rather than
-- the one page. One fewer row in "who has access", saying something already
-- said elsewhere.
drop trigger if exists nodes_grant_creator on public.nodes;
drop function if exists public.grant_creator_top_level();

-- Deleting ---------------------------------------------------------------------

/**
 * Whether the caller may delete this node.
 *
 * The author, and nobody else. Not an administrator of it, and not the owner of
 * the space it is sitting in: owning a space is owning the room rather than the
 * things people brought into it. Work keeps its author when it moves, so
 * putting a page somewhere shared is not handing it over.
 *
 * The descendants clause is what stops the rule being decorative. A folder
 * takes everything under it when it goes, so without it you could remove
 * somebody else's page by deleting the folder it sits in — including a folder
 * of your own that they have since put something into.
 */
create or replace function public.can_delete_node(p_node_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select auth.uid()) is not null
    and exists (
      select 1 from public.nodes n
      where n.id = p_node_id and n.created_by = (select auth.uid())
    )
    and not exists (
      with recursive beneath as (
        select c.id, c.created_by
        from public.nodes c where c.parent_id = p_node_id
        union all
        select c.id, c.created_by
        from public.nodes c join beneath on c.parent_id = beneath.id
      )
      select 1 from beneath
      where beneath.created_by is distinct from (select auth.uid())
    ),
    false
  );
$$;

-- Managing the roster ----------------------------------------------------------

/**
 * Adds somebody to a space by address.
 *
 * Resolved inside the database for the same reason sharing is: profiles are
 * private, and this is the controlled hole. Ownership is checked before the
 * address is looked at, so it cannot be used to find out who has an account.
 */
create or replace function public.add_space_member(p_space_id uuid, p_email text)
returns public.space_members
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target uuid;
  v_row public.space_members;
begin
  if not exists (
    select 1 from public.spaces s
    where s.id = p_space_id and s.owner_id = (select auth.uid())
  ) then
    -- Indistinguishable from a space that does not exist.
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  select id into v_target
  from public.profiles
  where lower(email) = lower(btrim(p_email));

  if v_target is null then
    raise exception 'no account exists for %', btrim(p_email)
      using errcode = 'P0002';
  end if;

  -- The owner is in their space by definition; a row saying so would be a
  -- second place for that to be true and a confusing one to be able to remove.
  if exists (
    select 1 from public.spaces s
    where s.id = p_space_id and s.owner_id = v_target
  ) then
    raise exception 'already the owner of this space' using errcode = 'check_violation';
  end if;

  insert into public.space_members (space_id, member_type, member_id)
  values (p_space_id, 'user', v_target)
  on conflict (space_id, member_type, member_id) do update
    set space_id = excluded.space_id
  returning * into v_row;

  return v_row;
end;
$$;

/** Adds a team to a space. Any team the owner may share with. */
create or replace function public.add_space_team(p_space_id uuid, p_team_id uuid)
returns public.space_members
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.space_members;
begin
  if not exists (
    select 1 from public.spaces s
    where s.id = p_space_id and s.owner_id = (select auth.uid())
  ) then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  if not public.can_grant_to_team(p_team_id) then
    raise exception 'that team is not yours to share with'
      using errcode = 'check_violation';
  end if;

  insert into public.space_members (space_id, member_type, member_id)
  values (p_space_id, 'team', p_team_id)
  on conflict (space_id, member_type, member_id) do update
    set space_id = excluded.space_id
  returning * into v_row;

  return v_row;
end;
$$;

/** Takes somebody or some team out of a space. The owner's, like adding. */
create or replace function public.remove_space_member(p_member_row_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_space uuid;
begin
  select space_id into v_space from public.space_members where id = p_member_row_id;
  if v_space is null then
    return false;
  end if;

  if not exists (
    select 1 from public.spaces s
    where s.id = v_space and s.owner_id = (select auth.uid())
  ) then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  delete from public.space_members where id = p_member_row_id;
  return found;
end;
$$;

/**
 * Who is in a space, with names.
 *
 * Through a function because profiles are private. Open to everybody in the
 * space, and to nobody else.
 */
create or replace function public.space_roster(p_space_id uuid)
returns table (
  member_row_id uuid,
  member_type public.grantee_type,
  member_id uuid,
  label text,
  added_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    m.id,
    m.member_type,
    m.member_id,
    case when m.member_type = 'user' then p.email else t.name end,
    m.added_at
  from public.space_members m
  left join public.profiles p on m.member_type = 'user' and p.id = m.member_id
  left join public.teams t on m.member_type = 'team' and t.id = m.member_id
  where public.in_space(p_space_id)
    and m.space_id = p_space_id
  order by m.member_type, 4;
$$;

revoke all on function public.is_space_member(uuid, uuid) from public;
revoke all on function public.in_space(uuid) from public, anon;
revoke all on function public.add_space_member(uuid, text) from public, anon;
revoke all on function public.add_space_team(uuid, uuid) from public, anon;
revoke all on function public.remove_space_member(uuid) from public, anon;
revoke all on function public.space_roster(uuid) from public, anon;

grant execute on function public.is_space_member(uuid, uuid)
  to anon, authenticated, service_role;
grant execute on function public.in_space(uuid) to authenticated, service_role;
grant execute on function public.add_space_member(uuid, text)
  to authenticated, service_role;
grant execute on function public.add_space_team(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.remove_space_member(uuid)
  to authenticated, service_role;
grant execute on function public.space_roster(uuid) to authenticated, service_role;
