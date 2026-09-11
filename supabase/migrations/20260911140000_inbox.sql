-- A way for somebody on the front page to send a note.
--
-- The front page is public, so whatever writes this has no account behind it.
-- That makes three things matter more than they usually would.
--
-- It writes through one function rather than by inserting rows, so the append
-- is a single statement and two people sending at the same moment cannot lose
-- each other's note to a read-modify-write.
--
-- The function is callable by `service_role` and by nobody else. An anonymous
-- caller reaches it only through the endpoint, which is where the length cap
-- and the throttle live; granting it to `anon` would put a public write
-- endpoint on PostgREST with neither.
--
-- And the page it writes to carries no grant of its own, so it is readable by
-- whoever owns the space and by no one else. An inbox of notes from strangers
-- is not something to share with everyone who has an account.

create or replace function public.append_to_inbox(p_message text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_space uuid;
  v_node uuid;
  v_text text;
begin
  v_text := btrim(coalesce(p_message, ''));

  if v_text = '' then
    raise exception 'nothing to say' using errcode = 'check_violation';
  end if;

  -- Bounded here as well as at the endpoint. The endpoint is the only caller
  -- today, and that is exactly the kind of fact that stops being true.
  v_text := left(v_text, 2000);

  select id into v_space from public.spaces where slug = 'postit';
  if v_space is null then
    raise exception 'nowhere to put it' using errcode = 'no_data_found';
  end if;

  select id into v_node
  from public.nodes
  where space_id = v_space and parent_id is null and slug = 'inbox';

  if v_node is null then
    insert into public.nodes
      (space_id, parent_id, kind, name, slug, content, content_type)
    values
      (v_space, null, 'file', 'Inbox', 'inbox',
       E'Notes people have sent from the front page.\n\nThis page has no grant of its own, so it is yours and nobody else''s.\n',
       'article')
    returning id into v_node;
  end if;

  -- One statement, so the append is atomic. Quoted line by line, so a note
  -- containing a fence or a rule cannot take the rest of the page apart.
  update public.nodes
     set content = coalesce(content, '')
                   || E'\n## ' || to_char(now(), 'DD Mon YYYY, HH24:MI') || E'\n\n'
                   || '> ' || replace(v_text, E'\n', E'\n> ') || E'\n',
         content_version = content_version + 1,
         updated_at = now()
   where id = v_node;
end;
$$;

revoke all on function public.append_to_inbox(text) from public, anon, authenticated;
grant execute on function public.append_to_inbox(text) to service_role;
