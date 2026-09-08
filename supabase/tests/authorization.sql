-- Authorization test suite.
--
-- These are the security tests of the product. Every access decision in Teapot
-- is made by effective_role and its can_read / can_edit / can_admin wrappers,
-- so this file is where that decision is held to account.
--
-- Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/authorization.sql
--
-- Everything happens inside a transaction that is rolled back, so the suite
-- leaves no trace and can be run against any environment safely.

begin;

-- Assertion helper. Raises on the first mismatch, naming the case, so a
-- failure in CI points straight at the rule that broke.
create function pg_temp.check(
  p_case text,
  p_actual text,
  p_expected text
) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % (expected %, got %)',
      p_case, p_expected, coalesce(p_actual, 'null');
  end if;
  raise notice 'pass: %', p_case;
end;
$$;

-- Fixtures -------------------------------------------------------------------
--
--   owner   owns the space
--   alice   granted directly on one deep file
--   bob     member of the engineers team
--   carol   no relationship to anything
--
--   projects/                 (folder)
--     deep/                   (folder)
--       note                  (file)
--   private                   (file, nothing granted on it)

insert into auth.users (id, instance_id, aud, role, email) values
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@test.local'),
  ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','alice@test.local'),
  ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bob@test.local'),
  ('44444444-4444-4444-4444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','carol@test.local');

-- No explicit profiles insert: the handle_new_user trigger on auth.users
-- creates them. Letting it do so keeps the fixture faithful to how real
-- accounts come into being, and quietly asserts that the trigger works.
select pg_temp.check('signing up provisions a profile',
  (select count(*)::text from public.profiles
   where email like '%@test.local'), '4');

insert into public.spaces (id, slug, name, owner_id) values
  ('a0000000-0000-0000-0000-000000000001','authz-test','Authz Test',
   '11111111-1111-1111-1111-111111111111');

insert into public.nodes (id, space_id, parent_id, kind, name) values
  ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001', null, 'folder','Projects'),
  ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','folder','Deep');
insert into public.nodes (id, space_id, parent_id, kind, name, content) values
  ('b0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','file','Note','# note'),
  ('b0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000001', null, 'file','Private','# private');

insert into public.teams (id, space_id, name) values
  ('c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Engineers');
insert into public.team_members (team_id, user_id) values
  ('c0000000-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333');

-- Alice: viewer on the deep file only.
insert into public.grants (node_id, grantee_type, grantee_id, role) values
  ('b0000000-0000-0000-0000-000000000003','user','22222222-2222-2222-2222-222222222222','viewer');
-- Engineers: editor on the top folder, so bob inherits through two levels.
insert into public.grants (node_id, grantee_type, grantee_id, role) values
  ('b0000000-0000-0000-0000-000000000001','team','c0000000-0000-0000-0000-000000000001','editor');

-- Owner bypass ---------------------------------------------------------------

select pg_temp.check('owner reads a deep file',
  public.can_read('11111111-1111-1111-1111-111111111111','b0000000-0000-0000-0000-000000000003')::text, 'true');
select pg_temp.check('owner holds admin without any grant',
  public.effective_role('11111111-1111-1111-1111-111111111111','b0000000-0000-0000-0000-000000000003')::text, 'admin');
select pg_temp.check('owner reads a node nobody was granted',
  public.can_read('11111111-1111-1111-1111-111111111111','b0000000-0000-0000-0000-000000000004')::text, 'true');

-- Direct grants --------------------------------------------------------------

select pg_temp.check('direct grant on a file grants read',
  public.can_read('22222222-2222-2222-2222-222222222222','b0000000-0000-0000-0000-000000000003')::text, 'true');
select pg_temp.check('direct grant resolves to its own role',
  public.effective_role('22222222-2222-2222-2222-222222222222','b0000000-0000-0000-0000-000000000003')::text, 'viewer');
select pg_temp.check('viewer cannot edit',
  public.can_edit('22222222-2222-2222-2222-222222222222','b0000000-0000-0000-0000-000000000003')::text, 'false');
