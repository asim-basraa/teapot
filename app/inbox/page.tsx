import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listNoteThreads, readNote, isInboxOwner } from "@/lib/notes";
import { isPlatformAdmin } from "@/lib/admin";
import { AppHeader } from "@/components/AppHeader";
import { Conversation } from "./Conversation";
import { Threads } from "./Threads";

export const metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

/**
 * Notes sent from the front page, and the replies to them.
 *
 * One screen for both sides of the same conversation. The inbox owner sees
 * every thread; everybody else sees the ones they started, and the database
 * decides which rather than a branch here, so the screen cannot show somebody
 * something the policy would refuse.
 *
 * The asymmetry that is left is the honest one: a note sent while signed out
 * has nobody attached to it, so it can be read and not answered. That is said
 * in words on the thread rather than left as a reply box that does nothing.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { note: selected } = await searchParams;

  const [threads, admin, canDelete] = await Promise.all([
    listNoteThreads(),
    isPlatformAdmin(),
    isInboxOwner(),
  ]);

  const open = selected
    ? (threads.find((t) => t.note_id === selected) ?? null)
    : null;
  const messages = open ? await readNote(open.note_id) : [];

  return (
    <main className="shell">
      <AppHeader email={user.email} admin={admin} />

      <h1>Inbox</h1>
      <p className="lede">
        Notes sent from the front page, and anything said since. Each
        conversation is between two people and nobody else can read it.
      </p>

      {open ? (
        <Conversation
          noteId={open.note_id}
          who={open.who}
          anonymous={open.anonymous}
          canDelete={canDelete}
          initial={messages}
        />
      ) : (
        <Threads threads={threads} canDelete={canDelete} />
      )}

      <p className="back">
        {open ? (
          <Link href="/inbox">Back to every conversation</Link>
        ) : (
          <Link href="/spaces">Back to your spaces</Link>
        )}
      </p>
    </main>
  );
}
