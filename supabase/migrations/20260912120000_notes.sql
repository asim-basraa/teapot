-- Replying to a note from the front page.
--
-- The joke box asks for nothing: no account, no address, no name. That was the
-- point, and it creates the problem this migration has to solve honestly rather
-- than around. You cannot privately reply to somebody you cannot identify, and
-- no amount of schema changes that.
--
-- So there are two kinds of note, and the difference is visible everywhere:
--
--   * Sent while signed in. It becomes a conversation with two people in it,
--     readable by exactly those two and nobody else.
--   * Sent by a stranger. It still arrives, still costs nothing to send, and
--     can be read by the inbox owner and replied to by nobody. The box says so
--     before you send rather than after.
--
-- The old inbox appended notes to a Markdown page. That could never carry
-- either half of this: no per-sender privacy, since a page has one access rule
-- for all of it, and no threading, since it is one blob of text. It is dropped
-- at the bottom. Nothing is lost with it, because no inbox page was ever
-- created in any environment.

/**
 * Whose inbox this is.
 *
 * The owner of the documentation space, which is what the old append_to_inbox
 * used too. One definition, so "who receives a note" and "who may answer one"
 * can never disagree.
 */
create or replace function public.inbox_owner()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select owner_id from public.spaces where slug = 'postit' limit 1;
$$;

/**
 * Whether the caller is the person notes are sent to.
 *
 * coalesce, and not for tidiness. Before the documentation space exists,
 * inbox_owner() is null, and `auth.uid() = null` is null rather than false. A
 * null flows into every `or` in the policies below, and this schema has already
 * been caught once by exactly that: three-valued logic once let any signed-in
 * user grant themselves administrator. Answer false or true, never neither.
 */
create or replace function public.is_inbox_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select auth.uid()) is not null and (select auth.uid()) = public.inbox_owner(),
    false
  );
$$;

-- A thread. One per note somebody started; replies hang off it.
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  -- Null when nobody was signed in. Such a thread has one participant, so it is
  -- readable by the inbox owner and answerable by nobody.
  sender_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Denormalised so the list can be ordered and marked unread without touching
  -- every message. Maintained by the trigger below, never by a client.
  last_message_at timestamptz not null default now(),
  owner_seen_at timestamptz,
  sender_seen_at timestamptz
);

create index if not exists notes_sender_idx on public.notes (sender_id);
create index if not exists notes_recent_idx on public.notes (last_message_at desc);

create table if not exists public.note_messages (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes (id) on delete cascade,
  -- Null means the anonymous sender who opened the thread. Everyone else is
  -- named, and the reader tells "mine" from "theirs" by comparing to their own
  -- id rather than by a flag that could disagree with the author.
  author_id uuid references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint note_messages_body_sane check (
    length(btrim(body)) > 0 and length(body) <= 2000
  )
);

create index if not exists note_messages_thread_idx
  on public.note_messages (note_id, created_at);

alter table public.notes enable row level security;
alter table public.note_messages enable row level security;

/**
 * Whether the caller is one of the two people in a thread.
 *
 * SECURITY DEFINER so that the policy on note_messages can ask it without
 * reaching into notes, which has policies of its own. The rest of this schema
 * learned that lesson the hard way: a policy that reads another protected table
 * is how the teams pair deadlocked into 42P17.
 */
create or replace function public.can_read_note(p_note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.notes n
    where n.id = p_note_id
      and (
        public.is_inbox_owner()
        or (n.sender_id is not null and n.sender_id = (select auth.uid()))
      )
  );
$$;

-- Reading only. Every write goes through a function below, so the rules about
-- who may answer whom live in one place rather than being spread across
-- policies that have to agree with each other.
create policy notes_select_participants on public.notes
  for select using (
    public.is_inbox_owner()
    or (notes.sender_id is not null and notes.sender_id = (select auth.uid()))
  );

create policy note_messages_select_participants on public.note_messages
  for select using (public.can_read_note(note_messages.note_id));

/**
 * Keeps last_message_at honest.
 *
 * A column a client could set is a column that will eventually say something
 * untrue about when a conversation was last touched, and the unread marks are
 * read off it.
 */
create or replace function public.touch_note()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.notes
     set last_message_at = new.created_at
   where id = new.note_id;
  return new;
end;
$$;

drop trigger if exists note_messages_touch_note on public.note_messages;
create trigger note_messages_touch_note
  after insert on public.note_messages
  for each row execute function public.touch_note();

/**
 * Starts a thread.
 *
 * service_role only, exactly as the old append_to_inbox was and for the same
 * reason: the endpoint carries the length cap and the throttle, and a second
 * door onto PostgREST would have neither. The sender is passed in rather than
 * read from auth.uid() because the endpoint calls this with the service key,
 * where auth.uid() is null; the endpoint reads the session itself and is the
 * only caller.
 */