select pg_temp.check('viewer cannot admin',
  public.can_admin('22222222-2222-2222-2222-222222222222','b0000000-0000-0000-0000-000000000003')::text, 'false');

-- A grant reaches down, never up. This is the rule that stops a single shared
-- file from exposing the folder it happens to live in.
select pg_temp.check('grant on a file does not expose its parent',
  public.can_read('22222222-2222-2222-2222-222222222222','b0000000-0000-0000-0000-000000000002')::text, 'false');
select pg_temp.check('grant on a file does not expose its grandparent',
  public.can_read('22222222-2222-2222-2222-222222222222','b0000000-0000-0000-0000-000000000001')::text, 'false');
select pg_temp.check('grant on a file does not expose a sibling branch',
  public.can_read('22222222-2222-2222-2222-222222222222','b0000000-0000-0000-0000-000000000004')::text, 'false');

-- Inheritance through teams --------------------------------------------------

select pg_temp.check('team grant inherits two levels down',
  public.can_read('33333333-3333-3333-3333-333333333333','b0000000-0000-0000-0000-000000000003')::text, 'true');
select pg_temp.check('inherited role carries its strength',
  public.effective_role('33333333-3333-3333-3333-333333333333','b0000000-0000-0000-0000-000000000003')::text, 'editor');
select pg_temp.check('team editor can edit a descendant',
  public.can_edit('33333333-3333-3333-3333-333333333333','b0000000-0000-0000-0000-000000000003')::text, 'true');
select pg_temp.check('editor is still not an admin',
  public.can_admin('33333333-3333-3333-3333-333333333333','b0000000-0000-0000-0000-000000000003')::text, 'false');
select pg_temp.check('team grant does not reach outside its subtree',
  public.can_read('33333333-3333-3333-3333-333333333333','b0000000-0000-0000-0000-000000000004')::text, 'false');

-- Strangers and anonymous ----------------------------------------------------

select pg_temp.check('a stranger reads nothing',
  public.can_read('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-000000000003')::text, 'false');
select pg_temp.check('a stranger has no role at all',
  coalesce(public.effective_role('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-000000000003')::text,'null'), 'null');
select pg_temp.check('anonymous reads nothing without a public grant',
  public.can_read(null,'b0000000-0000-0000-0000-000000000003')::text, 'false');
select pg_temp.check('a nonexistent node is denied, not errored',
  public.can_read('11111111-1111-1111-1111-111111111111','99999999-9999-9999-9999-999999999999')::text, 'false');

-- Max wins across overlapping grants ----------------------------------------

-- Alice joins the team, so she now holds viewer directly and editor through
-- the team. The stronger role must win, not the more specific one.
insert into public.team_members (team_id, user_id) values
  ('c0000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');

select pg_temp.check('union of user and team grants takes the maximum',
  public.effective_role('22222222-2222-2222-2222-222222222222','b0000000-0000-0000-0000-000000000003')::text, 'editor');
select pg_temp.check('the stronger role brings its capability',
  public.can_edit('22222222-2222-2222-2222-222222222222','b0000000-0000-0000-0000-000000000003')::text, 'true');

-- Public grants --------------------------------------------------------------

insert into public.grants (node_id, grantee_type, grantee_id, role) values
  ('b0000000-0000-0000-0000-000000000004','public',null,'viewer');

select pg_temp.check('a public grant admits anonymous readers',
  public.can_read(null,'b0000000-0000-0000-0000-000000000004')::text, 'true');
select pg_temp.check('a public grant admits signed-in strangers',
  public.can_read('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-000000000004')::text, 'true');
select pg_temp.check('a public grant confers no write access',
  public.can_edit(null,'b0000000-0000-0000-0000-000000000004')::text, 'false');
select pg_temp.check('a public grant on one file does not leak others',
  public.can_read(null,'b0000000-0000-0000-0000-000000000003')::text, 'false');

