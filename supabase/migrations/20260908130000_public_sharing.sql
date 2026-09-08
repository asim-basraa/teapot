-- Public sharing: making a node readable without an account.
--
-- effective_role already matches public grants for a null user, so nothing
-- about the authorization path changes. What this adds is a way to create one
-- of those grants, and a guarantee about what it can say.

/**
 * A public grant may only ever be viewer.
 *
 * Editor or admin granted to `public` would mean anybody on the internet can
 * change or reshare the page, which is not a thing anyone means to do and is
 * not a mistake worth allowing. Enforced as a trigger rather than inside the
 * helper below so it holds on every write path, including a direct insert by
 * an administrator who knows the table.
 */
create or replace function public.check_public_grant_is_viewer()
returns trigger
language plpgsql
as $$
begin
  if new.grantee_type = 'public' and new.role <> 'viewer' then
    raise exception 'a public grant can only confer viewer'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists grants_public_is_viewer on public.grants;

create trigger grants_public_is_viewer
  before insert or update on public.grants
  for each row execute function public.check_public_grant_is_viewer();

/**
 * Publishes or unpublishes a node.
 *
 * A function rather than a client-side upsert for the same reason team grants
 * need one: uniqueness for public grants is a partial index, and inferring it
 * requires an ON CONFLICT clause carrying the same predicate. The admin check
 * is the one RLS would make; stating it is what makes the SECURITY DEFINER
 * safe, and a caller without admin gets the not-found they would get for a
 * node that does not exist.
 *
 * Publishing a folder publishes everything beneath it, because that is what
 * inheritance already means. There is no separate recursive operation, and no
 * second place where that rule could drift.
 */
create or replace function public.set_public(
  p_node_id uuid,
  p_public boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(public.can_admin(p_node_id), false) is not true then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  if p_public then
    insert into public.grants (node_id, grantee_type, grantee_id, role)
    values (p_node_id, 'public', null, 'viewer')
    on conflict (node_id) where grantee_type = 'public'
    do nothing;
  else
    delete from public.grants
     where node_id = p_node_id and grantee_type = 'public';
  end if;

  return p_public;
end;
$$;

revoke all on function public.set_public(uuid, boolean) from public, anon;

grant execute on function public.set_public(uuid, boolean)
  to authenticated, service_role;
