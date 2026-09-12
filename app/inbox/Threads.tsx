"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NoteThread } from "@/lib/notes";
import { ConfirmDialog } from "@/components/Ask";
import { person } from "@/lib/people";
import { Who } from "./Who";

/**
 * The list of conversations, with a way to clear the ones you are done with.
 *
 * Deleting lives on the row as well as inside the conversation, because the
 * case this exists for is four notes you do not want, and making somebody open
 * each one to be rid of it is the slow way round.
 */
export function Threads({
  threads: initial,
  canDelete,
}: {
  threads: NoteThread[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [threads, setThreads] = useState(initial);
  const [binning, setBinning] = useState<NoteThread | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(thread: NoteThread) {
    setBinning(null);
    setError(null);

    const res = await fetch(`/api/v1/notes/${thread.note_id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      setError("Could not delete that.");
      return;
    }

    setThreads((current) =>
      current.filter((t) => t.note_id !== thread.note_id),
    );
    router.refresh();
  }

  if (threads.length === 0) {
    return (
      <p className="empty">
        Nothing here yet. Notes sent from the{" "}
        <strong>Tell me a joke</strong> box at the bottom of any page land here.
      </p>
    );
  }

  return (
    <>
      {error ? (
        <p className="msg msg-error" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="threads">
        {threads.map((thread) => (
          <li key={thread.note_id} className={thread.unread ? "is-unread" : ""}>
            <Link href={`/inbox?note=${thread.note_id}`}>
              <span className="thread-who">
                {thread.unread ? (
                  <span className="thread-dot" aria-label="Unread" />
                ) : null}
                {/* Initials alone in the list. The row is scanned rather than
                    read, and the name is a hover and a screen reader away. */}
                <Who who={thread.who} />
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

            {canDelete ? (
              <button
                className="btn btn-secondary btn-small thread-bin"
                type="button"
                onClick={() => setBinning(thread)}
                aria-label={`Delete the note from ${person(thread.who).label}`}
              >
                Delete
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {binning ? (
        <ConfirmDialog
          title="Delete this conversation?"
          body={
            binning.anonymous
              ? "It goes for good, and there is nobody else holding a copy of it."
              : `It goes for good, for you and for ${person(binning.who).label}. Neither of you will be able to read it again.`
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => void remove(binning)}
          onClose={() => setBinning(null)}
        />
      ) : null}
    </>
  );
}

function when(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}
