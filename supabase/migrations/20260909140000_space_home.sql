-- The space's home page is the space, not a file in it.
--
-- Every space is created with one node at the path `index`, which is what
-- /s/<slug> resolves to. It appeared in the file tree like any other page,
-- which meant it could be renamed from there. Renaming it rederives its slug,
-- so the space root stopped resolving and the space 404ed for everybody,
-- including its owner, with no way back through the interface.
--
-- The interface no longer offers it, but the guarantee belongs here: an
-- address that a rename can destroy is not an address.

create or replace function public.protect_space_home()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    -- Unless the space itself is going. A cascade from spaces deletes the
    -- parent row first, so its absence is how we tell "the space is being
    -- removed" from "somebody deleted its front page".
    if old.parent_id is null and old.slug = 'index'
       and exists (select 1 from public.spaces s where s.id = old.space_id) then
      raise exception 'the home page of a space cannot be deleted'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.parent_id is null and old.slug = 'index'
     and (new.slug is distinct from old.slug
          or new.path is distinct from old.path
          or new.parent_id is distinct from old.parent_id) then
    raise exception 'the home page of a space cannot be moved or renamed'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists nodes_protect_home on public.nodes;

-- Before the path trigger's own work and before move_node's rewrite, so the
-- refusal happens rather than being undone afterwards.
create trigger nodes_protect_home
  before update or delete on public.nodes
  for each row execute function public.protect_space_home();

-- Repair ---------------------------------------------------------------------
--
-- Spaces that already lost their home page this way. Three of five on staging,
-- which is how the report reached us. A space with no node at `index` does not
-- resolve at all, so this gives it one back, named after the space. The page
-- that was renamed away stays where it is: which node used to be the home is
-- not recoverable, and guessing would move somebody's work.
insert into public.nodes (space_id, parent_id, kind, name, slug, content)
select s.id, null, 'file', s.name, 'index',
       'This page is the front of the space. Replace it with something of your own.'
from public.spaces s
where not exists (
  select 1 from public.nodes n
  where n.space_id = s.id and n.parent_id is null and n.slug = 'index'
);
