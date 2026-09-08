-- Sharing: granting access to a node by email, and seeing who already has it.

/**
 * Grants a role on a node to the holder of an email address.
 *
 * SECURITY DEFINER because `profiles` is deliberately private: a user can read
 * only their own row, so nothing running as the caller could resolve someone
 * else's address to an id. That privacy is the point, and this function is the
 * one controlled hole in it.
 *
 * The hole is narrow. The caller must already hold admin on the node, checked
 * first and before the address is looked at, so this cannot be used to probe
 * for which addresses have accounts. A caller without admin gets the same
 * not-found they would get for a node that does not exist.
 *
 * Re-granting to the same person changes their role rather than failing, which
 * is what "share again with a different role" should mean.
 */
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
  if not public.can_admin(p_node_id) then
    -- Deliberately indistinguishable from a node that does not exist.
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  select id into v_target
  from public.profiles
  where lower(email) = lower(trim(p_email));

  if v_target is null then
    -- Safe to be specific: the caller is already an administrator of this
    -- node, so they are not a stranger fishing for addresses.
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

/**
 * Every grant that reaches a node, including those inherited from ancestors.
 *
 * Inherited rows cannot be read through the grants table directly: RLS there
 * requires admin on the grant's own node, and an admin of a child is not
 * necessarily an admin of its parent. So this is SECURITY DEFINER, gated on
 * admin of the node being asked about, and it reports where each grant comes
 * from so an audit can tell "shared here" from "inherited from Projects".
 */
create or replace function public.node_effective_grants(p_node_id uuid)
returns table (
  grant_id uuid,
  origin_node_id uuid,
  origin_path text,
  inherited boolean,
  grantee_type public.grantee_type,
  grantee_id uuid,
  grantee_email text,
  role public.grant_role
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive ancestry as (
    select n.id, n.parent_id, n.path
    from public.nodes n
    where n.id = p_node_id
    union all
    select parent.id, parent.parent_id, parent.path
    from public.nodes parent
    join ancestry child on parent.id = child.parent_id
  )
  select
    g.id,
    g.node_id,
    a.path,
    a.id <> p_node_id,
    g.grantee_type,
    g.grantee_id,
    p.email,
    g.role
  from public.grants g
  join ancestry a on a.id = g.node_id
  left join public.profiles p on p.id = g.grantee_id
  where public.can_admin(p_node_id)
  order by (a.id <> p_node_id), p.email nulls first;
$$;

revoke all on function public.grant_to_email(uuid, text, public.grant_role) from public, anon;
grant execute on function public.grant_to_email(uuid, text, public.grant_role)
  to authenticated, service_role;

revoke all on function public.node_effective_grants(uuid) from public, anon;
grant execute on function public.node_effective_grants(uuid)
  to authenticated, service_role;
