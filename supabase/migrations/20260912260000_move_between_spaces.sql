-- Taking a page out of a space.
--
-- Deleting belongs to the author, which left a space's owner with no way to
-- clear anything out of their own space: they could not remove somebody else's
-- page and they could not move it anywhere either, because moving only ever
-- reparented within one space.
--
-- So a page can cross spaces now, and taking one out of a space is a move
-- rather than a deletion. The work is not destroyed, it goes home: back to its
-- author's own space, where it is theirs again and the space it was in stops
-- reaching it. Two different powers with two different names, which is the
-- distinction the whole model rests on. You decide what is in your space. You
-- do not decide what happens to somebody's work.
--
-- Two people can want this, for different reasons, so there are two ways in:
-- the author moving their own work somewhere they belong, and the space's owner
-- sending somebody's work back. They share the mechanical part and check
-- entirely different things.
--
-- What does not travel is a wikilink written from the space it left. Links
-- resolve by path within a space, so one pointing at a page that has gone
-- elsewhere goes inert, exactly as it would if the page had been renamed out
-- from under it. That is visible in the page rather than silent.

/**
 * A free path at the top of a space, given a preferred slug.
 *
 * Spaces are separate namespaces, so a page called Roadmap can walk into a
 * space that already has one. Rather than refuse a move for a reason nobody
 * caused, the arriving page takes the next number. It keeps its name; only the
 * address changes, which is the part that has to be unique.
 */