create or replace function public.send_note(
  p_message text,
  p_sender_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_text text;
  v_note uuid;
begin
  v_text := btrim(coalesce(p_message, ''));
  if v_text = '' then
    raise exception 'nothing to say' using errcode = 'check_violation';
  end if;

  -- Bounded here as well as at the endpoint. The endpoint being the only caller
  -- is exactly the kind of fact that stops being true.
  v_text := left(v_text, 2000);

  insert into public.notes (sender_id) values (p_sender_id)
  returning id into v_note;

  insert into public.note_messages (note_id, author_id, body)
  values (v_note, p_sender_id, v_text);

  return v_note;
end;
$$;

/**
 * Adds a message to an existing thread.
 *
 * Either participant may, and nobody else. An anonymous thread has one
 * participant, so only the inbox owner can reach it — and a reply there would
 * be a message the sender can never read, which is worse than refusing, so it
 * is refused.
 */
create or replace function public.reply_to_note(
  p_note_id uuid,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_text text;
  v_sender uuid;
  v_exists boolean;
  v_me uuid := (select auth.uid());
  v_message uuid;
begin
  if v_me is null then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  v_text := btrim(coalesce(p_message, ''));
  if v_text = '' then
    raise exception 'nothing to say' using errcode = 'check_violation';
  end if;
  v_text := left(v_text, 2000);

  select true, n.sender_id into v_exists, v_sender
  from public.notes n where n.id = p_note_id;

  -- Unreadable and nonexistent answer the same way here as everywhere else in
  -- this product, so a stranger cannot learn which note ids are real.
  if v_exists is null then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  if public.is_inbox_owner() then
    if v_sender is null then
      raise exception 'nobody to reply to' using errcode = 'check_violation';
    end if;
  elsif v_sender is distinct from v_me then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  insert into public.note_messages (note_id, author_id, body)
  values (p_note_id, v_me, v_text)
  returning id into v_message;

  return v_message;
end;
$$;

/**
 * The threads the caller is in: every one for the inbox owner, their own for
 * anybody else.
 */
create or replace function public.note_threads()
returns table (
  note_id uuid,
  who text,
  anonymous boolean,
  opened_at timestamptz,
  last_message_at timestamptz,
  messages integer,
  preview text,
  unread boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    n.id,
    case
      when public.is_inbox_owner()
        then coalesce(p.email, 'Anonymous')
      else 'Post-it'
    end,
    n.sender_id is null,
    n.created_at,
    n.last_message_at,
    (select count(*)::integer from public.note_messages m where m.note_id = n.id),
    (select left(m.body, 140) from public.note_messages m
      where m.note_id = n.id order by m.created_at desc limit 1),
    case
      when public.is_inbox_owner()
        then n.owner_seen_at is null or n.last_message_at > n.owner_seen_at
      else n.sender_seen_at is null or n.last_message_at > n.sender_seen_at
    end
  from public.notes n
  left join public.profiles p on p.id = n.sender_id
  where public.is_inbox_owner()
     or (n.sender_id is not null and n.sender_id = (select auth.uid()))
  order by n.last_message_at desc
  limit 200;
$$;

/** Every message in one thread, oldest first, for the two people in it. */
create or replace function public.note_conversation(p_note_id uuid)
returns table (
  message_id uuid,
  body text,
  created_at timestamptz,
  from_owner boolean,
  mine boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    m.id,
    m.body,
    m.created_at,
    m.author_id is not null and m.author_id = public.inbox_owner(),
    m.author_id is not distinct from (select auth.uid())
  from public.note_messages m
  where m.note_id = p_note_id
    and public.can_read_note(p_note_id)
  order by m.created_at;
$$;

/** Marks a thread read, on whichever side the caller is standing. */
create or replace function public.mark_note_seen(p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.can_read_note(p_note_id) then
    return;
  end if;

  if public.is_inbox_owner() then
    update public.notes set owner_seen_at = now() where id = p_note_id;
  else
    update public.notes set sender_seen_at = now() where id = p_note_id;
  end if;
end;
$$;

/** How many threads have something the caller has not read. */
create or replace function public.unread_note_count()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer from public.note_threads() t where t.unread;
$$;

revoke all on function public.inbox_owner() from public, anon;
revoke all on function public.is_inbox_owner() from public, anon;
revoke all on function public.can_read_note(uuid) from public, anon;
revoke all on function public.send_note(text, uuid) from public, anon, authenticated;
revoke all on function public.reply_to_note(uuid, text) from public, anon;
revoke all on function public.note_threads() from public, anon;
revoke all on function public.note_conversation(uuid) from public, anon;
revoke all on function public.mark_note_seen(uuid) from public, anon;
revoke all on function public.unread_note_count() from public, anon;

grant execute on function public.inbox_owner() to authenticated, service_role;
grant execute on function public.is_inbox_owner() to authenticated, service_role;
grant execute on function public.can_read_note(uuid) to authenticated, service_role;
grant execute on function public.send_note(text, uuid) to service_role;
grant execute on function public.reply_to_note(uuid, text) to authenticated, service_role;
grant execute on function public.note_threads() to authenticated, service_role;
grant execute on function public.note_conversation(uuid) to authenticated, service_role;
grant execute on function public.mark_note_seen(uuid) to authenticated, service_role;
grant execute on function public.unread_note_count() to authenticated, service_role;

-- The page-based inbox is superseded. It could carry neither half of what was
-- asked for: a page has one access rule for all of it, so it cannot be private
-- per sender, and it is one blob of text, so it cannot hold a conversation.
-- No inbox page was ever created in any environment, so nothing goes with it.
drop function if exists public.append_to_inbox(text);
