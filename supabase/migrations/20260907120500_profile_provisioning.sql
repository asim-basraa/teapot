-- Creates the app-facing profile when an auth user is created, and consumes
-- any invitation that let them in.
--
-- This is a trigger rather than application code because a profile must exist
-- for every auth user without exception. Doing it in a route handler would
-- leave a user with no profile whenever that code path is missed, and
-- `spaces.owner_id` references `profiles`.
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

  -- Single-use: marking it accepted here means the same invitation cannot
  -- admit a second account.
  update public.invitations
     set accepted_at = now()
   where lower(email) = lower(new.email)
     and accepted_at is null;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
