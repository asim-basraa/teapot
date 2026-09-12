-- Takes down the old inbox page.
--
-- Its contents were moved into the conversations table, and the writer that
-- appended to it was dropped, so it has been a second inbox that quietly never
-- updates again: the place you would naturally look, showing four notes with no
-- way to answer them, while the real inbox filled up elsewhere. Two inboxes is
-- worse than either one.
--
-- Deleted only when every note on it is accounted for in the new inbox. That
-- check is the point of this migration rather than a formality: the rescue was
-- keyed on the message and its minute, and if any note had failed to parse it
-- would still be here and this would be the thing that destroyed it. Better to
-- leave the page standing and have somebody wonder why.

do $$
declare
  v_page uuid;
  v_content text;
  v_unrescued integer;
begin
  select n.id, n.content into v_page, v_content
  from public.nodes n
  join public.spaces s on s.id = n.space_id
  where s.slug = 'postit' and n.slug = 'inbox' and n.parent_id is null;

  if v_page is null then
    return;
  end if;

  with chunks as (
    select btrim(
      regexp_replace(
        substring(c from position(E'\n' in c) + 1),
        '(^|\n)> ?', '\1', 'g'
      ),
      E' \n\r\t'
    ) as body
    from regexp_split_to_table(v_content, E'\n## ') with ordinality as t(c, i)
    where i > 1
  )
  select count(*) into v_unrescued
  from chunks
  where body <> ''
    and not exists (
      select 1 from public.note_messages m where m.body = chunks.body
    );

  if v_unrescued > 0 then
    raise notice 'inbox page kept: % note(s) not found in the new inbox', v_unrescued;
    return;
  end if;

  delete from public.nodes where id = v_page;
end $$;
