-- The name is written Post-it.
--
-- The rename that came before this one wrote it closed up, and the product
-- spells it with the hyphen. Only what a person reads changes: the space's
-- slug stays `postit`, which is its address, and so do the identifiers a
-- client is told to type, the MCP server's own name among them. A name people
-- read and a name a machine matches on are different things, and the second
-- one is not worth breaking to tidy the first.
--
-- Case-sensitive on purpose. Every capitalised "Postit" in this space is
-- prose; every lowercase one is inside a configuration snippet somebody is
-- meant to copy verbatim, and rewriting those would hand them a connector
-- that does not connect.

do $$
declare
  v_space uuid;
begin
  select id into v_space from public.spaces where slug = 'postit';
  if v_space is null then
    raise notice 'no space here to rename';
    return;
  end if;

  update public.spaces set name = 'Post-it' where id = v_space and name <> 'Post-it';

  -- The name only, never the slug: the node at `index` is the space's own
  -- address, and a trigger refuses to let it move.
  update public.nodes
     set name = replace(name, 'Postit', 'Post-it'),
         content = replace(content, 'Postit', 'Post-it')
   where space_id = v_space
     and (name like '%Postit%' or content like '%Postit%');

  raise notice 'spelled with the hyphen now';
end $$;