-- Revocation -----------------------------------------------------------------

delete from public.team_members
 where team_id = 'c0000000-0000-0000-0000-000000000001'
   and user_id = '22222222-2222-2222-2222-222222222222';
delete from public.grants
 where node_id = 'b0000000-0000-0000-0000-000000000003'
   and grantee_type = 'user';

select pg_temp.check('revoking every route removes access',
  public.can_read('22222222-2222-2222-2222-222222222222','b0000000-0000-0000-0000-000000000003')::text, 'false');
select pg_temp.check('revoking one user leaves others untouched',
  public.can_read('33333333-3333-3333-3333-333333333333','b0000000-0000-0000-0000-000000000003')::text, 'true');

delete from public.grants
 where node_id = 'b0000000-0000-0000-0000-000000000004' and grantee_type = 'public';

select pg_temp.check('revoking a public grant re-hides the node',
  public.can_read(null,'b0000000-0000-0000-0000-000000000004')::text, 'false');

-- Sign-up gating -------------------------------------------------------------

insert into public.invitations (email, expires_at) values
  ('guest@outside.test', now() + interval '7 days'),
  ('stale@outside.test', now() - interval '1 day');

select pg_temp.check('an allowed domain may sign up',
  public.hook_restrict_signup_by_email_domain('{"user":{"email":"someone@maqsoodlabs.com"}}'::jsonb)::text, '{}');
select pg_temp.check('domain matching ignores case',
  public.hook_restrict_signup_by_email_domain('{"user":{"email":"Someone@MaqsoodLabs.com"}}'::jsonb)::text, '{}');
select pg_temp.check('an outside domain is refused',
  (public.hook_restrict_signup_by_email_domain('{"user":{"email":"someone@gmail.com"}}'::jsonb) -> 'error' ->> 'http_code'), '403');
select pg_temp.check('a live invitation overrides the domain rule',
  public.hook_restrict_signup_by_email_domain('{"user":{"email":"guest@outside.test"}}'::jsonb)::text, '{}');
select pg_temp.check('an expired invitation does not',
  (public.hook_restrict_signup_by_email_domain('{"user":{"email":"stale@outside.test"}}'::jsonb) -> 'error' ->> 'http_code'), '403');
select pg_temp.check('a missing address is refused',
  (public.hook_restrict_signup_by_email_domain('{"user":{}}'::jsonb) -> 'error' ->> 'http_code'), '400');

-- Three-valued logic ---------------------------------------------------------
--
-- Regression tests for a real vulnerability. effective_role returns NULL for a
-- user with no role, and `NULL = 'admin'` is NULL, not false. can_admin
-- therefore answered NULL, and a guard written `if not can_admin(...) then
-- raise` never fired, because `not NULL` is NULL and IF only branches on true.
-- grant_to_email fell straight through its own authorization check.
--
-- RLS hid this completely: a policy expression that is not true denies the
-- row, so NULL and false are indistinguishable there. These assertions check
-- the exact value, not merely its truthiness, because that difference is the
-- whole bug.

select pg_temp.check('can_read answers false, never null, for a stranger',
  public.can_read('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-000000000003')::text, 'false');
select pg_temp.check('can_edit answers false, never null, for a stranger',
  public.can_edit('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-000000000003')::text, 'false');
select pg_temp.check('can_admin answers false, never null, for a stranger',
  public.can_admin('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-000000000003')::text, 'false');
select pg_temp.check('negation of a stranger check is usable in a guard',
  (not public.can_admin('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-000000000003'))::text, 'true');
select pg_temp.check('can_admin answers false for a viewer, never null',
  public.can_admin('22222222-2222-2222-2222-222222222222','b0000000-0000-0000-0000-000000000003')::text, 'false');
select pg_temp.check('predicates answer false for a node that does not exist',
  public.can_admin('11111111-1111-1111-1111-111111111111','99999999-9999-9999-9999-999999999999')::text, 'false');

