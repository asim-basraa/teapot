-- Authorization predicates.
--
-- These are the single authorization seam: RLS policies call them, route
-- handlers call them, nothing else decides access. They are deliberately thin,
-- answering one question with no business logic. All orchestration, API shape,
-- validation and rendering live in TypeScript.
--
-- They are SECURITY DEFINER because RLS policies on `nodes` and `grants` call
-- them; without it the predicate's own reads would recurse through the policies
-- it exists to serve. search_path is pinned so a caller cannot shadow the
-- tables being consulted.

-- Effective role of a user on a node: the strongest role granted by the node
-- itself or any ancestor, whether granted to the user directly, to a team the
-- user belongs to, or to the public. Space owners always hold admin.
-- Returns null when the user has no access at all, or the node does not exist.
--
-- p_user_id is null for anonymous visitors, who can still match public grants.
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
    -- Enum comparison follows declaration order (viewer < editor < admin),
    -- so ordering descending yields the strongest matching grant.
    else (select g.role from granted g order by g.role desc limit 1)
  end;
$$;

create or replace function public.can_read(p_user_id uuid, p_node_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.effective_role(p_user_id, p_node_id) is not null;
$$;

create or replace function public.can_edit(p_user_id uuid, p_node_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.effective_role(p_user_id, p_node_id)
    in ('editor'::public.grant_role, 'admin'::public.grant_role);
$$;

create or replace function public.can_admin(p_user_id uuid, p_node_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.effective_role(p_user_id, p_node_id) = 'admin'::public.grant_role;
$$;

revoke all on function public.effective_role(uuid, uuid) from public;
revoke all on function public.can_read(uuid, uuid) from public;
revoke all on function public.can_edit(uuid, uuid) from public;
revoke all on function public.can_admin(uuid, uuid) from public;

grant execute on function public.effective_role(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.can_read(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.can_edit(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.can_admin(uuid, uuid) to anon, authenticated, service_role;
