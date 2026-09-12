-- Puts a name to the notes rescued off the old page.
--
-- The four notes moved across from the Markdown page arrived anonymous, because
-- the old writer recorded only the words: append_to_inbox took a message and
-- nothing else, so nobody's identity was captured even for somebody signed in
-- at the time. Anonymous meant unanswerable, which is the one thing the inbox
-- exists to avoid.
--
-- They were all sent by one person, who is named here. That is somebody's
-- testimony rather than something the database observed, and it is recorded as
-- a deliberate correction rather than presented as data that was always there.
-- It is corroborated as far as it can be: her account was created thirty-five
-- seconds before the first of them arrived, and no other account existed
-- between the first note and the last.
--
-- Keyed on the window rather than on the words, so nobody's jokes end up in the
-- repository, and narrow enough to be exact: sending has required an account
-- since, so no anonymous note can ever be created again, and these four are the
-- only ones there have ever been.

do $$
declare
  v_sender uuid;
  v_notes uuid[];
begin
  select id into v_sender
  from public.profiles
  where email = 'faryal.awais@maqsoodlabs.com';

  -- A no-op everywhere she does not have an account, which is every environment
  -- but production.
  if v_sender is null then
    return;
  end if;

  select array_agg(id) into v_notes
  from public.notes
  where sender_id is null
    and created_at >= timestamptz '2026-09-12 12:49:00+00'
    and created_at <= timestamptz '2026-09-12 13:10:00+00';

  if v_notes is null then
    return;
  end if;

  update public.notes
     set sender_id = v_sender
   where id = any(v_notes);

  -- The messages too, and not for tidiness: which side of a conversation a
  -- message sits on is read off author_id, so leaving these null would show her
  -- her own jokes as somebody else's.
  update public.note_messages
     set author_id = v_sender
   where note_id = any(v_notes)
     and author_id is null;
end $$;
