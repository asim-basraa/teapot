export type Comment = {
  id: string;
  parent_id: string | null;
  author_id: string;
  author_email: string;
  body: string;
  created_at: string;
  deleted: boolean;
};

/** A comment with the replies that answer it. One level, as the schema enforces. */
export type CommentThread = Comment & { replies: Comment[] };

/**
 * Nests replies under the comments they answer, and drops the deletions that
 * left nothing behind.
 *
 * A withdrawn comment with replies has to stay as a tombstone: removing it
 * would orphan answers that only make sense underneath it. A withdrawn comment
 * with no replies is simply gone, because there is nothing left to explain.
 *
 * Kept apart from the rest of the comment code, and free of any import that
 * reaches the database, so the browser can run it: the panel is a client
 * component and would otherwise drag the server client into the bundle.
 */
export function buildThreads(comments: Comment[]): CommentThread[] {
  const replies = new Map<string, Comment[]>();

  for (const comment of comments) {
    if (!comment.parent_id) continue;
    const existing = replies.get(comment.parent_id) ?? [];
    // A deleted reply leaves nothing worth showing: nothing hangs off it.
    if (!comment.deleted) existing.push(comment);
    replies.set(comment.parent_id, existing);
  }

  return comments
    .filter((comment) => !comment.parent_id)
    .map((comment) => ({
      ...comment,
      replies: replies.get(comment.id) ?? [],
    }))
    .filter((thread) => !thread.deleted || thread.replies.length > 0);
}
