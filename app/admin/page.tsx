import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { isPlatformAdmin, listUsers } from "@/lib/admin";
import { AppHeader } from "@/components/AppHeader";
import { Users } from "./Users";

export const metadata = { title: "People" };
export const dynamic = "force-dynamic";

/**
 * Everybody with an account, and what they hold.
 *
 * Counts and sizes, never a word of anybody's writing. The rule the whole
 * schema serves is that a page you cannot read is indistinguishable from one
 * that does not exist, and an administrator who could read everything would be
 * a standing exception to it. How many and how much are answerable without the
 * text, so they are answered without it.
 *
 * Not found rather than forbidden for everybody else, which is the same answer
 * this product gives for every other thing somebody may not reach.
 */
export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  // Sequential, not Promise.all: two Supabase calls dispatched together on one
  // request's client can each decide the session needs refreshing, and the one
  // that loses that race comes back empty rather than failing.
  if (!(await isPlatformAdmin())) notFound();

  const users = await listUsers();

  return (
    <main className="shell">
      <AppHeader email={user.email} admin />

      <h1>People</h1>
      <p className="lede">
        Everyone with an account, what they own, and how much of it there is.
        Never what any of it says.
      </p>

      <Users initial={users} me={user.id} />
    </main>
  );
}
