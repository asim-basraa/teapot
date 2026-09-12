import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSpaceBySlug } from "@/lib/spaces";
import { spaceRoster } from "@/lib/members";
import { listTeams } from "@/lib/teams";
import { AppHeader } from "@/components/AppHeader";
import { Members } from "./Members";

export const metadata = { title: "Members" };
export const dynamic = "force-dynamic";

/**
 * Who is in a space.
 *
 * Outside `/s/[slug]/` for the same reason teams are: everything under `/s/`
 * addresses content, and a page named "Members" would slug to `members` and be
 * shadowed by this one the moment somebody wrote it.
 */
export default async function MembersPage({
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

  // Mirrors the policy rather than adding a second rule: a non-owner who
  // reached this URL would find every write refused anyway.
  if (space.owner_id !== user.id) notFound();

  const [members, teams] = await Promise.all([
    spaceRoster(space.id),
    listTeams(space.id),
  ]);

  return (
    <main className="shell">
      <AppHeader email={user.email} />

      <h1>Who is in {space.name}</h1>
      <p className="lede">
        Being in a space is different from having something in it shared with
        you. Somebody in the space reads everything in it, can change anything
        in it, and can start new things at the top of it. Sharing one page with
        one person is still one page with one person.
      </p>
      <p className="lede">
        What they write stays theirs. Only its author can delete a page, in this
        space or any other, and that includes you: this is your space, not your
        work.
      </p>
      <p>
        <Link href={`/s/${space.slug}`}>Back to {space.name}</Link>
      </p>

      <Members spaceId={space.id} initial={members} teams={teams} />
    </main>
  );
}
