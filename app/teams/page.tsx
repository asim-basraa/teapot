import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { myTeams, myTeamReach, teamRoster } from "@/lib/teams";
import { AppHeader } from "@/components/AppHeader";
import { NavLink } from "@/components/NavLink";
import { isPlatformAdmin } from "@/lib/admin";

export const metadata = { title: "Your teams" };
export const dynamic = "force-dynamic";

/**
 * The teams you are on, from your side of them.
 *
 * The gap this closes: the space owner could see a team, who was on it and what
 * it reached, and the people on it could see none of those things. So somebody
 * added to "QA" would find a folder appear in their list with no account of
 * where it came from, and no way to answer the only question they had — why can
 * I see this, and who else can?
 *
 * Read-only, deliberately. Membership confers no administration over the team
 * itself: a member cannot add anybody to it or rename it, and the owner of its
 * space still decides who is on it. What membership does confer, since teams
 * stopped being space-scoped, is the ability to share your own pages with the
 * team, which happens on the page being shared rather than here.
 */
export default async function MyTeamsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [teams, reach, admin] = await Promise.all([
    myTeams(),
    myTeamReach(),
    isPlatformAdmin(),
  ]);

  return (
    <main className="shell">
      <AppHeader email={user.email} admin={admin} />

      <h1>Your teams</h1>
      <p className="lede">
        Teams somebody has put you on, and what each one lets you reach. Being on
        a team is not access in itself: it is a name that pages can be shared
        with, so that sharing once reaches everybody on it at once. You can
        share your own pages with any team you are on.
      </p>

      {teams.length === 0 ? (
        <p className="empty">
          You are not on any teams. Nothing is missing: most sharing is done
          person by person, and only the owner of a space can put you on a team.
        </p>
      ) : (
        <ul className="my-teams">
          {teams.map((team) => {
            const items = reach.get(team.team_id) ?? [];
            return (
              <li key={team.team_id} className="my-team">
                <h2 className="my-team-name">
                  {team.team_name}
                  <span className="my-team-space">in {team.space_name}</span>
                </h2>

                <p className="my-team-meta">
                  {team.member_count === 1
                    ? "You are the only person on it"
                    : `${team.member_count} people on it`}
                  {team.added_by ? ` · added by ${team.added_by}` : null}
                </p>

                {items.length === 0 ? (
                  <p className="hint">
                    Nothing has been shared with this team yet, so it gives you
                    nothing to read for the moment. That is the ordinary state of
                    a new team, not a fault. Anybody on it can share a page or
                    folder of their own with it, from the Share button on that
                    page, and it appears here. It does not have to live in{" "}
                    {team.space_name}.
                  </p>
                ) : (
                  <>
                    <p className="my-team-why">
                      Being on this team is why you can read:
                    </p>
                    <ul className="team-reach-list">
                      {items.map((item) => (
                        <li key={item.node_id}>
                          <NavLink
                            href={item.href}
                            className="team-reach-what"
                          >
                            {item.label}
                          </NavLink>
                          <span className="team-reach-role">
                            {item.role} · and everything beneath it
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <Roster teamId={team.team_id} />
              </li>
            );
          })}
        </ul>
      )}

      <p className="back">
        <NavLink href="/spaces">Back to your spaces</NavLink>
      </p>
    </main>
  );
}

/**
 * Who else is on the team.
 *
 * Its own server component so each roster is a separate read: a team you are on
 * is readable, and asking for all of them in one call would mean one function
 * returning everybody's address across every team, which is a larger hole than
 * the question needs.
 */
async function Roster({ teamId }: { teamId: string }) {
  const members = await teamRoster(teamId);

  if (members.length === 0) return null;

  return (
    <details className="my-team-roster">
      <summary>Who else is on it</summary>
      <ul className="team-members">
        {members.map((member) => (
          <li key={member.user_id}>
            <span className="member-email">
              {member.display_name ?? member.email}
            </span>
            {member.display_name ? (
              <span className="my-team-addr">{member.email}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
