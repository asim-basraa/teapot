-- The smallest thing that looks like Supabase to these migrations.
--
-- Enough of it to apply every migration and run the authorization suite against
-- an ordinary local Postgres: the API roles, the auth schema, and the two
-- functions every policy in this schema is written against. It is not Supabase
-- and is not trying to be. There is no PostgREST, no GoTrue and no storage, so
-- the end-to-end tests still need the real thing; what this buys is the suite,
-- which is the part that decides whether the access rules are right.
--
-- Worth having because the alternative is a six-minute round trip through CI to
-- read one line of psql output, and because that output is not retrievable
-- afterwards: GitHub truncates the step log, so a failed check is invisible
-- unless you happen to be watching it live.
-- Supabase keeps pgcrypto in an `extensions` schema and code says so.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Roles live in the cluster, not the database, so they outlive a drop.
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated','service_role','supabase_auth_admin'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit', r);
    end if;
  end loop;
  if not exists (select 1 from pg_roles where rolname='service_role' and rolbypassrls) then
    execute 'alter role service_role bypassrls';
  end if;
end $$;
-- Quietly, since the grant survives a database drop as the roles do, and says
-- so on every run after the first.
set client_min_messages to warning;
grant anon, authenticated, service_role to postgres;
reset client_min_messages;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  last_sign_in_at timestamptz,
  banned_until timestamptz,
  created_at timestamptz not null default now()
);

-- nullif on the empty string matters: the suite clears the claims to become an
-- anonymous visitor, and ''::json is an error rather than a null.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', ''
  )::uuid;
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb
  );
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', ''
  );
$$;

-- Supabase hands the API roles access to everything in public and lets RLS do
-- the deciding. Without this every policy would be unreachable behind a plain
-- permission denied.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
