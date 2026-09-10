-- The rename, for a database that already carries the space.
--
-- The product shipped as Teapot and is now Postit. A database seeded before
-- the change holds the old name in three places: the space's slug, which is
-- its address; the space's name; and the words of the pages it carries, which
-- are the product's own documentation and therefore say the product's name on
-- nearly every screen of it.
--
-- The seed migration alongside this one now creates the space already named,
-- so a database that has never seen it needs nothing from here and this is a
-- no-op there. Between the two, an old database and a new one end up saying
-- exactly the same thing, which is the only property that matters.
--
-- The address changes with the name. /s/teapot stops resolving and /s/postit
-- takes its place. That is what a rename is; leaving the old address working
-- would mean the product answers to two names, which is worse.
--
-- Only this space. Somebody else's page that happens to mention Teapot is
-- their writing, not ours, and rewriting it would be editing their work.

do $$
declare
  v_space uuid;
begin
  select id into v_space from public.spaces where slug = 'teapot';
  if v_space is null then
    raise notice 'no space under the old name here; nothing to rename';
    return;
  end if;

  update public.spaces
     set slug = 'postit', name = 'Postit'
   where id = v_space;

  -- The name only, never the slug. A node's slug is its address, and the one
  -- at `index` is the space's own: a trigger refuses to let it move, and
  -- rederiving it from the new name is exactly what once 404ed whole spaces.
  update public.nodes
     set name = replace(name, 'Teapot', 'Postit'),
         content = replace(replace(content, 'Teapot', 'Postit'), 'teapot', 'postit')
   where space_id = v_space
     and (name like '%Teapot%' or content like '%eapot%');

  raise notice 'the space is Postit now';
end $$;