-- Sharing --------------------------------------------------------------------

set local role authenticated;

-- A stranger must not be able to share, and must not learn anything about
-- which addresses have accounts by trying.
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.grant_to_email(
      'b0000000-0000-0000-0000-000000000001','alice@test.local','admin');
    raise exception 'FAIL: a stranger was allowed to share a node';
  exception when sqlstate 'P0001' then raise;
       when others then null;  -- refused, as it must be
  end;
end $$;

-- The owner can share, and re-sharing changes the role rather than failing.
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select pg_temp.check('owner shares by email',
  (public.grant_to_email('b0000000-0000-0000-0000-000000000004','carol@test.local','viewer')).role::text,
  'viewer');
select pg_temp.check('sharing again changes the role',
  (public.grant_to_email('b0000000-0000-0000-0000-000000000004','carol@test.local','editor')).role::text,
  'editor');

reset role;

select pg_temp.check('the shared node is now readable by its grantee',
  public.can_read('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-000000000004')::text, 'true');
select pg_temp.check('sharing one node does not expose the rest',
  public.can_read('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-000000000003')::text, 'false');

-- Hand the fixture back as the next section expects to find it: carol is a
-- stranger again, which is what the RLS checks below assert against.
delete from public.grants
 where node_id = 'b0000000-0000-0000-0000-000000000004'
   and grantee_id = '44444444-4444-4444-4444-444444444444';

select pg_temp.check('revoking a shared grant removes access again',
  public.can_read('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-000000000004')::text, 'false');

-- RLS enforcement ------------------------------------------------------------
--
-- The predicates being correct is necessary but not sufficient: the policies
-- have to actually use them. These check the database refuses to hand over
-- rows even when the application asks for everything.

insert into public.grants (node_id, grantee_type, grantee_id, role) values
  ('b0000000-0000-0000-0000-000000000003','user','22222222-2222-2222-2222-222222222222','viewer');

set local role authenticated;

select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select pg_temp.check('RLS shows a grantee only what they were granted',
  (select count(*)::text from public.nodes), '1');
select pg_temp.check('RLS hides grant rows from a non-admin',
  (select count(*)::text from public.grants), '0');

select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select pg_temp.check('RLS shows a stranger nothing',
  (select count(*)::text from public.nodes), '0');
select pg_temp.check('RLS hides the space itself from a stranger',
  (select count(*)::text from public.spaces), '0');

select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select pg_temp.check('RLS shows the owner everything in their space',
  (select count(*)::text from public.nodes), '4');

reset role;

set local role anon;
select set_config('request.jwt.claims','', true);
select pg_temp.check('RLS shows an anonymous visitor no nodes',
  (select count(*)::text from public.nodes), '0');
select pg_temp.check('RLS shows an anonymous visitor no profiles',
  (select count(*)::text from public.profiles), '0');
reset role;

-- Teams ----------------------------------------------------------------------
--
-- Team membership is the one route to a node whose meaning changes after the
-- grant is made: the folder is shared once, and who that reaches depends on a
-- roster edited later. These check that managing the roster is as guarded as
-- making the grant, and that a team cannot be pointed at another space.

-- A second space, owned by carol, so a team can be borrowed across a boundary.
insert into public.spaces (id, slug, name, owner_id) values
  ('a0000000-0000-0000-0000-000000000002','other-space','Other Space',
   '44444444-4444-4444-4444-444444444444');
insert into public.teams (id, space_id, name) values
  ('c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','Outsiders');

select pg_temp.check('owns_team_space answers false, never null, for a team that does not exist',
  public.owns_team_space('c0000000-0000-0000-0000-000000000009')::text, 'false');

set local role authenticated;

-- A stranger must not be able to edit somebody else's roster, and must not
-- learn from the attempt whether the team or the address exists.
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select pg_temp.check('a stranger does not own the team space',
  public.owns_team_space('c0000000-0000-0000-0000-000000000001')::text, 'false');
