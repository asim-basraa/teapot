-- Sign-up gating for the `before-user-created` auth hook.
--
-- Sign-up is denied by default. An address gets through only if it holds an
-- unexpired, unaccepted invitation, or its domain is on the allow list.
--
-- Note: the recipe in the Supabase docs is buggy. It compares `lower($1)`,
-- where `$1` is the whole `jsonb` event rather than the extracted domain,
-- which raises a type error at runtime. This uses the extracted domain.
create or replace function public.hook_restrict_signup_by_email_domain(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_domain text;
begin
  v_email := lower(trim(event -> 'user' ->> 'email'));

  if v_email is null or v_email = '' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400,
      'message', 'An email address is required to sign up.'
    ));
  end if;

  v_domain := split_part(v_email, '@', 2);

  -- An invitation overrides the domain rules entirely. It is consumed on
  -- first use by the accept flow, not here: this hook only decides eligibility.
  if exists (
    select 1
    from public.invitations i
    where lower(i.email) = v_email
      and i.accepted_at is null
      and i.expires_at > now()
  ) then
    return '{}'::jsonb;
  end if;

  if exists (
    select 1
    from public.signup_email_domains d
    where d.type = 'deny' and lower(d.domain) = v_domain
  ) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Sign-ups from this email domain are not permitted.'
    ));
  end if;

  if exists (
    select 1
    from public.signup_email_domains d
    where d.type = 'allow' and lower(d.domain) = v_domain
  ) then
    return '{}'::jsonb;
  end if;

  -- Deny by default: this is a private application.
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'This application is invitation only. Ask an administrator for an invitation.'
  ));
end;
$$;

-- Only the auth service may run the hook.
revoke all on function public.hook_restrict_signup_by_email_domain(jsonb) from public, anon, authenticated;
grant execute on function public.hook_restrict_signup_by_email_domain(jsonb) to supabase_auth_admin;

grant usage on schema public to supabase_auth_admin;
grant select on table public.signup_email_domains to supabase_auth_admin;
grant select on table public.invitations to supabase_auth_admin;
