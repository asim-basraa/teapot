-- History as deltas, three deep.
--
-- A revision used to hold a whole copy of the page. Two saves of a long
-- document that differ by a word cost two whole documents, and the history
-- grew without bound: already, on a corpus of forty-five pages barely touched,
-- the revisions held more text than the pages did. That curve, not the live
-- content, is what eventually costs money.
--
-- Two changes, and they need each other. Only the last three versions are
-- kept, which bounds the count. And each one is stored as the difference from
-- the version after it, which shrinks what those three cost.
--
-- The deltas run backwards, from the present towards the past, and that is the
-- whole trick. What the page says now lives in nodes.content and is always
-- whole, so reading a recent version, which is the only kind anybody reads, is
-- one or two steps. More importantly, dropping the oldest row can never break
-- the chain, because nothing is ever reconstructed by walking up from the far
-- end. Forward deltas would have made retention and reconstruction fight each
-- other.
--
-- The newest row is the state the page is in, carrying an empty delta. It
-- costs a row and no text, and it keeps the history a list of versions with
-- the current one at its head, which is what the panel shows and what somebody
-- opening a history expects to see.

-- Two texts, and where they stop agreeing ------------------------------------
--
-- By halving rather than by stepping through characters. Each comparison is a
-- whole-string equality done in C, so this is a handful of them instead of one
-- interpreted loop iteration per character.

create or replace function public.common_prefix(a text, b text)
returns integer
language plpgsql
immutable
as $$
declare
  lo integer := 0;
  hi integer := least(length(a), length(b));
  mid integer;
begin
  while lo < hi loop
    mid := (lo + hi + 1) / 2;
    if left(a, mid) = left(b, mid) then lo := mid; else hi := mid - 1; end if;
  end loop;
  return lo;
end;
$$;

-- Bounded by what the prefix has already claimed, so the two cannot overlap
-- and describe the same characters twice.
create or replace function public.common_suffix(a text, b text, p_limit integer)
returns integer
language plpgsql
immutable
as $$
declare
  lo integer := 0;
  hi integer := greatest(p_limit, 0);
  mid integer;
begin
  while lo < hi loop
    mid := (lo + hi + 1) / 2;
    if right(a, mid) = right(b, mid) then lo := mid; else hi := mid - 1; end if;
  end loop;
  return lo;
end;
$$;

revoke all on function public.common_prefix(text, text) from public, anon, authenticated;
revoke all on function public.common_suffix(text, text, integer) from public, anon, authenticated;

-- The columns -----------------------------------------------------------------

alter table public.node_revisions
  add column if not exists prefix integer,
  add column if not exists suffix integer,
  add column if not exists middle text,
  -- Kept rather than derived: the panel shows how big each version was, and
  -- the answer should not cost a reconstruction to find out.
  add column if not exists characters integer;

-- Everything already recorded, rewritten as a chain ---------------------------
--
-- Walked newest first from what each page says now, which is exactly how the
-- chain is read, so the conversion and the reader cannot disagree about what a
-- row means.

do $$
declare
  n record;
  r record;
  v_newer text;
  v_prefix integer;
  v_suffix integer;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'node_revisions'
      and column_name = 'content'
  ) then
    return;
  end if;

  for n in select id, coalesce(content, '') as content from public.nodes where kind = 'file' loop
    v_newer := n.content;

    for r in
      select id, coalesce(content, '') as content
      from public.node_revisions
      where node_id = n.id
      order by created_at desc, id desc
    loop
      v_prefix := public.common_prefix(v_newer, r.content);
      v_suffix := public.common_suffix(
        v_newer, r.content,
        least(length(v_newer), length(r.content)) - v_prefix);

      update public.node_revisions
         set prefix = v_prefix,
             suffix = v_suffix,
             middle = substr(r.content, v_prefix + 1,
                             length(r.content) - v_prefix - v_suffix),
             characters = length(r.content)
       where id = r.id;

      v_newer := r.content;
    end loop;
  end loop;
end $$;

-- Anything left over from a page that no longer exists, or a row the loop
-- above could not reach, is not a chain anybody can read.
delete from public.node_revisions where prefix is null;

alter table public.node_revisions drop column if exists content;

alter table public.node_revisions
  alter column prefix set not null,
  alter column suffix set not null,
  alter column characters set not null;

-- Trim what is already there to the same depth the trigger will keep.
delete from public.node_revisions r
 using (
   select id,
          row_number() over (
            partition by node_id order by created_at desc, id desc
          ) as depth
   from public.node_revisions
 ) ranked
 where r.id = ranked.id and ranked.depth > 3;

-- Writing a revision ----------------------------------------------------------

/**
 * Records what a page said, whenever that changes.
 *
 * Still a trigger and still the only writer, for the reason it always was: the
 * save path is not the only way in, and a history somebody can decline to
 * write is not a history.
 *
 * Each save does two things. The row that stood for the old text is no longer
 * the newest, so it stops being an empty delta and becomes the difference from
 * the text that has just replaced it. Then the new text goes on top, empty,
 * because it is what nodes.content already holds.
 */
