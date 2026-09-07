-- Close an information disclosure in the predicate surface.
--
-- The two-argument predicates are reachable over PostgREST as
-- /rest/v1/rpc/can_read etc. Because they take an arbitrary p_user_id, any
-- signed-in user could ask "can THAT user read THIS node?" and map the whole
-- permission graph without ever reading a byte of content. In a product whose
-- entire purpose is who-can-see-what, that is itself the leak.
--
-- Fix: the caller-scoped wrappers below take only a node id and answer solely
-- about the current user. They are what RLS policies and the app call. The
-- two-argument forms stay for server-side checks made with an explicit user
-- and for the test suite, but are no longer reachable by anon or authenticated.
-- The wrappers are SECURITY DEFINER, so their internal call to the two-argument
-- form runs as the definer and does not need the caller to hold EXECUTE.

create or replace function public.can_read(p_node_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.effective_role((select auth.uid()), p_node_id) is not null;
$$;

create or replace function public.can_edit(p_node_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.effective_role((select auth.uid()), p_node_id)
    in ('editor'::public.grant_role, 'admin'::public.grant_role);
$$;

create or replace function public.can_admin(p_node_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.effective_role((select auth.uid()), p_node_id) = 'admin'::public.grant_role;
$$;

revoke all on function public.can_read(uuid) from public;
revoke all on function public.can_edit(uuid) from public;
revoke all on function public.can_admin(uuid) from public;
grant execute on function public.can_read(uuid) to anon, authenticated, service_role;
grant execute on function public.can_edit(uuid) to anon, authenticated, service_role;
grant execute on function public.can_admin(uuid) to anon, authenticated, service_role;

-- The two-argument forms answer about *any* user, so they are service-side only.
revoke all on function public.effective_role(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_read(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_edit(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_admin(uuid, uuid) from public, anon, authenticated;
grant execute on function public.effective_role(uuid, uuid) to service_role;
grant execute on function public.can_read(uuid, uuid) to service_role;
grant execute on function public.can_edit(uuid, uuid) to service_role;
grant execute on function public.can_admin(uuid, uuid) to service_role;

-- Repoint every policy at the caller-scoped wrappers.

drop policy if exists spaces_select_readable on public.spaces;
create policy spaces_select_readable on public.spaces
  for select using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.nodes n
      where n.space_id = spaces.id and public.can_read(n.id)
    )
  );

drop policy if exists nodes_select_readable on public.nodes;
create policy nodes_select_readable on public.nodes
  for select using (public.can_read(id));

drop policy if exists nodes_insert_editable on public.nodes;
create policy nodes_insert_editable on public.nodes
  for insert with check (
    case
      when parent_id is null then exists (
        select 1 from public.spaces s
        where s.id = space_id and s.owner_id = (select auth.uid())
      )
      else public.can_edit(parent_id)
    end
  );

drop policy if exists nodes_update_editable on public.nodes;
create policy nodes_update_editable on public.nodes
  for update using (public.can_edit(id)) with check (public.can_edit(id));

drop policy if exists nodes_delete_editable on public.nodes;
create policy nodes_delete_editable on public.nodes
  for delete using (public.can_edit(id));

drop policy if exists grants_select_admin on public.grants;
create policy grants_select_admin on public.grants
  for select using (public.can_admin(node_id));

drop policy if exists grants_insert_admin on public.grants;
create policy grants_insert_admin on public.grants
  for insert with check (public.can_admin(node_id));

drop policy if exists grants_update_admin on public.grants;
create policy grants_update_admin on public.grants
  for update using (public.can_admin(node_id)) with check (public.can_admin(node_id));

drop policy if exists grants_delete_admin on public.grants;
create policy grants_delete_admin on public.grants
  for delete using (public.can_admin(node_id));

drop policy if exists links_select_both_ends_readable on public.links;
create policy links_select_both_ends_readable on public.links
  for select using (
    public.can_read(source_node_id) and public.can_read(target_node_id)
  );

drop policy if exists links_write_editable_source on public.links;
create policy links_write_editable_source on public.links
  for all using (public.can_edit(source_node_id))
  with check (public.can_edit(source_node_id));

-- These two tables are reachable only by the service role and the auth hook,
-- both of which bypass RLS. An explicit deny states that intent rather than
-- leaving it implied by the absence of any policy.
create policy invitations_no_direct_access on public.invitations
  for all using (false) with check (false);

create policy signup_email_domains_no_direct_access on public.signup_email_domains
  for all using (false) with check (false);
