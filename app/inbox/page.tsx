import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listNoteThreads, readNote } from "@/lib/notes";
import { isPlatformAdmin } from "@/lib/admin";
import { AppHeader } from "@/components/AppHeader";
import { Conversation } from "./Conversation";

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

  const [threads, admin] = await Promise.all([
    listNoteThreads(),
    isPlatformAdmin(),
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

      {threads.length === 0 ? (
        <p className="empty">
          Nothing here yet. Notes sent from the{" "}
          <strong>Tell me a joke</strong> box at the bottom of any page land
          here.
        </p>
      ) : open ? (
        <Conversation
          noteId={open.note_id}
          who={open.who}
          anonymous={open.anonymous}
          initial={messages}
        />
      ) : (
        <ul className="threads">
          {threads.map((thread) => (
            <li key={thread.note_id} className={thread.unread ? "is-unread" : ""}>
              <Link href={`/inbox?note=${thread.note_id}`}>
                <span className="thread-who">
                  {thread.unread ? <span className="thread-dot" aria-label="Unread" /> : null}
                  {thread.who}
                  {thread.anonymous ? (
                    <span className="thread-tag">no account</span>
                  ) : null}
                </span>
                <span className="thread-preview">{thread.preview}</span>
                <span className="thread-when">
                  {when(thread.last_message_at)}
                  {thread.messages > 1 ? ` · ${thread.messages} messages` : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
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

function when(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}
