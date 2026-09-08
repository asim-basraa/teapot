import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listSpaces } from "@/lib/spaces";
import { signOut } from "../(auth)/actions";
import { NewSpaceForm } from "./NewSpaceForm";

export const metadata = { title: "Your spaces" };
export const dynamic = "force-dynamic";

export default async function SpacesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const spaces = await listSpaces();

  return (
    <main className="shell">
      <header className="shell-header">
        <Link href="/spaces" className="shell-brand">
          Teapot
        </Link>
        <form action={signOut}>
          <button className="btn btn-secondary btn-small" type="submit">
            Sign out
          </button>
        </form>
      </header>

      <h1>Your spaces</h1>
      <p>
        <Link href="/settings/mcp">Connect Teapot to Claude</Link>
      </p>
      <p className="lede">
        Spaces you own, and spaces others have shared with you.
      </p>

      {spaces.length === 0 ? (
        <p className="empty">
          Nothing yet. Create your first space below.
        </p>
      ) : (
        <ul className="space-list">
          {spaces.map((space) => (
            <li key={space.id}>
              <Link href={`/s/${space.slug}`}>
                <span className="space-name">{space.name}</span>
                <span className="space-slug">/s/{space.slug}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="new-space-section">
        <h2>New space</h2>
        <NewSpaceForm />
      </section>
    </main>
  );
}
