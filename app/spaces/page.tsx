import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listOpenSpaces } from "@/lib/spaces";
import { NewSpaceForm } from "./NewSpaceForm";
import { AppHeader } from "@/components/AppHeader";
import { isPlatformAdmin } from "@/lib/admin";
import { listShares } from "@/lib/shares";
import { myTeams } from "@/lib/teams";
import { listNoteThreads } from "@/lib/notes";
import { Shared } from "./Shared";
import { NavLink } from "@/components/NavLink";

export const metadata = { title: "Your spaces" };
export const dynamic = "force-dynamic";

export default async function SpacesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const spaces = await listOpenSpaces(user.id);
  const admin = await isPlatformAdmin();
  const shares = await listShares();
  const teams = await myTeams();
  const threads = await listNoteThreads();

  return (
    <main className="shell">
      <AppHeader email={user.email} admin={admin} />

      <Shared shares={shares} />

      <h1>Your spaces</h1>
      <p className="lede">
        Spaces you own, and spaces you have been let into. A single page somebody
        shared with you is above, under Shared with you, rather than here: the
        page is yours to read, the space around it is not.
      </p>

      {spaces.length === 0 ? (
        <p className="empty">
          Nothing yet. Create your first space below.
        </p>
      ) : (
        <ul className="space-list">
          {spaces.map((space) => (
            <li key={space.id}>
              <NavLink href={`/s/${space.slug}`}>
                <span className="space-name">{space.name}</span>
                <span className="space-slug">/s/{space.slug}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      )}

      {threads.length > 0 ? (
        <p className="teams-link">
          <NavLink href="/inbox">
            {unread(threads) > 0
              ? `${unread(threads)} unread in your inbox`
              : "Your inbox"}
          </NavLink>{" "}
          <span className="hint">
            Notes sent from the front page, and the replies to them.
          </span>
        </p>
      ) : null}

      {teams.length > 0 ? (
        <p className="teams-link">
          <NavLink href="/teams">
            {teams.length === 1
              ? "You are on one team"
              : `You are on ${teams.length} teams`}
          </NavLink>{" "}
          <span className="hint">
            See who else is on them, and what each one lets you reach.
          </span>
        </p>
      ) : null}

      <section className="new-space-section">
        <h2>New space</h2>
        <NewSpaceForm />
      </section>
    </main>
  );
}

/** Conversations with something in them the reader has not seen. */
function unread(threads: { unread: boolean }[]): number {
  return threads.filter((t) => t.unread).length;
}
