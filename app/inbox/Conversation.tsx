"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { NoteMessage } from "@/lib/notes";
import { ConfirmDialog } from "@/components/Ask";
import { person } from "@/lib/people";
import { Who } from "./Who";

/**
 * One conversation, and the box to answer it.
 *
 * Marked read from the browser rather than while rendering on the server: a
 * render is not a reading, the request that builds this page might be a
 * prefetch, and marking then would clear the very thing somebody came to see.
 */
export function Conversation({
  noteId,
  who,
  anonymous,
  canDelete,
  initial,
}: {
  noteId: string;
  who: string;
  anonymous: boolean;
  /** Whether this is the reader's inbox, and so theirs to clear. */
  canDelete: boolean;
  initial: NoteMessage[];
}) {
  const router = useRouter();
  // Named in full here, unlike the list: this is the screen where you decide
  // what to write back, and that is worth two more words.
  const them = person(who).label;
  const [messages, setMessages] = useState(initial);
  const [binning, setBinning] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/v1/notes/${noteId}/seen`, { method: "POST" });
  }, [noteId]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/v1/notes/${noteId}/replies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: draft }),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setBusy(false);
      setError(body.error ?? "That did not send.");
      return;
    }

    // Read the thread back rather than guessing at what the server stored, so
    // what is on screen is what is actually in the conversation.
    const fresh = await fetch(`/api/v1/notes/${noteId}`);
    if (fresh.ok) {
      const { messages: updated } = await fresh.json();
      setMessages(updated ?? []);
    }

    setDraft("");
    setBusy(false);
  }

  async function remove() {
    setBinning(false);
    const res = await fetch(`/api/v1/notes/${noteId}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Could not delete that.");
      return;
    }
    router.push("/inbox");
    router.refresh();
  }

  return (
    <section className="conversation">
      <h2 className="conversation-who">
        <Who who={who} named />
        {anonymous ? <span className="thread-tag">no account</span> : null}
        {canDelete ? (
          <button
            className="btn btn-secondary btn-small conversation-bin"
            type="button"
            onClick={() => setBinning(true)}
          >
            Delete
          </button>
        ) : null}
      </h2>

      <ol className="messages">
        {messages.map((message) => (
          <li
            key={message.message_id}
            className={message.mine ? "message is-mine" : "message"}
          >
            <p className="message-body">{message.body}</p>
            <p className="message-when">
              {message.mine ? "You" : message.from_owner ? "Them" : them} ·{" "}
              {new Date(message.created_at).toLocaleString()}
            </p>
          </li>
        ))}
      </ol>

      {anonymous ? (
        <p className="hint conversation-closed">
          This was sent without an account, so there is nobody to reply to. That
          is the trade the box makes: it asks for nothing, and nothing is what it
          can tell you about who sent it.
        </p>
      ) : (
        <form className="reply-form" onSubmit={send}>
          {error ? (
            <p className="msg msg-error" role="alert">
              {error}
            </p>
          ) : null}

          <label className="field">
            <span className="field-label">Reply</span>
            <textarea
              id="reply-body"
              className="input note-box"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={2000}
              rows={4}
              required
            />
          </label>

          <button className="btn" type="submit" disabled={busy || !draft.trim()}>
            {busy ? "Sending…" : "Send reply"}
          </button>
        </form>
      )}
      {binning ? (
        <ConfirmDialog
          title="Delete this conversation?"
          body={
            anonymous
              ? "It goes for good, and there is nobody else holding a copy of it."
              : `It goes for good, for you and for ${them}. Neither of you will be able to read it again.`
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => void remove()}
          onClose={() => setBinning(false)}
        />
      ) : null}
    </section>
  );
}
