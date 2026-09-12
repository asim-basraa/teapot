-- Letting the people who write in a space start things in it.
--
-- Access here is per item and inherited downwards, which works everywhere
-- except the top of a space. A top-level item has no parent to inherit from, so
-- the insert policy fell back to ownership, and the owner was the only person
-- who could begin anything that was not already inside a folder they had been
-- given. Somebody with editor on half the space still had to ask.
--
-- So: if you already write in a space, you may start something at the top of
-- it. "Already write in it" means holding editor or admin on any item in the
-- space, which is a fact the grants table already knows and needs no new
-- concept, no new table and no new screen. Reading is untouched; this says only
-- who may create.
--
-- Three things follow from that and are here for the same reason:
--
--   * A top-level item has no parent, so its creator would inherit nothing and
--     be unable to read the thing they had just made. Creating one grants them
--     admin on it.
--   * Deleting is narrowed at the same time. An editor could delete anything
--     they could edit, including other people's work. Now an editor may delete
--     what they created, and an administrator may delete what they administer.
--   * Which needs a creator to be recorded at all, and nothing did.
--
-- Deleting a space, and deciding who may see one, are unchanged: both are the
-- owner's, and both already were.

-- Who made it ----------------------------------------------------------------

alter table public.nodes
  add column if not exists created_by uuid references public.profiles (id)
    on delete set null;

create index if not exists nodes_creator_idx on public.nodes (created_by);

/**
 * Records who made a node.
 *
 * Filled here rather than by the application for the same reason last_message_at
 * is: a column the client sets is a column that will eventually say something
 * untrue, and this one decides who may delete the row.
 */
create or replace function public.stamp_node_creator()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.created_by is null then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists nodes_stamp_creator on public.nodes;
create trigger nodes_stamp_creator
  before insert on public.nodes
  for each row execute function public.stamp_node_creator();

-- Everything that already exists is attributed to the owner of its space. That
-- is a guess, and it is the guess that takes nothing away: it makes existing
-- items undeletable by anybody but their space's owner and whoever
-- administers them, rather than handing them to whoever happens to be an
-- editor. A wrong attribution that withholds a power is recoverable; one that
-- grants it is not.
update public.nodes n
   set created_by = s.owner_id
  from public.spaces s
 where s.id = n.space_id
   and n.created_by is null;

-- Who may start something ----------------------------------------------------

/**
 * Whether the caller already writes somewhere in this space.
 *
 * Read off the grants directly rather than by asking can_edit about every node,
 * which would run the recursive ancestry walk once per item in the space. The
 * two agree because a grant of editor or admin is the only thing can_edit
 * answers true for, ownership aside, and ownership is checked separately by the
 * policy that calls this.
 */
create or replace function public.writes_in_space(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.grants g
      join public.nodes n on n.id = g.node_id
      where n.space_id = p_space_id
        and g.role in ('editor'::public.grant_role, 'admin'::public.grant_role)
        and (
          (g.grantee_type = 'user' and g.grantee_id = (select auth.uid()))
          or (
            g.grantee_type = 'team'
            and exists (
              select 1 from public.team_members tm
              where tm.team_id = g.grantee_id
                and tm.user_id = (select auth.uid())
            )
          )
          or g.grantee_type = 'authenticated'
        )
    ),
    false
  );
$$;

drop policy if exists nodes_insert_editable on public.nodes;
create policy nodes_insert_editable on public.nodes
  for insert with check (
    case
      when parent_id is null then
        exists (
          select 1 from public.spaces s
          where s.id = space_id and s.owner_id = (select auth.uid())
        )
        or public.writes_in_space(space_id)
      else public.can_edit(parent_id)
    end
  );

/**
 * Gives whoever made a top-level item the run of it.
 *
 * Without this the policy above would let somebody create a page and then not
 * be able to open it: nothing above a top-level node carries a grant, so they
 * would inherit nothing from anywhere. Admin rather than editor, because it is
 * theirs — they should be able to share it and to throw it away.
 *
 * The owner of the space is skipped: they are already admin everywhere, and a
 * row saying so would be noise in the sharing dialog's list of who has access.
 */
