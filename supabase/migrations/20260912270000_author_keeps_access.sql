-- An author never loses sight of their own work.
--
-- The base rule, and it was missing. Access came from grants, from membership,
-- and from owning a space, none of which is authorship, so a member removed
-- from a space lost the pages they had written in it. Nobody could delete them
-- — that already belonged to their author — but their author could not read
-- them either. Work that only you may destroy and nobody may open is the worst
-- of both.
--
-- So writing something is itself a reason to reach it, permanently and wherever
-- it ends up. It is the same fact deleting already turned on, applied to the
-- question one step earlier: whose work is this.
--
-- Editor rather than admin. You may read what you wrote and change it, and
-- deleting is yours by the separate rule. Deciding who *else* may read it stays
-- with whoever's space it is sitting in, because a page inside somebody's space
-- is not a door for its author to hand out keys to.

/**
 * Recreated for the third time today, and worth saying why each branch is here.
 *
 * Owning the space is admin over everything in it, because that is what owning
 * a space means. Being in the space is at least editor, because that is what a
 * shared working space is for. Having written the thing is at least editor, so
 * that your own work cannot be taken out of your hands. Otherwise the grants
 * decide, as they always did.
 *
 * greatest rather than a chain of cases: these are floors, not answers, and any
 * of them may be beaten by a grant that says admin. It ignores nulls, so a
 * branch that does not apply simply does not vote.
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
      or (p_user_id is not null and g.grantee_type = 'authenticated')
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
    -- Enum comparison follows declaration order (viewer < editor < admin), so
    -- ordering descending yields the strongest matching grant.
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
    else greatest(
      (select role from strongest),
      case
        when public.is_space_member(
          p_user_id,
          (select n.space_id from public.nodes n where n.id = p_node_id)
        )
          then 'editor'::public.grant_role
      end,
      case
        when p_user_id is not null and exists (
          select 1 from public.nodes n
          where n.id = p_node_id and n.created_by = p_user_id
        )
          then 'editor'::public.grant_role
      end
    )
  end;
$$;
