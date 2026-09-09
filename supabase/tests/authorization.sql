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

-- Search ---------------------------------------------------------------------
--
-- Search is the easiest place in a product like this to leak: an index built
-- once and queried by everyone will happily quote a paragraph nobody was meant
-- to read. search_nodes runs as the caller and so is filtered by the same
-- policy that decides whether the page renders at all. These assertions check
-- that, from every side.

insert into public.nodes (id, space_id, parent_id, kind, name, content) values
  ('b0000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-000000000001', null, 'file','Open Roadmap',
   '# Open Roadmap' || chr(10) || chr(10) || 'The quarterly roadmap mentions kumquats.'),
  ('b0000000-0000-0000-0000-000000000007','a0000000-0000-0000-0000-000000000001', null, 'file','Severance Notes',
   '# Severance Notes' || chr(10) || chr(10) || 'The private roadmap mentions kumquats, and severance.');

insert into public.grants (node_id, grantee_type, grantee_id, role) values
  ('b0000000-0000-0000-0000-000000000006','user','44444444-4444-4444-4444-444444444444','viewer');

set local role authenticated;

select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select pg_temp.check('the owner finds both pages',
  (select count(*)::text from public.search_nodes(
     'a0000000-0000-0000-0000-000000000001','kumquats')), '2');
select pg_temp.check('a name outranks a passing mention in a body',
  (select name from public.search_nodes(
     'a0000000-0000-0000-0000-000000000001','roadmap') limit 1), 'Open Roadmap');

select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select pg_temp.check('a grantee finds only the page they were given',
  (select name from public.search_nodes(
     'a0000000-0000-0000-0000-000000000001','kumquats')), 'Open Roadmap');
-- The word appears only in the restricted page. Finding it, even without a
-- snippet, would confirm that page exists.
select pg_temp.check('a word unique to a restricted page finds nothing at all',
  (select count(*)::text from public.search_nodes(
     'a0000000-0000-0000-0000-000000000001','severance')), '0');

reset role;

set local role anon;
select set_config('request.jwt.claims','', true);
select pg_temp.check('an anonymous search finds nothing that was not published',
  (select count(*)::text from public.search_nodes(
     'a0000000-0000-0000-0000-000000000001','kumquats')), '0');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select public.set_public('b0000000-0000-0000-0000-000000000006', true);
reset role;

set local role anon;
select set_config('request.jwt.claims','', true);
select pg_temp.check('and finds a published page once it is published',
  (select name from public.search_nodes(
     'a0000000-0000-0000-0000-000000000001','kumquats')), 'Open Roadmap');
select pg_temp.check('while the restricted one stays invisible',
  (select count(*)::text from public.search_nodes(
     'a0000000-0000-0000-0000-000000000001','severance')), '0');
reset role;

-- Content types ---------------------------------------------------------------
--
-- A trigger, not a column default, keeps content_type consistent with kind: a
-- default would type folders too, and would not correct a caller who supplies
-- a type for one. Doing it in a trigger is what lets the check constraint be an
-- assertion rather than an error message users see.

insert into public.nodes (id, space_id, parent_id, kind, name, content) values
  ('b0000000-0000-0000-0000-000000000008','a0000000-0000-0000-0000-000000000001', null, 'file','Untyped Page','# untyped');
insert into public.nodes (id, space_id, parent_id, kind, name) values
  ('b0000000-0000-0000-0000-000000000009','a0000000-0000-0000-0000-000000000001', null, 'folder','Untyped Folder');

select pg_temp.check('a new page defaults to article',
  (select content_type::text from public.nodes
   where id = 'b0000000-0000-0000-0000-000000000008'), 'article');
select pg_temp.check('a folder carries no type',
  (select content_type::text from public.nodes
   where id = 'b0000000-0000-0000-0000-000000000009'), null);

-- A type asked for on a folder is discarded rather than rejected: the caller
-- gets a folder, which is what they asked for, and no row exists that the
-- constraint would refuse.
insert into public.nodes (id, space_id, parent_id, kind, name, content_type) values
  ('b0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001', null, 'folder','Typed Folder','skill');

select pg_temp.check('a type asked for on a folder is dropped',
  (select content_type::text from public.nodes
   where id = 'b0000000-0000-0000-0000-00000000000a'), null);

update public.nodes set content_type = 'skill'
 where id = 'b0000000-0000-0000-0000-000000000008';
select pg_temp.check('a page can be reclassified',
  (select content_type::text from public.nodes
   where id = 'b0000000-0000-0000-0000-000000000008'), 'skill');

-- Clearing the type on a file is not a way to make an untyped document.
update public.nodes set content_type = null
 where id = 'b0000000-0000-0000-0000-000000000008';
select pg_temp.check('clearing a page''s type puts it back to article',
  (select content_type::text from public.nodes
   where id = 'b0000000-0000-0000-0000-000000000008'), 'article');

select pg_temp.check('filtering by type finds documents, not folders',
  (select count(*)::text from public.nodes
   where space_id = 'a0000000-0000-0000-0000-000000000001'
     and content_type = 'article'
     and kind = 'folder'), '0');