do $$
begin
  begin
    perform public.add_team_member(
      'c0000000-0000-0000-0000-000000000001','carol@test.local','member');
    raise exception 'FAIL: a stranger was allowed to add a team member';
  exception when sqlstate 'P0001' then raise;
       when others then null;  -- refused, as it must be
  end;
end $$;
select pg_temp.check('a stranger reading a roster gets nothing',
  (select count(*)::text from public.team_roster('c0000000-0000-0000-0000-000000000001')), '0');

-- The owner manages their own team.
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select pg_temp.check('the owner adds a member by email',
  (public.add_team_member('c0000000-0000-0000-0000-000000000001','carol@test.local','member')).user_id::text,
  '44444444-4444-4444-4444-444444444444');
select pg_temp.check('adding again changes the team role rather than failing',
  (public.add_team_member('c0000000-0000-0000-0000-000000000001','carol@test.local','manager')).role::text,
  'manager');
select pg_temp.check('the owner sees the whole roster',
  (select count(*)::text from public.team_roster('c0000000-0000-0000-0000-000000000001')), '2');

-- A team may only be granted access inside its own space. Without this, an
-- administrator could point a roster the space owner cannot see at their
-- content, and every later membership change would silently move the boundary.
do $$
begin
  begin
    perform public.grant_to_team(
      'b0000000-0000-0000-0000-000000000004',
      'c0000000-0000-0000-0000-000000000002',
      'viewer');
    raise exception 'FAIL: a team from another space was granted access';
  exception when sqlstate 'P0001' then raise;
       when others then null;  -- refused, as it must be
  end;
end $$;

select pg_temp.check('a team from the same space can be granted',
  (public.grant_to_team(
     'b0000000-0000-0000-0000-000000000004',
     'c0000000-0000-0000-0000-000000000001',
     'viewer')).role::text,
  'viewer');

reset role;

-- Carol reaches the file only through her new membership.
select pg_temp.check('joining a team confers the team grant',
  public.can_read('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-000000000004')::text, 'true');
select pg_temp.check('joining a team confers every grant that team holds',
  public.can_edit('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-000000000003')::text, 'true');
select pg_temp.check('and no more than the role those grants carry',
  public.can_admin('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-000000000003')::text, 'false');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select public.remove_team_member(
  'c0000000-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444444');
reset role;

select pg_temp.check('leaving the team takes the access with it',
  public.can_read('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-000000000004')::text, 'false');
select pg_temp.check('the remaining member keeps theirs',
  public.can_read('33333333-3333-3333-3333-333333333333','b0000000-0000-0000-0000-000000000003')::text, 'true');

-- Deleting a team removes the access it conferred, rather than leaving a grant
-- pointing at nothing.
insert into public.team_members (team_id, user_id) values
  ('c0000000-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444444');
select pg_temp.check('rejoining restores it',
  public.can_read('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-000000000004')::text, 'true');

delete from public.teams where id = 'c0000000-0000-0000-0000-000000000001';

select pg_temp.check('deleting the team removes the grant it carried',
  public.can_read('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-000000000004')::text, 'false');
select pg_temp.check('and the grant row is gone, not orphaned',
  (select count(*)::text from public.grants where grantee_type = 'team'), '0');

-- Publishing -----------------------------------------------------------------
--
-- A public grant is the one grant with no grantee to revoke, so what it can
-- say matters more than usual: viewer, never anything stronger, on any path
-- that writes the row.

insert into public.nodes (id, space_id, parent_id, kind, name, content) values
  ('b0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','file','Published','# published');

set local role authenticated;

select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.set_public('b0000000-0000-0000-0000-000000000001', true);
    raise exception 'FAIL: a stranger published somebody else''s node';
  exception when sqlstate 'P0001' then raise;
       when others then null;  -- refused, as it must be
  end;
end $$;

