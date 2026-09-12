-- Throwing a note away.
--
-- "Delete" has to mean one thing here rather than two, because a conversation
-- has two people in it, and the obvious implementations disagree about whose
-- copy goes.
--
-- Hiding it from one side and leaving it on the other was the first idea and it
-- is worse than it looks: the sender could then go on writing into a thread the
-- recipient no longer sees, which is a message nobody reads and nobody is told
-- about. An inbox that silently swallows things is not an inbox.
--
-- So it deletes, for both sides, and only the inbox owner may do it. That is
-- defensible because of whose inbox it is: these are notes sent *to* somebody,
-- and the person they were sent to decides what to keep. The sender is not
-- given the same power for the mirror-image reason — a note you have sent is
-- not yours to take back out of somebody's inbox.
--
-- The messages go with the thread through the cascade already on note_messages,
-- so there is no second rule to keep in step with this one.

/**
 * Deletes a conversation, if it is yours to delete.
 *
 * Refuses as not-found rather than as forbidden, like everything else here, so
 * naming a conversation id teaches a stranger nothing about whether it exists.
 */
create or replace function public.delete_note(p_note_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_inbox_owner() then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  delete from public.notes where id = p_note_id;

  -- False means there was nothing there, which the caller reports as not-found
  -- for the same reason: an id that never existed and an id already deleted are
  -- the same answer.
  return found;
end;
$$;

revoke all on function public.delete_note(uuid) from public, anon;
grant execute on function public.delete_note(uuid) to authenticated, service_role;