create or replace function public.free_top_level_slug(
  p_space_id uuid,
  p_slug text
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_try text := p_slug;
  v_n integer := 1;
begin
  while exists (
    select 1 from public.nodes n
    where n.space_id = p_space_id and n.path = v_try
  ) loop
    v_n := v_n + 1;
    v_try := p_slug || '-' || v_n;
  end loop;

  return v_try;
end;
$$;

/**
 * Moves a node and everything under it into another space, at the top level.
 *
 * The mechanical half, with no opinion about who may ask: the two callers below
 * decide that, and they decide it differently. Not callable directly.
 *
 * Descendants are rewritten before the node itself, because their paths are
 * matched by the prefix the node is about to stop having.
 */
create or replace function public.relocate_subtree(
  p_node_id uuid,
  p_target_space_id uuid
)
returns public.nodes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_node public.nodes;
  v_old_path text;
  v_new_path text;
begin
  select * into v_node from public.nodes where id = p_node_id;
  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  if v_node.space_id = p_target_space_id then
    return v_node;
  end if;

  -- The home page is the space's address. Moving it out would leave /s/<slug>
  -- resolving to nothing for everybody, including the owner.
  if v_node.parent_id is null and v_node.slug = 'index' then
    raise exception 'the home page of a space cannot be moved'
      using errcode = 'check_violation';
  end if;

  v_old_path := v_node.path;
  v_new_path := public.free_top_level_slug(p_target_space_id, v_node.slug);

  update public.nodes
     set path = v_new_path || substring(path from length(v_old_path) + 1),
         space_id = p_target_space_id,
         updated_at = now()
   where space_id = v_node.space_id
     and path like v_old_path || '/%';

  update public.nodes
     set path = v_new_path,
         slug = v_new_path,
         space_id = p_target_space_id,
         parent_id = null,
         updated_at = now()
   where id = p_node_id
  returning * into v_node;

  return v_node;
end;
$$;

/**
 * The space somebody would call their own, making one if they have none.
 *
 * Nothing creates a space at signup, so plenty of accounts own none, and a page
 * being sent home needs somewhere to land. Refusing would leave a space's owner
 * exactly as stuck as before, which is the thing this migration exists to fix.
 *
 * Theirs from the moment it exists: they own it, they see it, and they can
 * rename it to anything they like.
 */
create or replace function public.home_space_for(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_space uuid;
  v_email text;
  v_handle text;
  v_slug text;
  v_n integer := 1;
begin
  select id into v_space
  from public.spaces
  where owner_id = p_user_id
  order by created_at
  limit 1;

  if v_space is not null then
    return v_space;
  end if;

  select email into v_email from public.profiles where id = p_user_id;
  if v_email is null then
    raise exception 'no such account' using errcode = 'no_data_found';
  end if;

  v_handle := public.slugify(split_part(v_email, '@', 1));
  if v_handle = '' then
    v_handle := 'space';
  end if;

  -- A space slug is unique across the whole product, not within an owner.
  v_slug := v_handle;
  while exists (select 1 from public.spaces s where s.slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_handle || '-' || v_n;
  end loop;

  insert into public.spaces (slug, name, owner_id)
  values (v_slug, initcap(replace(v_handle, '-', ' ')) || '''s space', p_user_id)
  returning id into v_space;

  -- Every space has a home page; /s/<slug> resolves to it.
  insert into public.nodes (space_id, parent_id, kind, name, slug, path, content, created_by)
  values (
    v_space, null, 'file', 'Home', 'index', 'index',
    '# Home' || chr(10) || chr(10) ||
    'This space was made for you when something of yours was moved here.',
    p_user_id
  );

  return v_space;
end;
$$;

/**
 * Moves your own work into another space you belong to.
 *
 * Yours by authorship, which is the same thing deleting turns on: the page
 * follows you rather than the room it happened to be standing in.
 */
create or replace function public.move_my_node_to_space(
  p_node_id uuid,
  p_target_space_id uuid
)
returns public.nodes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  if not exists (
    select 1 from public.nodes n
    where n.id = p_node_id and n.created_by = v_me
  ) then
    -- Unreadable, not yours, and nonexistent are one answer, as everywhere.
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  if not public.in_space(p_target_space_id) then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  return public.relocate_subtree(p_node_id, p_target_space_id);
end;
$$;

/**
 * Sends somebody's work back out of your space.
 *
 * The space owner's, and only theirs. It is not a deletion and must not read
 * like one: the page goes to its author's own space, intact, with its history
 * and its authorship. What it loses is this space, and so everybody who was
 * reaching it through this space.
 *
 * A page whose author is gone has nowhere to go home to. The owner may delete
 * that one instead — see the deleting rule, which makes the single exception
 * for work that is nobody's.
 */
create or replace function public.evict_node(p_node_id uuid)
returns public.nodes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_node public.nodes;
  v_target uuid;
begin
  select * into v_node from public.nodes where id = p_node_id;
  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  if not exists (
    select 1 from public.spaces s
    where s.id = v_node.space_id and s.owner_id = (select auth.uid())
  ) then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  if v_node.created_by is null then
    raise exception 'nobody to send it back to' using errcode = 'check_violation';
  end if;

  if v_node.created_by = (select auth.uid()) then
    raise exception 'this is your own work, in your own space'
      using errcode = 'check_violation';
  end if;

  v_target := public.home_space_for(v_node.created_by);
  return public.relocate_subtree(p_node_id, v_target);
end;
$$;

-- Work that is nobody's ---------------------------------------------------------

/**
 * Recreated with one exception, and it is a narrow one.
 *
 * Deleting belongs to the author. When an account is deleted its authorship
 * goes with it, and the page becomes work that is nobody's: unable to be
 * deleted by anyone and unable to be sent home, because there is no home. The
 * owner of the space it is sitting in may remove it, which is the only case
 * where somebody else's judgement is the last one available.
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
    and (
      exists (
        select 1 from public.nodes n
        where n.id = p_node_id and n.created_by = (select auth.uid())
      )
      or exists (
        select 1
        from public.nodes n
        join public.spaces s on s.id = n.space_id
        where n.id = p_node_id
          and n.created_by is null
          and s.owner_id = (select auth.uid())
      )
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
        -- Work that is nobody's does not block the space owner either, or the
        -- exception above would stop at the first folder.
        and not (
          beneath.created_by is null
          and exists (
            select 1 from public.nodes n
            join public.spaces s on s.id = n.space_id
            where n.id = p_node_id and s.owner_id = (select auth.uid())
          )
        )
    ),
    false
  );
$$;

/** Whether this node could be sent home, for the screens. */
create or replace function public.can_evict_node(p_node_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    exists (
      select 1
      from public.nodes n
      join public.spaces s on s.id = n.space_id
      where n.id = p_node_id
        and s.owner_id = (select auth.uid())
        and n.created_by is not null
        and n.created_by <> (select auth.uid())
        and not (n.parent_id is null and n.slug = 'index')
    ),
    false
  );
$$;

-- Offered by the tree alongside the others. Recreated rather than replaced:
-- the returned row type gains a column, and Postgres will not change that in
-- place.
drop function if exists public.space_node_rights(uuid);

create function public.space_node_rights(p_space_id uuid)
returns table (
  node_id uuid,
  may_edit boolean,
  may_delete boolean,
  may_share boolean,
  may_evict boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    n.id,
    public.can_edit(n.id),
    public.can_delete_node(n.id),
    public.can_admin(n.id),
    public.can_evict_node(n.id)
  from public.nodes n
  where n.space_id = p_space_id
    and public.can_read(n.id);
$$;

revoke all on function public.free_top_level_slug(uuid, text) from public, anon;
revoke all on function public.relocate_subtree(uuid, uuid) from public, anon, authenticated;
revoke all on function public.home_space_for(uuid) from public, anon, authenticated;
revoke all on function public.move_my_node_to_space(uuid, uuid) from public, anon;
revoke all on function public.evict_node(uuid) from public, anon;
revoke all on function public.can_evict_node(uuid) from public, anon;

grant execute on function public.free_top_level_slug(uuid, text)
  to authenticated, service_role;
grant execute on function public.move_my_node_to_space(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.evict_node(uuid) to authenticated, service_role;
grant execute on function public.can_evict_node(uuid) to authenticated, service_role;

revoke all on function public.space_node_rights(uuid) from public, anon;
grant execute on function public.space_node_rights(uuid) to authenticated, service_role;
