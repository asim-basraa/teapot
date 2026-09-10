import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSpaceBySlug } from "@/lib/spaces";
import { listTeams } from "@/lib/teams";
import { signOut } from "../../../(auth)/actions";
import { Teams } from "./Teams";

export const metadata = { title: "Teams" };
export const dynamic = "force-dynamic";

/**
 * Team management, deliberately outside `/s/[slug]/` .
 *
 * Everything under `/s/` addresses content, and a page named "Teams" would slug
 * to `teams`. Putting administration there would shadow a legitimate document
 * whenever somebody wrote one, so it lives alongside the space list instead.
 */
export default async function TeamsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const space = await getSpaceBySlug(slug);
  if (!space) notFound();

  // Teams are a space-level construct, so the space owner administers them.
  // This mirrors the RLS policy rather than adding a second rule: a non-owner
  // who reached this URL would find every write refused anyway.
  if (space.owner_id !== user.id) notFound();

  const teams = await listTeams(space.id);

  return (
    <main className="shell">
      <header className="shell-header">
        <Link href="/spaces" className="shell-brand">
          Post-it
        </Link>
        <form action={signOut}>
          <button className="btn btn-secondary btn-small" type="submit">
            Sign out
          </button>
        </form>
      </header>

      <h1>Teams in {space.name}</h1>
      <p className="lede">
        A team is a name for a group of people. Share a folder with the team and
        everyone on it can read the folder and everything beneath it; take
        somebody off the team and their access goes with them.
      </p>
      <p>
        <Link href={`/s/${space.slug}`}>Back to {space.name}</Link>
      </p>

      <Teams spaceId={space.id} initialTeams={teams} />
    </main>
  );
}
