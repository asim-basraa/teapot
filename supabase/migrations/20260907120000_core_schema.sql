-- Core schema: profiles, spaces, teams, nodes, grants, links, signup gating.
-- Every table is under RLS. Access decisions are made only by the predicates
-- defined in the companion authorization migration.

create extension if not exists pgcrypto;

-- Enums ---------------------------------------------------------------------

create type public.node_kind as enum ('folder', 'file');
create type public.grantee_type as enum ('user', 'team', 'public');
create type public.grant_role as enum ('viewer', 'editor', 'admin');
create type public.team_member_role as enum ('member', 'manager');
create type public.signup_email_domain_type as enum ('allow', 'deny');

-- Identity ------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

-- Spaces and teams ----------------------------------------------------------

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index spaces_owner_idx on public.spaces (owner_id);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (space_id, name)
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.team_member_role not null default 'member',
  primary key (team_id, user_id)
);

create index team_members_user_idx on public.team_members (user_id);

-- Content tree --------------------------------------------------------------

-- `path` is materialized (e.g. 'projects/roadmap') so a node is addressable by
-- URL without walking the tree. `content` holds markdown for kind='file';
-- `storage_path` points into Supabase Storage for attachments instead.
create table public.nodes (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  parent_id uuid references public.nodes (id) on delete cascade,
  kind public.node_kind not null,
  name text not null,
  slug text not null,
  path text not null,
  content text,
  storage_path text,
  content_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, path),
  -- Folders never carry content; files never carry children's concerns.
  constraint nodes_folder_has_no_content
    check (kind <> 'folder' or (content is null and storage_path is null))
);

create index nodes_space_idx on public.nodes (space_id);
create index nodes_parent_idx on public.nodes (parent_id);

-- Sharing -------------------------------------------------------------------

create table public.grants (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes (id) on delete cascade,
  grantee_type public.grantee_type not null,
  grantee_id uuid,
  role public.grant_role not null,
  created_at timestamptz not null default now(),
  -- A public grant names no grantee; user and team grants must name one.
  constraint grants_grantee_id_matches_type check (
    (grantee_type = 'public' and grantee_id is null)
    or (grantee_type <> 'public' and grantee_id is not null)
  )
);

-- Two partial indexes rather than one over coalesce(grantee_id, ...), so the
-- uniqueness rule reads plainly for each case.
create unique index grants_unique_identified
  on public.grants (node_id, grantee_type, grantee_id)
  where grantee_id is not null;

create unique index grants_unique_public
  on public.grants (node_id)
  where grantee_type = 'public';

create index grants_node_idx on public.grants (node_id);
create index grants_grantee_idx on public.grants (grantee_type, grantee_id);

-- Backlinks -----------------------------------------------------------------

create table public.links (
  space_id uuid not null references public.spaces (id) on delete cascade,
  source_node_id uuid not null references public.nodes (id) on delete cascade,
  target_node_id uuid not null references public.nodes (id) on delete cascade,
  primary key (source_node_id, target_node_id)
);

create index links_target_idx on public.links (target_node_id);

-- Sign-up gating ------------------------------------------------------------

create table public.signup_email_domains (
  id serial primary key,
  domain text not null unique,
  type public.signup_email_domain_type not null,
  reason text,
  created_at timestamptz not null default now()
);

insert into public.signup_email_domains (domain, type, reason)
values ('maqsoodlabs.com', 'allow', 'Organization domain');

-- An unexpired, unaccepted invitation lets its address bypass the domain
-- allow list exactly once.
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  invited_by uuid references public.profiles (id) on delete set null,
  space_id uuid references public.spaces (id) on delete cascade,
  role public.grant_role not null default 'viewer',
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index invitations_pending_email_idx
  on public.invitations (lower(email))
  where accepted_at is null;

-- RLS ------------------------------------------------------------------------
-- Enabled here with no policies, so everything is denied by default until the
-- authorization migration adds policies backed by the predicates.

alter table public.profiles enable row level security;
alter table public.spaces enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.nodes enable row level security;
alter table public.grants enable row level security;
alter table public.links enable row level security;
alter table public.signup_email_domains enable row level security;
alter table public.invitations enable row level security;
