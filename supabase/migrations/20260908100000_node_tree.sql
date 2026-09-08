-- Tree mechanics for nodes: slugs, materialized paths, and atomic moves.

-- URL-safe slug from a display name. Kept in SQL so the path a trigger builds
-- and the path the app expects can never disagree.
create or replace function public.slugify(p_value text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      trim(both '-' from regexp_replace(lower(trim(p_value)), '[^a-z0-9]+', '-', 'g')),
      ''
    ),
    'untitled'
  );
$$;

-- `path` is derived, never supplied. A trigger owns it so an insert cannot
-- introduce a path that disagrees with the node's position in the tree.
create or replace function public.set_node_path()
returns trigger
language plpgsql
as $$
declare
  v_parent_path text;
begin
  if new.slug is null or new.slug = '' then
    new.slug := public.slugify(new.name);
  end if;

  if new.parent_id is null then
    new.path := new.slug;
  else
    select n.path into v_parent_path
    from public.nodes n
    where n.id = new.parent_id;

    if v_parent_path is null then
      raise exception 'parent node % does not exist', new.parent_id;
    end if;

    new.path := v_parent_path || '/' || new.slug;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists nodes_set_path on public.nodes;

create trigger nodes_set_path
  before insert on public.nodes
  for each row execute function public.set_node_path();

-- Only folders may have children. Enforced here rather than in the app so a
-- direct API call cannot build a tree the UI would refuse to draw.
create or replace function public.check_parent_is_folder()
returns trigger
language plpgsql
as $$
declare
  v_kind public.node_kind;
begin
  if new.parent_id is not null then
    select kind into v_kind from public.nodes where id = new.parent_id;
    if v_kind is distinct from 'folder' then
      raise exception 'parent node % is not a folder', new.parent_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists nodes_parent_is_folder on public.nodes;

create trigger nodes_parent_is_folder
  before insert or update of parent_id on public.nodes
  for each row execute function public.check_parent_is_folder();

/**
 * Renames and/or reparents a node, rewriting every descendant path.
 *
 * This is one function rather than app-side logic because the node and all of
 * its descendants must change together: a partial rewrite would leave children
 * pointing at a path their parent no longer has, and (space_id, path) is
 * unique, so a half-applied move can also collide with itself.
 *
 * SECURITY INVOKER, so RLS still applies: the caller needs edit on the node,
 * and on the destination folder when reparenting.
 */
create or replace function public.move_node(
  p_node_id uuid,
  p_new_parent_id uuid default null,
  p_new_name text default null,
  p_reparent boolean default false
)
returns public.nodes
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_node public.nodes;
  v_old_path text;
  v_new_path text;
  v_new_slug text;
  v_parent_path text;
  v_target_parent uuid;
begin
  select * into v_node from public.nodes where id = p_node_id;
  if not found then
    raise exception 'node % not found', p_node_id using errcode = 'no_data_found';
  end if;

  v_old_path := v_node.path;
  v_target_parent := case when p_reparent then p_new_parent_id else v_node.parent_id end;
  v_new_slug := case
    when p_new_name is null then v_node.slug
    else public.slugify(p_new_name)
  end;

  -- A node cannot become its own ancestor. Without this the subtree would be
  -- orphaned from the root and unreachable.
  if v_target_parent is not null then
    if v_target_parent = p_node_id then
      raise exception 'cannot move a node inside itself';
    end if;

    select path into v_parent_path from public.nodes where id = v_target_parent;
    if v_parent_path is null then
      raise exception 'destination folder % not found', v_target_parent;
    end if;
    if v_parent_path = v_old_path or v_parent_path like v_old_path || '/%' then
      raise exception 'cannot move a node inside its own subtree';
    end if;

    v_new_path := v_parent_path || '/' || v_new_slug;
  else
    v_new_path := v_new_slug;
  end if;

  if v_new_path = v_old_path then
    return v_node;
  end if;

  -- Descendants first. Doing the node itself first would break the prefix
  -- these rows are matched by.
  update public.nodes
     set path = v_new_path || substring(path from length(v_old_path) + 1),
         updated_at = now()
   where space_id = v_node.space_id
     and path like v_old_path || '/%';

  update public.nodes
     set parent_id = v_target_parent,
         name = coalesce(p_new_name, name),
         slug = v_new_slug,
         path = v_new_path,
         updated_at = now()
   where id = p_node_id
  returning * into v_node;

  return v_node;
end;
$$;

revoke all on function public.move_node(uuid, uuid, text, boolean) from public;
grant execute on function public.move_node(uuid, uuid, text, boolean)
  to authenticated, service_role;

revoke all on function public.slugify(text) from public;
grant execute on function public.slugify(text) to authenticated, service_role;