select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select public.set_public('b0000000-0000-0000-0000-000000000001', true);
-- Idempotent: publishing an already-published node is not an error and does
-- not accumulate grants.
select public.set_public('b0000000-0000-0000-0000-000000000001', true);

reset role;

select pg_temp.check('publishing twice leaves one grant',
  (select count(*)::text from public.grants
   where grantee_type = 'public'
     and node_id = 'b0000000-0000-0000-0000-000000000001'), '1');
select pg_temp.check('an anonymous visitor can read a published folder',
  public.can_read(null,'b0000000-0000-0000-0000-000000000001')::text, 'true');
select pg_temp.check('publishing a folder publishes what is under it',
  public.can_read(null,'b0000000-0000-0000-0000-000000000005')::text, 'true');
select pg_temp.check('a node outside the published subtree stays hidden',
  public.can_read(null,'b0000000-0000-0000-0000-000000000004')::text, 'false');
select pg_temp.check('publishing confers no write access',
  public.can_edit(null,'b0000000-0000-0000-0000-000000000005')::text, 'false');

-- A public grant stronger than viewer would mean anyone on the internet can
-- change or reshare the page. Refused at the table, not merely in the helper.
do $$
begin
  begin
    insert into public.grants (node_id, grantee_type, grantee_id, role)
    values ('b0000000-0000-0000-0000-000000000004','public',null,'editor');
    raise exception 'FAIL: a public grant conferred editor';
  exception when sqlstate 'P0001' then raise;
       when others then null;  -- refused, as it must be
  end;
end $$;

set local role anon;
select set_config('request.jwt.claims','', true);
-- Projects, Deep, Note and Published: the whole subtree under the published
-- folder. Private, which sits outside it, is not among them.
select pg_temp.check('RLS hands an anonymous visitor the published subtree and nothing else',
  (select count(*)::text from public.nodes), '4');
select pg_temp.check('and the space that contains it, so the page can render',
  (select count(*)::text from public.spaces), '1');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select public.set_public('b0000000-0000-0000-0000-000000000001', false);
reset role;

select pg_temp.check('unpublishing hides it again',
  public.can_read(null,'b0000000-0000-0000-0000-000000000005')::text, 'false');

-- Policy recursion -----------------------------------------------------------
--
-- Regression tests for a real outage. The policy on `teams` asked whether you
-- were a member, which read `team_members`, whose policy asked which space the
-- team belonged to, which read `teams` again. Postgres refuses a query with a
-- policy cycle outright (42P17), so team management failed completely the
-- moment anything selected the table as an ordinary user.
--
-- It hid for as long as it did because `teams` was only ever read from inside
-- effective_role, which is SECURITY DEFINER and applies no policies at all.
--
-- These assertions do not check a value so much as that the queries run: any
-- of them raising is the cycle back.

insert into public.teams (id, space_id, name) values
  ('c0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001','Recursion Check');

set local role authenticated;

select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select pg_temp.check('the owner reads back a team without recursing',
  (select name from public.teams where id = 'c0000000-0000-0000-0000-00000000000a'),
  'Recursion Check');
select pg_temp.check('the owner adds a member',
  (public.add_team_member('c0000000-0000-0000-0000-00000000000a','bob@test.local','member')).role::text,
  'member');

select set_config('request.jwt.claims','{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select pg_temp.check('a member can see the team they are on',
  (select count(*)::text from public.teams
   where id = 'c0000000-0000-0000-0000-00000000000a'), '1');
select pg_temp.check('a member sees only their own membership row',
  (select count(*)::text from public.team_members), '1');
select pg_temp.check('a member cannot read the roster',
  (select count(*)::text from public.team_roster('c0000000-0000-0000-0000-00000000000a')), '0');

-- Alice owns nothing and is on nothing, so she is the honest stranger here.
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select pg_temp.check('a stranger sees no teams',
  (select count(*)::text from public.teams), '0');
select pg_temp.check('a stranger sees no memberships',
  (select count(*)::text from public.team_members), '0');

reset role;

rollback;
