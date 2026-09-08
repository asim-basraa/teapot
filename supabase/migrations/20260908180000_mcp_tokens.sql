-- Access tokens for the MCP server.
--
-- An MCP client cannot carry a browser session, so it carries a token instead.
-- Everything else about authorization is unchanged: a token resolves to a user,
-- and from that point the request is exactly the request that user would make
-- from the browser.

create table if not exists public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  -- Only the hash. The token is shown once at creation and never again, so a
  -- database leak hands over no live credentials.
  token_hash text not null unique,
  -- Optional narrowing. A token is account-wide by default, reaching whatever
  -- its owner can reach and never more; pinning it to one space bounds the
  -- blast radius of a leak without changing what the owner can do.
  space_id uuid references public.spaces (id) on delete cascade,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists mcp_tokens_user_idx on public.mcp_tokens (user_id);

alter table public.mcp_tokens enable row level security;

-- A person manages their own tokens and cannot see that anyone else has any.
drop policy if exists mcp_tokens_own on public.mcp_tokens;
create policy mcp_tokens_own on public.mcp_tokens
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

/**
 * Resolves a presented token to the account it belongs to.
 *
 * Takes the token itself and hashes it here, rather than taking a hash. That
 * distinction is the point of storing hashes at all: if this accepted a hash,
 * then a leaked database would be enough to authenticate, and the hashing would
 * have bought nothing. As written, a leak yields hashes that this refuses.
 *
 * SECURITY DEFINER and callable by anon, because the caller has no session yet
 * and this is what establishes one. That is safe only because the argument is a
 * 256-bit secret: an unknown token yields no rows and tells the caller nothing
 * about whether any token exists. The endpoint rate limits regardless.
 *
 * Revoked and expired tokens resolve to nothing, so revocation takes effect on
 * the very next request rather than whenever something happens to notice.
 */
create or replace function public.resolve_mcp_token(p_token text)
returns table (token_id uuid, user_id uuid, space_id uuid)
language sql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
  update public.mcp_tokens t
     set last_used_at = now()
   where t.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and t.revoked_at is null
     and (t.expires_at is null or t.expires_at > now())
  returning t.id, t.user_id, t.space_id;
$$;

revoke all on function public.resolve_mcp_token(text) from public;
grant execute on function public.resolve_mcp_token(text)
  to anon, authenticated, service_role;
