-- What a page used to say.
--
-- Nothing here is borrowed from Quartz, which has no versioning: its only
-- version-adjacent feature reads a last-modified date out of git, and Postit
-- has no repository to read. Content lives in Postgres because access is
-- decided per node, so history has to live there too.
--
-- The spine already existed. Every file carries a content_version, bumped on
-- each save and used for optimistic locking. What was missing was the bodies.

create table if not exists public.node_revisions (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes (id) on delete cascade,
  -- What the document was at. Not unique: a rename records a revision without
  -- bumping the save counter, so two rows can share one content_version.
  -- created_at is the ordering that means something.
  content_version integer not null,
  name text not null,
  content text,
  content_type public.content_type,
  -- Null when the account is gone. The revision is still the truth about what
  -- the page said, and losing it because somebody left would be worse than
  -- losing the attribution.
  author_id uuid references public.profiles (id) on delete set null,
  -- clock_timestamp, not now(). now() is the transaction's start time, so two
  -- revisions written in one transaction would share a timestamp and the
  -- history would have no defined order at exactly the moment it matters: a
  -- restore records a revision in the same transaction as the save it undoes.
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists node_revisions_node_idx
  on public.node_revisions (node_id, created_at desc);

alter table public.node_revisions enable row level security;

-- Exactly as reachable as the page it belongs to, through the same predicate
-- every other policy uses. A history with its own visibility rule would be a
-- second answer to "who can see this", and the second answer is always the one
-- that turns out to be wrong.
drop policy if exists node_revisions_select_readable on public.node_revisions;
create policy node_revisions_select_readable on public.node_revisions
  for select using (public.can_read(node_id));

-- No insert, update or delete policy, deliberately. Revisions are written by
-- the trigger below and by nothing else: a history somebody can decline to
-- write, or can go back and tidy, is not a history.

/**
 * Records what a page said, whenever that changes.
 *
 * A trigger rather than something the save path calls, because the save path
 * is not the only writer: MCP writes through the same table, and so does
 * anything added later. One place that cannot be forgotten beats three that
 * each have to remember.
 *
 * The author is whoever is asking. An MCP client acts as the person whose
 * token it carries, so a page Claude edited is attributed to them, which is
 * the truth: they are who authorised it.
 */
create or replace function public.record_node_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Folders have no body to keep.
  if new.kind <> 'file' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.content is not distinct from old.content
     and new.name is not distinct from old.name
     and new.content_type is not distinct from old.content_type then
    return new;
  end if;

  insert into public.node_revisions
    (node_id, content_version, name, content, content_type, author_id)
  values
    (new.id, new.content_version, new.name, new.content, new.content_type,
     (select auth.uid()));

  return new;
end;
$$;

drop trigger if exists nodes_record_revision on public.nodes;

-- After, not before: a revision should exist only for a write that happened.
create trigger nodes_record_revision
  after insert or update on public.nodes
  for each row execute function public.record_node_revision();

/**
 * Puts a page back to what an earlier revision said.
 *
 * Forward, never backward. The restore is an ordinary save that happens to
 * carry old text, so it bumps the version, records its own revision through
 * the trigger above, and is itself undoable. A history you can rewind is a
 * history somebody can quietly rewrite.
 *
 * Content and type only. The name is part of a page's address, and moving one
 * is move_node's job, with descendant paths to rewrite; doing it here would be
 * a second implementation of the same rule. The old name is still recorded and
 * shown, so nothing is lost but the one-click undo of a rename.
 */
create or replace function public.restore_node_revision(p_revision_id uuid)
returns public.nodes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision public.node_revisions;
  v_node public.nodes;
begin
  select * into v_revision
  from public.node_revisions
  where id = p_revision_id;

  -- Unreadable and nonexistent answer alike, as everywhere else.
  if v_revision.id is null
     or coalesce(public.can_read(v_revision.node_id), false) is not true then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  if coalesce(public.can_edit(v_revision.node_id), false) is not true then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  update public.nodes
     set content = v_revision.content,
         content_type = v_revision.content_type,
         content_version = content_version + 1,
         updated_at = now()
   where id = v_revision.node_id
  returning * into v_node;

  return v_node;
end;
$$;

revoke all on function public.restore_node_revision(uuid) from public, anon;
grant execute on function public.restore_node_revision(uuid)
  to authenticated, service_role;

/**
 * A page's history, with the author of each revision.
 *
 * Through a function for the same reason node_comments is one: profiles are
 * private, so a join for an author's address returns nothing when done as the
 * reader. Gated on the same can_read the select policy applies, so it
 * discloses nothing the table would not.
 */
create or replace function public.node_history(p_node_id uuid)
returns table (
  id uuid,
  content_version integer,
  name text,
  author_id uuid,
  author_email text,
  created_at timestamptz,
  characters integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    r.id,
    r.content_version,
    r.name,
    r.author_id,
    p.email,
    r.created_at,
    coalesce(length(r.content), 0)
  from public.node_revisions r
  left join public.profiles p on p.id = r.author_id
  where r.node_id = p_node_id
    and public.can_read(p_node_id)
  order by r.created_at desc;
$$;

revoke all on function public.node_history(uuid) from public;
grant execute on function public.node_history(uuid)
  to anon, authenticated, service_role;

-- A baseline for everything that already exists, so history starts today
-- rather than starting whenever a page next happens to be edited. The author
-- is null: nobody wrote this revision, it is a record of where we came in.
insert into public.node_revisions
  (node_id, content_version, name, content, content_type, author_id, created_at)
select n.id, n.content_version, n.name, n.content, n.content_type, null, n.updated_at
from public.nodes n
where n.kind = 'file'
  and not exists (
    select 1 from public.node_revisions r where r.node_id = n.id
  );
