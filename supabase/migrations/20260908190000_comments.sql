-- Comments on a page.
--
-- Visibility follows the node, so a comment is exactly as reachable as the
-- thing it is about, with one deliberate narrowing: comments require an
-- account. See the select policy.

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  -- One level of threading. Deeper nesting produces threads nobody can follow
  -- and a UI that runs out of horizontal room; a trigger below enforces it.
  parent_id uuid references public.comments (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  -- Soft, so deleting a comment that has replies does not take other people's
  -- words with it. A tombstone is shown in that case and nothing otherwise.
  deleted_at timestamptz,
  constraint comments_body_not_blank check (
    deleted_at is not null or length(btrim(body)) > 0
  )
);

create index if not exists comments_node_idx
  on public.comments (node_id, created_at);
create index if not exists comments_parent_idx
  on public.comments (parent_id);

alter table public.comments enable row level security;

/**
 * Replies may not have replies.
 *
 * Enforced here rather than in the client so the shape of the data matches the
 * shape the UI can actually render. A tree deeper than the renderer expects is
 * a bug that shows up as content nobody can see.
 */
create or replace function public.check_comment_depth()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent_node uuid;
  v_grandparent uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select node_id, parent_id into v_parent_node, v_grandparent
  from public.comments
  where id = new.parent_id;

  if v_parent_node is null then
    raise exception 'no such comment' using errcode = 'no_data_found';
  end if;

  if v_grandparent is not null then
    raise exception 'replies cannot themselves be replied to'
      using errcode = 'check_violation';
  end if;

  -- A reply belongs to the same page as the comment it answers. Without this a
  -- reply could be attached across a permission boundary and become visible to
  -- people who cannot read the conversation it belongs to.
  if v_parent_node <> new.node_id then
    raise exception 'a reply must be on the same page as its parent'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists comments_depth on public.comments;

create trigger comments_depth
  before insert or update on public.comments
  for each row execute function public.check_comment_depth();

-- Reading -------------------------------------------------------------------
--
-- Signed in, and able to read the page. The second half is the rule the PRD
-- asks for; the first is a deliberate narrowing.
--
-- Following can_read alone would mean publishing a page publishes its comments
-- to the internet, in one click, irreversibly once anything has cached them.
-- Comments are discussion *about* a document and are frequently candid in a
-- way the document is not, so extending a publish to them is a trade nobody
-- would knowingly make. Every signed-in reader sees exactly what the PRD
-- intends; anonymous visitors of a published page see the page and no
-- conversation.
-- The single-argument wrappers, as every other policy uses: the two-argument
-- forms take an arbitrary user id and are deliberately unreachable by anon and
-- authenticated, so a policy calling one is refused for everybody.
create policy comments_select_readable on public.comments
  for select using (
    (select auth.uid()) is not null
    and public.can_read(node_id)
  );

-- Writing -------------------------------------------------------------------
--
-- Reading the page is enough to comment on it: a viewer who spots a mistake
-- should be able to say so without being given the power to edit.
create policy comments_insert_reader on public.comments
  for insert with check (
    author_id = (select auth.uid())
    and public.can_read(node_id)
  );

-- No update policy, and that is the decision: a comment cannot be edited after
-- the fact. An edited comment in a thread other people have replied to
-- rewrites a conversation that has already happened.

-- Deleting is soft, so this is the policy that governs it. An author may
-- withdraw their own words, and an administrator of the page may remove
-- anybody's, which is what moderation means here.
create policy comments_update_own_or_admin on public.comments
  for update using (
    author_id = (select auth.uid())
    or public.can_admin(node_id)
  ) with check (
    author_id = (select auth.uid())
    or public.can_admin(node_id)
  );

/**
 * Withdraws a comment.
 *
 * Soft, and it blanks the body rather than merely flagging the row: a deleted
 * comment that still held its text would be one careless query away from being
 * undeleted, and "delete" has to mean the words are gone.
 *
 * Not security definer. The policy above already says who may do this, and
 * restating it here would be a second copy to fall out of step.
 */
create or replace function public.delete_comment(p_comment_id uuid)
returns void
language plpgsql
as $$
begin
  update public.comments
     set deleted_at = now(), body = ''
   where id = p_comment_id
     and deleted_at is null;

  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
end;
$$;

/**
 * A page's comments, with the author of each.
 *
 * Through a function because profiles are private: a reader can see only their
 * own row, so joining for an author's name would return nothing. Gated on
 * being able to read the page, which is the same condition the select policy
 * applies, so this discloses nothing the table would not.
 *
 * Only the address is exposed, and only for people already in a conversation
 * on a page the caller can read.
 */
create or replace function public.node_comments(p_node_id uuid)
returns table (
  id uuid,
  parent_id uuid,
  author_id uuid,
  author_email text,
  body text,
  created_at timestamptz,
  deleted boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    c.parent_id,
    c.author_id,
    p.email,
    c.body,
    c.created_at,
    c.deleted_at is not null
  from public.comments c
  join public.profiles p on p.id = c.author_id
  where c.node_id = p_node_id
    and (select auth.uid()) is not null
    and public.can_read(p_node_id)
  order by c.created_at;
$$;

revoke all on function public.delete_comment(uuid) from public, anon;
revoke all on function public.node_comments(uuid) from public, anon;

grant execute on function public.delete_comment(uuid) to authenticated, service_role;
grant execute on function public.node_comments(uuid) to authenticated, service_role;
