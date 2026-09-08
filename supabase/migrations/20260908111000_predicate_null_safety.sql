-- Make can_edit and can_admin return a definite boolean.
--
-- SECURITY FIX. effective_role returns NULL when the user has no role at all,
-- and `NULL = 'admin'` is NULL rather than false. So can_admin answered NULL
-- for a stranger, and a procedural guard written as
--
--     if not public.can_admin(p_node_id) then raise ... end if;
--
-- never fired, because `not NULL` is NULL and an IF only branches on true.
-- grant_to_email therefore fell straight through its own authorization check,
-- letting any signed-in user grant themselves or anyone else access to any
-- node. Reproduced against staging before fixing.
--
-- RLS was never affected: a policy expression that is not true denies the row,
-- so NULL and false behave identically there. That is exactly why this hid.
-- The predicates are used in both settings, so they must be honest in both.
--
-- can_read was already safe, since `is not null` cannot itself yield NULL.

create or replace function public.can_edit(p_node_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.effective_role((select auth.uid()), p_node_id)
      in ('editor'::public.grant_role, 'admin'::public.grant_role),
    false
  );
$$;

create or replace function public.can_admin(p_node_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.effective_role((select auth.uid()), p_node_id) = 'admin'::public.grant_role,
    false
  );
$$;

create or replace function public.can_edit(p_user_id uuid, p_node_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.effective_role(p_user_id, p_node_id)
      in ('editor'::public.grant_role, 'admin'::public.grant_role),
    false
  );
$$;

create or replace function public.can_admin(p_user_id uuid, p_node_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.effective_role(p_user_id, p_node_id) = 'admin'::public.grant_role,
    false
  );
$$;

-- Belt and braces: even with the predicates fixed, the guard should not depend
-- on a function elsewhere never regressing to NULL again.
create or replace function public.grant_to_email(
  p_node_id uuid,
  p_email text,
  p_role public.grant_role
)
returns public.grants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target uuid;
  v_grant public.grants;
begin
  if coalesce(public.can_admin(p_node_id), false) is not true then
    -- Deliberately indistinguishable from a node that does not exist.
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  select id into v_target
  from public.profiles
  where lower(email) = lower(trim(p_email));

  if v_target is null then
    raise exception 'no account exists for %', trim(p_email)
      using errcode = 'P0002';
  end if;

  insert into public.grants (node_id, grantee_type, grantee_id, role)
  values (p_node_id, 'user', v_target, p_role)
  on conflict (node_id, grantee_type, grantee_id) where grantee_id is not null
  do update set role = excluded.role
  returning * into v_grant;

  return v_grant;
end;
$$;

revoke all on function public.grant_to_email(uuid, text, public.grant_role) from public, anon;
grant execute on function public.grant_to_email(uuid, text, public.grant_role)
  to authenticated, service_role;
