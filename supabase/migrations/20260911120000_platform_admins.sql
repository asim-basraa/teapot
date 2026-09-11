-- Somebody who administers the platform rather than a space.
--
-- Every power in this product until now has been about one node: who may read
-- it, who may write it, who may decide that for others. None of it answers the
-- questions a person running the thing has, which are about accounts rather
-- than pages. How many people are here. How much are they storing. Somebody
-- has left, so who owns their spaces now.
--
-- What an administrator can see is counts and sizes, and nothing else. Not one
-- word of anybody's writing. That is the whole point of the shape: the rule
-- every other decision in this schema serves is that a page you cannot read is
-- indistinguishable from a page that does not exist, and an administrator who
-- could read everything would be a permanent exception to it. The questions
-- actually being asked, how much and how many, do not need the text to answer,
-- so they are answered without it.
--
-- Content is attributed to whoever owns the space it is in. A page has no
-- owner of its own, and the person who owns the space is the person who is
-- accountable for what is in it.

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- The first one, because a power nobody holds cannot be granted to anybody.
update public.profiles set is_admin = true where email = 'asim@maqsoodlabs.com';

/**
 * Whether the caller administers the platform.
 *
 * Definer, because profiles are private to their owner and this has to read
 * somebody else's row to answer. Stable rather than volatile so one request
 * asking repeatedly costs one lookup.
 */
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = (select auth.uid())),
    false);
$$;

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;

/**
 * Everybody, with what they hold rather than what they wrote.
 *
 * Returns nothing at all to somebody who is not an administrator, which is the
 * same answer the rest of this schema gives for anything a caller may not
 * reach: absence, not refusal.
 */
create or replace function public.admin_users()
returns table (
  id uuid,
  email text,
  display_name text,
  is_admin boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  disabled boolean,
  spaces integer,
  articles integer,
  skills integer,
  folders integer,
  content_bytes bigint,
  history_bytes bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.email,
    p.display_name,
    p.is_admin,
    p.created_at,
    u.last_sign_in_at,
    (u.banned_until is not null and u.banned_until > now()) as disabled,
    coalesce(owned.spaces, 0),
    coalesce(held.articles, 0),
    coalesce(held.skills, 0),
    coalesce(held.folders, 0),
    coalesce(held.content_bytes, 0),
    coalesce(kept.history_bytes, 0)
  from public.profiles p
  join auth.users u on u.id = p.id
  left join lateral (
    select count(*)::integer as spaces
    from public.spaces s where s.owner_id = p.id
  ) owned on true
  left join lateral (
    select
      count(*) filter (where n.content_type = 'article')::integer as articles,
      count(*) filter (where n.content_type = 'skill')::integer as skills,
      count(*) filter (where n.kind = 'folder')::integer as folders,
      coalesce(sum(octet_length(coalesce(n.content, ''))), 0)::bigint as content_bytes
    from public.nodes n
    join public.spaces s on s.id = n.space_id
    where s.owner_id = p.id
  ) held on true
  left join lateral (
    -- What the history costs, which is the part that grows on its own.
    select coalesce(sum(octet_length(coalesce(r.middle, ''))), 0)::bigint as history_bytes
    from public.node_revisions r
    join public.nodes n on n.id = r.node_id
    join public.spaces s on s.id = n.space_id
    where s.owner_id = p.id
  ) kept on true
  where public.is_platform_admin()
  order by p.email;
$$;

revoke all on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated, service_role;

/** The spaces one person owns, for handing them to somebody else. */
create or replace function public.admin_user_spaces(p_user_id uuid)
returns table (id uuid, slug text, name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.slug, s.name
  from public.spaces s
  where s.owner_id = p_user_id
    and public.is_platform_admin()
  order by s.name;
$$;

revoke all on function public.admin_user_spaces(uuid) from public, anon;
grant execute on function public.admin_user_spaces(uuid) to authenticated, service_role;

/**
 * Appoints or stands down an administrator.
 *
 * Never the last one. A platform with nobody who can administer it has no way
 * back except somebody with the database password, and the person who clicks
 * this on themselves by accident is exactly the person who would then be
 * locked out of fixing it.
 */
create or replace function public.admin_set_admin(p_user_id uuid, p_is_admin boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  if p_is_admin is not true
     and (select count(*) from public.profiles where is_admin) <= 1
     and (select is_admin from public.profiles where id = p_user_id) is true then
    raise exception 'somebody has to be able to administer this'
      using errcode = 'check_violation';
  end if;

  update public.profiles set is_admin = coalesce(p_is_admin, false)
   where id = p_user_id;
end;
$$;

revoke all on function public.admin_set_admin(uuid, boolean) from public, anon;
grant execute on function public.admin_set_admin(uuid, boolean) to authenticated, service_role;

/**
 * Hands a space to somebody else.
 *
 * Ownership is where a space's administration comes from, so this is the whole
 * of what "they have left, it is yours now" means: the new owner administers
 * everything in it, and the old one keeps only whatever they were separately
 * granted, which for somebody who has left is nothing.
 */
create or replace function public.admin_transfer_space(p_space_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  if not exists (select 1 from public.profiles where id = p_new_owner) then
    raise exception 'no such person' using errcode = 'no_data_found';
  end if;

  update public.spaces set owner_id = p_new_owner where id = p_space_id;

  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
end;
$$;

revoke all on function public.admin_transfer_space(uuid, uuid) from public, anon;
grant execute on function public.admin_transfer_space(uuid, uuid) to authenticated, service_role;

/**
 * An account that still owns spaces cannot be deleted.
 *
 * Here rather than only in the code that deletes, because the consequence is
 * the one that cannot be undone: profiles cascade from auth.users, spaces
 * cascade from profiles, and nodes from spaces, so a single delete of an
 * account would otherwise take a team's writing with it, including pages that
 * person had shared with other people. Handing the spaces on first is a step
 * somebody can forget; a database that refuses cannot.
 */
create or replace function public.protect_owned_spaces()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.spaces where owner_id = old.id) then
    raise exception
      'this account still owns spaces; give them to somebody else first'
      using errcode = 'foreign_key_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists profiles_protect_owned_spaces on public.profiles;

create trigger profiles_protect_owned_spaces
  before delete on public.profiles
  for each row execute function public.protect_owned_spaces();