create or replace function public.record_node_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old text;
  v_new text;
  v_prefix integer;
  v_suffix integer;
  v_head uuid;
begin
  -- Folders have no body to keep.
  if new.kind <> 'file' then
    return new;
  end if;

  v_new := coalesce(new.content, '');

  if tg_op = 'INSERT' then
    insert into public.node_revisions
      (node_id, content_version, name, prefix, suffix, middle, characters,
       content_type, author_id)
    values
      (new.id, new.content_version, new.name, length(v_new), 0, '',
       length(v_new), new.content_type, (select auth.uid()));
    return new;
  end if;

  -- A save that changed nothing is not a version. Otherwise a history fills
  -- with entries saying that nothing happened.
  if new.content is not distinct from old.content
     and new.name is not distinct from old.name
     and new.content_type is not distinct from old.content_type then
    return new;
  end if;

  v_old := coalesce(old.content, '');

  select id into v_head
  from public.node_revisions
  where node_id = new.id
  order by created_at desc, id desc
  limit 1;

  if v_head is not null then
    v_prefix := public.common_prefix(v_new, v_old);
    v_suffix := public.common_suffix(
      v_new, v_old, least(length(v_new), length(v_old)) - v_prefix);

    update public.node_revisions
       set prefix = v_prefix,
           suffix = v_suffix,
           middle = substr(v_old, v_prefix + 1,
                           length(v_old) - v_prefix - v_suffix)
     where id = v_head;
  end if;

  insert into public.node_revisions
    (node_id, content_version, name, prefix, suffix, middle, characters,
     content_type, author_id)
  values
    (new.id, new.content_version, new.name, length(v_new), 0, '',
     length(v_new), new.content_type, (select auth.uid()));

  -- Three deep, and the oldest goes. Safe only because the deltas point
  -- backwards: every read starts at the present and walks down, so the far end
  -- of the chain is never load-bearing for anything nearer.
  delete from public.node_revisions
   where id in (
     select id from public.node_revisions
      where node_id = new.id
      order by created_at desc, id desc
      offset 3
   );

  return new;
end;
$$;

-- Reading one ------------------------------------------------------------------

/**
 * What a page said at one revision, put back together.
 *
 * Starts at what the page says now and applies every delta from there down to
 * the one asked for. At most three steps, by construction.
 *
 * Returns nothing rather than raising when the page cannot be read, which is
 * the same answer a revision that does not exist gives.
 */
create or replace function public.node_revision_text(p_revision_id uuid)
returns table (id uuid, name text, content text, content_type public.content_type)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rev public.node_revisions;
  v_text text;
  r record;
begin
  select * into v_rev from public.node_revisions where node_revisions.id = p_revision_id;

  if v_rev.id is null
     or coalesce(public.can_read(v_rev.node_id), false) is not true then
    return;
  end if;

  select coalesce(n.content, '') into v_text
  from public.nodes n where n.id = v_rev.node_id;

  for r in
    select nr.prefix, nr.suffix, nr.middle
    from public.node_revisions nr
    where nr.node_id = v_rev.node_id
      and (nr.created_at, nr.id) >= (v_rev.created_at, v_rev.id)
    order by nr.created_at desc, nr.id desc
  loop
    v_text := left(v_text, r.prefix) || coalesce(r.middle, '') || right(v_text, r.suffix);
  end loop;

  return query select v_rev.id, v_rev.name, v_text, v_rev.content_type;
end;
$$;

revoke all on function public.node_revision_text(uuid) from public;
grant execute on function public.node_revision_text(uuid)
  to anon, authenticated, service_role;

-- Restoring --------------------------------------------------------------------

create or replace function public.restore_node_revision(p_revision_id uuid)
returns public.nodes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision public.node_revisions;
  v_text text;
  v_type public.content_type;
  v_node public.nodes;
begin
  select * into v_revision
  from public.node_revisions
  where node_revisions.id = p_revision_id;

  -- Unreadable and nonexistent answer alike, as everywhere else.
  if v_revision.id is null
     or coalesce(public.can_read(v_revision.node_id), false) is not true then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  if coalesce(public.can_edit(v_revision.node_id), false) is not true then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  select t.content, t.content_type into v_text, v_type
  from public.node_revision_text(p_revision_id) t;

  update public.nodes
     set content = v_text,
         content_type = v_type,
         content_version = content_version + 1,
         updated_at = now()
   where nodes.id = v_revision.node_id
  returning * into v_node;

  return v_node;
end;
$$;

revoke all on function public.restore_node_revision(uuid) from public, anon;
grant execute on function public.restore_node_revision(uuid)
  to authenticated, service_role;

-- Listing ----------------------------------------------------------------------

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
    r.characters
  from public.node_revisions r
  left join public.profiles p on p.id = r.author_id
  where r.node_id = p_node_id
    and public.can_read(p_node_id)
  order by r.created_at desc, r.id desc;
$$;

revoke all on function public.node_history(uuid) from public;
grant execute on function public.node_history(uuid)
  to anon, authenticated, service_role;
