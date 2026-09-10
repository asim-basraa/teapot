-- Visibility as one decision.
--
-- Reach was set through two independent controls: a select for "everyone with
-- an account" and a checkbox for "on the web". Two controls for one question
-- means a node can be in states nobody chose — public *and* shared with
-- everyone, where the second says nothing the first does not — and it means
-- the answer to "who can see this" has to be assembled by the reader from two
-- places. Neither is a decision anybody makes; they are what is left over when
-- a feature is added beside an existing one instead of into it.
--
-- The three answers are genuinely different and all three are kept:
--
--   private    only the people and teams it has been shared with
--   everyone   anybody signed in to Postit, and nobody else
--   public     anybody with the link, no account at all
--
-- `everyone` is not `public`, and the difference is the whole point of the
-- product: a company handbook everybody at the company can read is not the
-- same as a handbook on the internet, and offering only the second is how
-- people end up publishing things they meant to circulate.

/**
 * Sets how far a node reaches, in one write.
 *
 * Exclusive by construction: whatever it is not now, it stops being. That is
 * what makes a single control honest — choosing one answer cannot leave the
 * previous one quietly in force underneath it.
 *
 * Delegates to the two functions that already own each half rather than
 * writing grants itself, so there is still one implementation of "make this
 * public" and one of "share this with everyone", and this decides between them.
 * Both check admin, which is why nothing here does.
 */
create or replace function public.set_node_visibility(
  p_node_id uuid,
  p_visibility text,
  p_role public.grant_role default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_visibility not in ('private', 'everyone', 'public') then
    raise exception 'visibility must be private, everyone or public'
      using errcode = 'check_violation';
  end if;

  if p_visibility = 'everyone' and coalesce(p_role, 'viewer') = 'admin' then
    raise exception 'a grant to everyone cannot confer admin'
      using errcode = 'check_violation';
  end if;

  -- Withdraw first, always. The order matters when it fails: a caller who is
  -- not an administrator is refused by the first of these, before anything has
  -- been written, so a refusal never leaves a node half-changed.
  perform public.set_public(p_node_id, p_visibility = 'public');
  perform public.set_shared_with_everyone(
    p_node_id,
    case when p_visibility = 'everyone' then coalesce(p_role, 'viewer') end
  );

  return p_visibility;
end;
$$;

revoke all on function public.set_node_visibility(uuid, text, public.grant_role)
  from public, anon;
grant execute on function public.set_node_visibility(uuid, text, public.grant_role)
  to authenticated, service_role;
