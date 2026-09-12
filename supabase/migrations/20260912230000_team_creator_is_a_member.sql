-- Putting the person who made a team on it.
--
-- Creating a team did not put you on it. That was not a decision anybody took;
-- it fell out of membership and administration being separate tables, and it
-- only became visible once teams could be shared with across spaces. Somebody
-- made a team, added a colleague, and then found that a page shared with the
-- team reached the colleague and not them. The team was theirs and they were
-- not on it.
--
-- Nothing before this hid the gap, either: the teams screen lists the teams you
-- are on, so a team you had just made did not appear there at all.
--
-- The creator is always the owner of the space, because creating a team
-- requires owning one, so there is no third party to guess at.
--
-- It is a default and not a rule: membership is still the only thing that
-- confers reading, and the owner can take themselves off a team they do not
-- want to be on. That matters more now than it looks. Sharing with a team
-- reaches the people on it, so being on your own team means a page somebody
-- else shares with it reaches you. Most of the time that is exactly what the
-- person sharing expects. When it is not, leaving is one click and the access
-- goes with it.

create or replace function public.add_team_creator()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  select s.owner_id into v_owner
  from public.spaces s where s.id = new.space_id;

  if v_owner is null then
    return new;
  end if;

  -- Manager rather than member: they are the one who can change the roster,
  -- which is the distinction the role column was added to carry.
  --
  -- added_by is set to themselves rather than left for the stamping trigger,
  -- so it says the same thing however the team was made. The screen does not
  -- show "added by you", which answers nothing.
  insert into public.team_members (team_id, user_id, role, added_by)
  values (new.id, v_owner, 'manager', v_owner)
  on conflict (team_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists teams_add_creator on public.teams;

create trigger teams_add_creator
  after insert on public.teams
  for each row execute function public.add_team_creator();

-- Existing teams, so this is true of the ones already made rather than only of
-- the next one. Owners already on their own team keep their row and have its
-- role corrected: there is no way to have chosen 'member' deliberately, since
-- nothing in the product sets it, and leaving the two paths disagreeing would
-- be a difference nobody could see and something later would trip over.
insert into public.team_members (team_id, user_id, role, added_by)
select t.id, s.owner_id, 'manager', s.owner_id
from public.teams t
join public.spaces s on s.id = t.space_id
on conflict (team_id, user_id) do update set role = 'manager';
