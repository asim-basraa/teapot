import { createClient } from "@/lib/supabase/server";
import type { Comment } from "@/lib/comment-threads";

export type { Comment, CommentThread } from "@/lib/comment-threads";
export { buildThreads } from "@/lib/comment-threads";

export type CommentResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * The conversation on a page.
 *
 * Through node_comments because profiles are private: a reader can see only
 * their own row, so joining for an author's name directly would return nothing.
 * The function applies the same condition the select policy does, so it
 * discloses nothing the table would not.
 */
export async function listComments(nodeId: string): Promise<Comment[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("node_comments", { p_node_id: nodeId });
  return (data as Comment[] | null) ?? [];
}

export async function addComment(
  nodeId: string,
  body: string,
  parentId: string | null = null,
): Promise<CommentResult> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Say something first.", status: 400 };
  if (trimmed.length > 10_000) {
    return { ok: false, error: "That comment is too long.", status: 400 };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not found.", status: 404 };

  const { error } = await supabase.from("comments").insert({
    node_id: nodeId,
    author_id: user.id,
    parent_id: parentId,
    body: trimmed,
  });

  if (!error) return { ok: true };

  if (/replied to|same page/i.test(error.message)) {
    return { ok: false, error: "You cannot reply to a reply.", status: 400 };
  }

  // Anything else, a policy refusal included, is not-found: a caller learns
  // nothing about pages they cannot read.
  return { ok: false, error: "Not found.", status: 404 };
}

/**
 * Withdraws a comment.
 *
 * The policy decides who may: its author, or an administrator of the page.
 * There is no check here, because a second copy of that rule is a second thing
 * to get wrong.
 */
export async function removeComment(id: string): Promise<CommentResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_comment", { p_comment_id: id });
  if (error) return { ok: false, error: "Not found.", status: 404 };
  return { ok: true };
}