-- MCP tokens ------------------------------------------------------------------
--
-- A token is a long-lived credential on the open internet, so the properties
-- that matter are: only its hash is stored, presenting the hash is not enough,
-- revocation and expiry take effect on the very next request, and nobody can
-- see anybody else's.

insert into public.mcp_tokens (id, user_id, name, token_hash) values
  ('d0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Owner laptop',
   encode(extensions.digest('tea_owner_secret','sha256'),'hex')),
  ('d0000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Alice laptop',
   encode(extensions.digest('tea_alice_secret','sha256'),'hex'));

select pg_temp.check('a live token resolves to its owner',
  (select user_id::text from public.resolve_mcp_token('tea_owner_secret')),
  '11111111-1111-1111-1111-111111111111');
select pg_temp.check('using a token records that it was used',
  (select (last_used_at is not null)::text from public.mcp_tokens
   where id = 'd0000000-0000-0000-0000-000000000001'), 'true');
select pg_temp.check('an unknown token resolves to nothing',
  (select count(*)::text from public.resolve_mcp_token('tea_not_a_token')), '0');

-- The point of storing hashes. If presenting the stored hash worked, a leaked
-- database would be enough to authenticate and the hashing would buy nothing.
select pg_temp.check('presenting the stored hash is not enough',
  (select count(*)::text from public.resolve_mcp_token(
     encode(extensions.digest('tea_owner_secret','sha256'),'hex'))), '0');

update public.mcp_tokens set revoked_at = now()
 where id = 'd0000000-0000-0000-0000-000000000001';
select pg_temp.check('a revoked token stops working on the next request',
  (select count(*)::text from public.resolve_mcp_token('tea_owner_secret')), '0');

update public.mcp_tokens set revoked_at = null, expires_at = now() - interval '1 minute'
 where id = 'd0000000-0000-0000-0000-000000000001';
select pg_temp.check('an expired token stops working too',
  (select count(*)::text from public.resolve_mcp_token('tea_owner_secret')), '0');

set local role authenticated;

select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select pg_temp.check('a person sees only their own tokens',
  (select count(*)::text from public.mcp_tokens), '1');
select pg_temp.check('and that one is theirs',
  (select name from public.mcp_tokens), 'Owner laptop');

select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select pg_temp.check('somebody with no tokens cannot tell that anyone has any',
  (select count(*)::text from public.mcp_tokens), '0');

reset role;

-- Comments ---------------------------------------------------------------
--
-- A comment is exactly as reachable as the page it is about, with one
-- narrowing: it also requires an account. Following can_read alone would mean
-- publishing a page publishes its conversation to the internet, in one click
-- and irreversibly once anything has cached it.

insert into public.nodes (id, space_id, parent_id, kind, name, content) values
  ('b0000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-000000000001', null, 'file','Discussed','# discussed');
insert into public.grants (node_id, grantee_type, grantee_id, role) values
  ('b0000000-0000-0000-0000-00000000000b','user','22222222-2222-2222-2222-222222222222','viewer');

set local role authenticated;

-- Reading is enough to comment: a viewer who spots a mistake should be able to
-- say so without being handed the power to edit.
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
insert into public.comments (id, node_id, author_id, body) values
  ('e0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b',
   '22222222-2222-2222-2222-222222222222','A viewer speaks');
select pg_temp.check('a viewer can comment on a page they can read',
  (select count(*)::text from public.node_comments('b0000000-0000-0000-0000-00000000000b')), '1');

do $$
begin
  begin
    insert into public.comments (node_id, author_id, body)
    values ('b0000000-0000-0000-0000-000000000004','22222222-2222-2222-2222-222222222222','Should not land');
    raise exception 'FAIL: commented on a page they cannot read';
  exception when sqlstate 'P0001' then raise;
       when others then null;  -- refused, as it must be
  end;
end $$;

do $$
begin
  begin
    insert into public.comments (node_id, author_id, body)
    values ('b0000000-0000-0000-0000-00000000000b','11111111-1111-1111-1111-111111111111','Forged');
    raise exception 'FAIL: posted a comment as somebody else';
  exception when sqlstate 'P0001' then raise;
       when others then null;  -- refused, as it must be
  end;
end $$;

-- Threading is one level deep, so a conversation stays followable and the data
-- matches the shape the panel can render.
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
insert into public.comments (id, node_id, author_id, parent_id, body) values
  ('e0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-00000000000b',
   '11111111-1111-1111-1111-111111111111','e0000000-0000-0000-0000-000000000001','The owner answers');
do $$
begin
  begin
    insert into public.comments (node_id, author_id, parent_id, body)
    values ('b0000000-0000-0000-0000-00000000000b','11111111-1111-1111-1111-111111111111',
            'e0000000-0000-0000-0000-000000000002','Too deep');
    raise exception 'FAIL: a reply was replied to';
  exception when sqlstate 'P0001' then raise;
       when others then null;  -- refused, as it must be
  end;