create or replace function public.grant_creator_top_level()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.parent_id is not null or new.created_by is null then
    return new;
  end if;

  if exists (
    select 1 from public.spaces s
    where s.id = new.space_id and s.owner_id = new.created_by
  ) then
    return new;
  end if;

  insert into public.grants (node_id, grantee_type, grantee_id, role, granted_by)
  values (new.id, 'user', new.created_by, 'admin', new.created_by)
  on conflict (node_id, grantee_type, grantee_id) where grantee_id is not null
  do nothing;

  return new;
end;
$$;

drop trigger if exists nodes_grant_creator on public.nodes;
create trigger nodes_grant_creator
  after insert on public.nodes
  for each row execute function public.grant_creator_top_level();

-- Who may throw it away ------------------------------------------------------

/**
 * Whether the caller may delete this node.
 *
 * Deleting used to be exactly editing, which meant an editor on a shared folder
 * could remove work that was not theirs. Now: the owner of the space may delete
 * anything in it, and everybody else may delete only what they made.
 *
 * Holding admin on something is deliberately not enough on its own. It is the
 * power to decide who may see a thing, which is not the same as the power to
 * destroy somebody else's work, and keeping them apart is what makes the rule
 * above sayable in one sentence.
 *
 * The descendants clause is the part that would be easy to leave out and would
 * make the rest of it decorative. Deleting a folder takes everything beneath it
 * through the cascade, so without it you could remove somebody else's page by
 * deleting the folder it happens to sit in — including a folder of your own
 * that they have since put something into.
 */
create or replace function public.can_delete_node(p_node_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    -- The owner of the space, who is admin of everything in it by definition
    -- and is the one person the rest of this does not apply to.
    exists (
      select 1
      from public.nodes n
      join public.spaces s on s.id = n.space_id
      where n.id = p_node_id and s.owner_id = (select auth.uid())
    )
    or (
      public.can_edit(p_node_id)
      and (select auth.uid()) is not null
      and exists (
        select 1 from public.nodes n
        where n.id = p_node_id and n.created_by = (select auth.uid())
      )
      and not exists (
        with recursive beneath as (
          select c.id, c.created_by
          from public.nodes c where c.parent_id = p_node_id
          union all
          select c.id, c.created_by
          from public.nodes c join beneath on c.parent_id = beneath.id
        )
        select 1 from beneath
        where beneath.created_by is distinct from (select auth.uid())
      )
    ),
    false
  );
$$;

drop policy if exists nodes_delete_editable on public.nodes;
create policy nodes_delete_editable on public.nodes
  for delete using (public.can_delete_node(id));

revoke all on function public.writes_in_space(uuid) from public, anon;
revoke all on function public.can_delete_node(uuid) from public, anon;
grant execute on function public.writes_in_space(uuid) to authenticated, service_role;
grant execute on function public.can_delete_node(uuid) to authenticated, service_role;

-- What the tree may offer ------------------------------------------------------

/**
 * Per-node rights for everything the caller can see in a space.
 *
 * The sidebar decided what to offer from one boolean — "do you own this space"
 * — which is why somebody with editor on half of it saw no controls anywhere,
 * including on the folders that were theirs to work in. Rights are per item
 * here, as the policies are, so the buttons on a row can say what that row
 * actually permits.
 *
 * This is presentation only. Every one of these questions is asked again by the
 * database when the write arrives, and the answer that counts is that one; a
 * screen that offered too much would be wrong rather than dangerous.
 *
 * One round trip for the whole tree rather than three questions per row.
 */
create or replace function public.space_node_rights(p_space_id uuid)
returns table (
  node_id uuid,
  may_edit boolean,
  may_delete boolean,
  may_share boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    n.id,
    public.can_edit(n.id),
    public.can_delete_node(n.id),
    public.can_admin(n.id)
  from public.nodes n
  where n.space_id = p_space_id
    and public.can_read(n.id);
$$;

revoke all on function public.space_node_rights(uuid) from public, anon;
grant execute on function public.space_node_rights(uuid) to authenticated, service_role;
