-- Moves the notes that landed on the old page into the new inbox.
--
-- When the conversations were built I claimed no inbox page had ever been
-- created and dropped the old function on that basis. That was true when it was
-- checked and stopped being true a few hours later, when the first notes
-- arrived. Nothing was lost, because the page still holds them, but they were
-- stranded on a page that no longer receives anything while the new inbox sat
-- empty beside it. This is the repair.
--
-- The old writer recorded only the words: append_to_inbox took a message and
-- nothing else, so nobody's identity was captured even for somebody signed in
-- at the time. These arrive as anonymous threads because that is genuinely all
-- there is to know about them, and they cannot be replied to for the same
-- reason. That is a fact about the old code, not about the people who sent them.
--
-- Idempotent, and a no-op everywhere the page does not exist: CI's database and
-- staging have never had one, so this runs there and does nothing.

do $$
declare
  v_page uuid;
  v_content text;
  v_note uuid;
  r record;
begin
  select n.id, n.content into v_page, v_content
  from public.nodes n
  join public.spaces s on s.id = n.space_id
  where s.slug = 'postit' and n.slug = 'inbox' and n.parent_id is null;

  if v_page is null then
    return;
  end if;

  for r in
    with chunks as (
      select c as chunk
      from regexp_split_to_table(v_content, E'\n## ') with ordinality as t(c, i)
      where i > 1  -- the first chunk is the page's own preamble, not a note
    )
    select
      to_timestamp(btrim(split_part(chunk, E'\n', 1)), 'DD Mon YYYY, HH24:MI') as sent_at,
      -- Strip the quote marker the old writer added to every line so that a note
      -- containing a fence could not take the page apart.
      btrim(
        regexp_replace(
          substring(chunk from position(E'\n' in chunk) + 1),
          '(^|\n)> ?', '\1', 'g'
        ),
        E' \n\r\t'
      ) as body
    from chunks
  loop
    continue when r.body is null or r.body = '';

    -- Idempotent on the pair, so running this twice cannot double anybody's
    -- joke. Two different notes sent in the same minute with the same words
    -- would collapse into one, which is a trade worth making against the
    -- alternative of duplicating all of them on a re-run.
    if exists (
      select 1 from public.note_messages m
      where m.body = r.body and m.created_at = r.sent_at
    ) then
      continue;
    end if;

    insert into public.notes (sender_id, created_at, last_message_at)
    values (null, r.sent_at, r.sent_at)
    returning id into v_note;

    insert into public.note_messages (note_id, author_id, body, created_at)
    values (v_note, null, r.body, r.sent_at);
  end loop;
end $$;
