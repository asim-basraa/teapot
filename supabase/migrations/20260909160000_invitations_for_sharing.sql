-- Sharing with somebody who does not have an account yet.
--
-- Sharing resolved an address to a profile and refused when there was none:
-- "no account exists for x@y, they need to sign up first". But sign-up is
-- invitation-only, so that was a dead end with no door — the person could not
-- sign up, and the sharer had no way to let them. QA found it immediately,
-- which is the right place to find it and a late one to fix it.
--
-- The invitations table already existed, built for the sign-up hook. What was
-- missing was anything that creates a row in it, and any connection between an
-- invitation and the thing the person was invited *to*.

-- What they were invited to. Nullable, because an invitation to the
-- application in general is still a legitimate thing to issue.
alter table public.invitations
  add column if not exists node_id uuid references public.nodes (id) on delete cascade;

-- One pending invitation per address per node, rather than one per address
-- outright: inviting somebody to two folders before they accept is ordinary,
-- and the old index silently made the second one impossible. NULLS NOT
-- DISTINCT so that two invitations to nothing in particular still collide.
drop index if exists public.invitations_pending_email_idx;

create unique index if not exists invitations_pending_idx
  on public.invitations (lower(email), node_id) nulls not distinct
  where accepted_at is null;

/**
 * Invites an address to a node.
 *
 * Admin of the node, checked first and reported as not-found otherwise, so
 * this cannot be used to find out whether a node exists. Beyond that the
 * address is taken at face value: the caller already administers the thing
 * they are sharing, and deciding who to work with is their business.
 *
 * Returns the invitation's token. Nothing is emailed from here — the account
 * itself is created through the auth service so the invitation email is the
 * one Supabase already sends, through the SMTP that is already configured.
 */
create or replace function public.invite_to_node(
  p_node_id uuid,
  p_email text,
  p_role public.grant_role
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_token text;
begin
  if coalesce(public.can_admin(p_node_id), false) is not true then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'that is not an email address' using errcode = 'check_violation';
  end if;

  -- Re-inviting refreshes rather than duplicates: the second invitation is the
  -- one that counts, and an expired first one should not be what decides.
  update public.invitations
     set role = p_role,
         invited_by = (select auth.uid()),
         expires_at = now() + interval '14 days'
   where lower(email) = v_email
     and node_id is not distinct from p_node_id
     and accepted_at is null
  returning token into v_token;

  if v_token is not null then
    return v_token;
  end if;

  insert into public.invitations (email, invited_by, node_id, space_id, role)
  select v_email, (select auth.uid()), p_node_id, n.space_id, p_role
  from public.nodes n
  where n.id = p_node_id
  returning token into v_token;

  return v_token;
end;
$$;

revoke all on function public.invite_to_node(uuid, text, public.grant_role)
  from public, anon;
grant execute on function public.invite_to_node(uuid, text, public.grant_role)
  to authenticated, service_role;

/**
 * Provisioning, now including what the new account was invited to.
 *
 * An invitation that named a node becomes the grant it promised, at the moment
 * the account exists. Without this the person accepts an invitation and lands
 * on an empty list of spaces, which is indistinguishable from being told no.
 *
 * The grant is made here rather than by whoever sent the invitation because
 * this is the only point at which both facts are known and neither can be
 * skipped: the account exists, and something was promised to it.
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  insert into public.grants (node_id, grantee_type, grantee_id, role)
  select i.node_id, 'user', new.id, i.role
  from public.invitations i
  where lower(i.email) = lower(new.email)
    and i.accepted_at is null
    and i.expires_at > now()
    and i.node_id is not null
  on conflict (node_id, grantee_type, grantee_id) where grantee_id is not null
  do update set role = excluded.role;

  -- Single-use: marking it accepted here means the same invitation cannot
  -- admit a second account.
  update public.invitations
     set accepted_at = now()
   where lower(email) = lower(new.email)
     and accepted_at is null;

  return new;
end;
$$;
