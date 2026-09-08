"use client";

import { useState } from "react";
import {
  buildThreads,
  type Comment,
  type CommentThread,
} from "@/lib/comment-threads";

/**
 * The conversation under a page.
 *
 * Deliberately below the article rather than beside a paragraph. Inline
 * annotation ties a comment to a span of text, and a span of text moves the
 * moment somebody edits: the comment then points at nothing, or worse, at
 * something it was never about. A conversation at the foot of the page stays
 * true no matter how the page is rewritten.
 */
export function Comments({
  nodeId,
  viewerId,
  canModerate,
  initialComments,
}: {
  nodeId: string;
  viewerId: string;
  canModerate: boolean;
  initialComments: Comment[];
}) {
  const [comments, setComments] = useState(initialComments);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const threads = buildThreads(comments);

  async function post(text: string, parentId: string | null) {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/v1/nodes/${nodeId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: text, parent_id: parentId }),
    });

    const payload = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(payload.error ?? `Could not post that (${res.status})`);
      return;
    }

    setComments(payload.comments ?? []);
    if (parentId) {
      setReplyTo(null);
      setReplyBody("");
    } else {
      setBody("");
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/v1/comments/${id}`, { method: "DELETE" });
    setBusy(false);

    if (!res.ok) {
      setError("Could not remove that comment.");
      return;
    }

    const listed = await fetch(`/api/v1/nodes/${nodeId}/comments`);
    if (listed.ok) setComments((await listed.json()).comments ?? []);
  }

  function mayRemove(comment: Comment) {
    return !comment.deleted && (comment.author_id === viewerId || canModerate);
  }

  return (
    <section className="comments" aria-label="Comments">
      <h2>
        Comments
        {threads.length > 0 ? (
          <span className="comment-count">{comments.filter((c) => !c.deleted).length}</span>
        ) : null}
      </h2>

      {error ? (
        <p className="msg msg-error" role="alert">
          {error}
        </p>
      ) : null}

      {threads.length === 0 ? (
        <p className="empty">Nothing yet. Start the conversation.</p>
      ) : (
        <ul className="comment-list">
          {threads.map((thread) => (
            <li key={thread.id} className="comment-thread">
              <Body
                comment={thread}
                canRemove={mayRemove(thread)}
                busy={busy}
                onRemove={() => void remove(thread.id)}
              />

              {thread.replies.length > 0 ? (
                <ul className="comment-replies">
                  {thread.replies.map((reply) => (
                    <li key={reply.id}>
                      <Body
                        comment={reply}
                        canRemove={mayRemove(reply)}
                        busy={busy}
                        onRemove={() => void remove(reply.id)}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}

              {replyTo === thread.id ? (
                <form
                  className="comment-form comment-reply-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void post(replyBody, thread.id);
                  }}
                >
                  <textarea
                    className="input comment-input"
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    rows={2}
                    aria-label={`Reply to ${thread.author_email}`}
                    autoFocus
                  />
                  <div className="comment-actions">
                    <button
                      className="btn btn-secondary btn-small"
                      type="button"
                      onClick={() => {
                        setReplyTo(null);
                        setReplyBody("");
                      }}
                    >
                      Cancel
                    </button>
                    <button className="btn btn-small" type="submit" disabled={busy}>
                      Reply
                    </button>
                  </div>
                </form>
              ) : (
                // No reply affordance on a tombstone: there is nothing there
                // to answer.
                !thread.deleted && (
                  <button
                    className="comment-reply-link"
                    type="button"
                    onClick={() => setReplyTo(thread.id)}
                    aria-label={`Reply to ${thread.author_email}`}
                  >
                    Reply
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="comment-form"
        onSubmit={(e) => {
          e.preventDefault();
          void post(body, null);
        }}
      >
        <label className="field">
          <span className="field-label">Add a comment</span>
          <textarea
            className="input comment-input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="What do you think?"
          />
        </label>
        <div className="comment-actions">
          <button className="btn btn-small" type="submit" disabled={busy || !body.trim()}>
            {busy ? "Posting…" : "Post"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Body({
  comment,
  canRemove,
  busy,
  onRemove,
}: {
  comment: Comment | CommentThread;
  canRemove: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  if (comment.deleted) {
    // A tombstone, kept only because replies hang off it. Removing it outright
    // would orphan answers that make no sense on their own.
    return <p className="comment-deleted">This comment was withdrawn.</p>;
  }

  return (
    <div className="comment">
      <div className="comment-head">
        <span className="comment-author">{comment.author_email}</span>
        <time className="comment-when" dateTime={comment.created_at}>
          {new Date(comment.created_at).toLocaleString()}
        </time>
        {canRemove ? (
          <button
            className="comment-remove"
            type="button"
            onClick={onRemove}
            disabled={busy}
            aria-label={`Delete the comment by ${comment.author_email}`}
          >
            Delete
          </button>
        ) : null}
      </div>
      {/* Rendered as text, never as Markdown or HTML: a comment is somebody
          else's input on a page other people read. */}
      <p className="comment-body">{comment.body}</p>
    </div>
  );
}