end $$;

select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select pg_temp.check('a stranger sees no conversation',
  (select count(*)::text from public.comments), '0');
select pg_temp.check('and the reading function tells them nothing either',
  (select count(*)::text from public.node_comments('b0000000-0000-0000-0000-00000000000b')), '0');
do $$
begin
  begin
    perform public.delete_comment('e0000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: a stranger deleted somebody''s comment';
  exception when sqlstate 'P0001' then raise;
       when others then null;  -- refused, as it must be
  end;
end $$;

-- An author may withdraw their own words, and withdrawing means the text is
-- gone, not merely flagged.
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select public.delete_comment('e0000000-0000-0000-0000-000000000001');
reset role;

select pg_temp.check('a withdrawn comment keeps none of its text',
  (select body from public.comments where id = 'e0000000-0000-0000-0000-000000000001'), '');
select pg_temp.check('and the reply it carried survives',
  (select body from public.comments where id = 'e0000000-0000-0000-0000-000000000002'), 'The owner answers');

-- Moderation: an administrator of the page may remove anybody's.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select public.delete_comment('e0000000-0000-0000-0000-000000000002');
reset role;

select pg_temp.check('an admin can remove a comment that is not theirs',
  (select (deleted_at is not null)::text from public.comments
   where id = 'e0000000-0000-0000-0000-000000000002'), 'true');

-- Publishing the page must not publish the conversation on it.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select public.set_public('b0000000-0000-0000-0000-00000000000b', true);
reset role;

set local role anon;
select set_config('request.jwt.claims','', true);
select pg_temp.check('an anonymous visitor can read the published page',
  (select count(*)::text from public.nodes
   where id = 'b0000000-0000-0000-0000-00000000000b'), '1');
select pg_temp.check('and sees none of its comments',
  (select count(*)::text from public.comments), '0');
reset role;

-- Sharing with everyone ------------------------------------------------------
--
-- The middle of the range: everyone who has an account, which is not the same
-- as the open internet. Its absence is what pushes people towards publishing
-- when all they meant was "the whole company".

insert into public.nodes (id, space_id, parent_id, kind, name) values
  ('b0000000-0000-0000-0000-00000000000c','a0000000-0000-0000-0000-000000000001', null, 'folder','Handbook');
insert into public.nodes (id, space_id, parent_id, kind, name, content) values
  ('b0000000-0000-0000-0000-00000000000d','a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000c','file','Leave','# leave');

select pg_temp.check('a stranger starts with no access to it',
  public.can_read('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-00000000000d')::text, 'false');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select public.set_shared_with_everyone('b0000000-0000-0000-0000-00000000000c','viewer');
reset role;

select pg_temp.check('everyone with an account can read it',
  public.can_read('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-00000000000c')::text, 'true');
select pg_temp.check('and everything beneath it',
  public.can_read('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-00000000000d')::text, 'true');

-- The distinction the whole feature exists for.
select pg_temp.check('an anonymous visitor still sees nothing',
  public.can_read(null,'b0000000-0000-0000-0000-00000000000c')::text, 'false');

select pg_temp.check('reading is not writing',
  public.can_edit('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-00000000000d')::text, 'false');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select public.set_shared_with_everyone('b0000000-0000-0000-0000-00000000000c','editor');
reset role;

select pg_temp.check('raising it to editor lets everyone write',
  public.can_edit('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-00000000000d')::text, 'true');
select pg_temp.check('and never administer',
  public.can_admin('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-00000000000d')::text, 'false');

-- Admin for everyone is the power to change who else can see a thing, which is
-- not a decision anybody makes on purpose. Refused at the table.
do $$
begin
  begin
    insert into public.grants (node_id, grantee_type, grantee_id, role)
    values ('b0000000-0000-0000-0000-000000000004','authenticated',null,'admin');
    raise exception 'FAIL: a grant to everyone conferred admin';
  exception when sqlstate 'P0001' then raise;
       when others then null;  -- refused, as it must be
  end;
end $$;

do $$
begin
  begin
    insert into public.grants (node_id, grantee_type, grantee_id, role)
    values ('b0000000-0000-0000-0000-000000000004','authenticated',
            '44444444-4444-4444-4444-444444444444','viewer');
    raise exception 'FAIL: a grant to everyone named a grantee';
  exception when sqlstate 'P0001' then raise;
       when others then null;  -- refused, as it must be
  end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.set_shared_with_everyone('b0000000-0000-0000-0000-000000000004','viewer');
    raise exception 'FAIL: a stranger shared somebody else''s node with everyone';
  exception when sqlstate 'P0001' then raise;
       when others then null;  -- refused, as it must be
  end;
end $$;

select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select public.set_shared_with_everyone('b0000000-0000-0000-0000-00000000000c', null);
reset role;

select pg_temp.check('withdrawing it takes the access with it',
  public.can_read('44444444-4444-4444-4444-444444444444','b0000000-0000-0000-0000-00000000000d')::text, 'false');

rollback;
