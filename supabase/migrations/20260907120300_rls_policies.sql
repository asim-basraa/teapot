-- RLS policies. Every policy defers to the authorization predicates; no policy
-- reimplements an access rule. This is the second gate: even if a route handler
-- forgets a check, the database still refuses.
--
-- `signup_email_domains` and `invitations` deliberately get no policies. They
-- are reachable only by the service role and the auth hook, both of which
-- bypass RLS.

-- Profiles ------------------------------------------------------------------

create policy profiles_select_self on public.profiles
  for select using (id = (select auth.uid()));

create policy profiles_insert_self on public.profiles
  for insert with check (id = (select auth.uid()));

create policy profiles_update_self on public.profiles
  for update using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Spaces --------------------------------------------------------------------

-- A space is visible to its owner, and to anyone who can read at least one
-- node inside it.
create policy spaces_select_readable on public.spaces
  for select using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.nodes n
      where n.space_id = spaces.id
        and public.can_read((select auth.uid()), n.id)
    )
  );

create policy spaces_insert_own on public.spaces
  for insert with check (owner_id = (select auth.uid()));

create policy spaces_update_own on public.spaces
  for update using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy spaces_delete_own on public.spaces
  for delete using (owner_id = (select auth.uid()));

-- Nodes ---------------------------------------------------------------------

create policy nodes_select_readable on public.nodes
  for select using (public.can_read((select auth.uid()), id));

-- A root node needs space ownership; any other node needs edit on its parent.
create policy nodes_insert_editable on public.nodes
  for insert with check (
    case
      when parent_id is null then exists (
        select 1 from public.spaces s
        where s.id = space_id and s.owner_id = (select auth.uid())
      )
      else public.can_edit((select auth.uid()), parent_id)
    end
  );

create policy nodes_update_editable on public.nodes
  for update using (public.can_edit((select auth.uid()), id))
  with check (public.can_edit((select auth.uid()), id));

create policy nodes_delete_editable on public.nodes
  for delete using (public.can_edit((select auth.uid()), id));

-- Grants --------------------------------------------------------------------

-- Seeing who a node is shared with, and changing it, both require admin on it.
create policy grants_select_admin on public.grants
  for select using (public.can_admin((select auth.uid()), node_id));

create policy grants_insert_admin on public.grants
  for insert with check (public.can_admin((select auth.uid()), node_id));

create policy grants_update_admin on public.grants
  for update using (public.can_admin((select auth.uid()), node_id))
  with check (public.can_admin((select auth.uid()), node_id));

create policy grants_delete_admin on public.grants
  for delete using (public.can_admin((select auth.uid()), node_id));

-- Teams ---------------------------------------------------------------------

create policy teams_select_member_or_owner on public.teams
  for select using (
    exists (
      select 1 from public.spaces s
      where s.id = teams.space_id and s.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = teams.id and tm.user_id = (select auth.uid())
    )
  );

create policy teams_write_space_owner on public.teams
  for all using (
    exists (
      select 1 from public.spaces s
      where s.id = teams.space_id and s.owner_id = (select auth.uid())
    )
  ) with check (
    exists (
      select 1 from public.spaces s
      where s.id = teams.space_id and s.owner_id = (select auth.uid())
    )
  );

create policy team_members_select_self_or_owner on public.team_members
  for select using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.teams t
      join public.spaces s on s.id = t.space_id
      where t.id = team_members.team_id and s.owner_id = (select auth.uid())
    )
  );

create policy team_members_write_space_owner on public.team_members
  for all using (
    exists (
      select 1 from public.teams t
      join public.spaces s on s.id = t.space_id
      where t.id = team_members.team_id and s.owner_id = (select auth.uid())
    )
  ) with check (
    exists (
      select 1 from public.teams t
      join public.spaces s on s.id = t.space_id
      where t.id = team_members.team_id and s.owner_id = (select auth.uid())
    )
  );

-- Links ---------------------------------------------------------------------

-- A backlink is only visible when both ends are readable, so navigation
-- metadata cannot reveal a restricted page.
create policy links_select_both_ends_readable on public.links
  for select using (
    public.can_read((select auth.uid()), source_node_id)
    and public.can_read((select auth.uid()), target_node_id)
  );

create policy links_write_editable_source on public.links
  for all using (public.can_edit((select auth.uid()), source_node_id))
  with check (public.can_edit((select auth.uid()), source_node_id));
