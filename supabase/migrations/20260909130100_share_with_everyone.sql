-- Everything that uses the new grantee type.
--
-- Separate from the migration that adds it, because Postgres will not let a new
-- enum value be used in the same transaction that adds it.

-- A grant to everyone names no grantee, in the same way a public one does not.
alter table public.grants
  drop constraint if exists grants_grantee_id_matches_type;
alter table public.grants
  add constraint grants_grantee_id_matches_type check (
    (grantee_type in ('public', 'authenticated') and grantee_id is null)
    or (grantee_type not in ('public', 'authenticated') and grantee_id is not null)
  );

-- One per node, as for public.
create unique index if not exists grants_unique_authenticated
  on public.grants (node_id)
  where grantee_type = 'authenticated';

/**
 * A grant to everyone may not confer admin.
 *
 * Viewer and editor are both things somebody might reasonably want for a whole
 * organisation: a handbook everyone reads, a wiki everyone writes. Admin is the
 * power to change who else can see a thing, and handing that to "everyone" is
 * not a decision anybody makes on purpose.
 */
create or replace function public.check_everyone_grant_role()
returns trigger
language plpgsql
as $$
begin
  if new.grantee_type = 'authenticated' and new.role = 'admin' then
    raise exception 'a grant to everyone cannot confer admin'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists grants_everyone_not_admin on public.grants;

create trigger grants_everyone_not_admin
  before insert or update on public.grants
  for each row execute function public.check_everyone_grant_role();

-- Resolution ------------------------------------------------------------------
--
-- The only change: a grant to `authenticated` matches anybody who is signed in.
-- An anonymous visitor still matches only `public`, which is what keeps "share
-- with everyone here" and "publish to the internet" different things.
create or replace function public.effective_role(p_user_id uuid, p_node_id uuid)
returns public.grant_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive ancestry as (
    select n.id, n.parent_id, n.space_id
    from public.nodes n
    where n.id = p_node_id

    union all

    select parent.id, parent.parent_id, parent.space_id
    from public.nodes parent
    join ancestry child on parent.id = child.parent_id
  ),
  granted as (
    select g.role
    from public.grants g
    join ancestry a on a.id = g.node_id
    where
      g.grantee_type = 'public'
      or (p_user_id is not null and g.grantee_type = 'authenticated')
      or (
        p_user_id is not null
        and g.grantee_type = 'user'
        and g.grantee_id = p_user_id
      )
      or (
        p_user_id is not null
        and g.grantee_type = 'team'
        and exists (
          select 1
          from public.team_members tm
          where tm.team_id = g.grantee_id
            and tm.user_id = p_user_id
        )
      )
  )
  select case
    when p_user_id is not null and exists (
      select 1
      from public.nodes n
      join public.spaces s on s.id = n.space_id
      where n.id = p_node_id
        and s.owner_id = p_user_id
    )
      then 'admin'::public.grant_role
    -- Enum comparison follows declaration order (viewer < editor < admin),
    -- so ordering descending yields the strongest matching grant.
    else (select g.role from granted g order by g.role desc limit 1)
  end;
$$;

/**
 * Shares a node with everyone who has an account, or stops doing so.
 *
 * A function for the same reason set_public is one: uniqueness here is a
 * partial index, which no client-side upsert can name in an ON CONFLICT
 * clause. Passing null for the role withdraws the grant.
 */
create or replace function public.set_shared_with_everyone(
  p_node_id uuid,
  p_role public.grant_role
)
returns public.grant_role
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(public.can_admin(p_node_id), false) is not true then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  if p_role is null then
    delete from public.grants
     where node_id = p_node_id and grantee_type = 'authenticated';
  else
    insert into public.grants (node_id, grantee_type, grantee_id, role)
    values (p_node_id, 'authenticated', null, p_role)
    on conflict (node_id) where grantee_type = 'authenticated'
    do update set role = excluded.role;
  end if;

  return p_role;
end;
$$;

revoke all on function public.set_shared_with_everyone(uuid, public.grant_role)
  from public, anon;
grant execute on function public.set_shared_with_everyone(uuid, public.grant_role)
  to authenticated, service_role;
