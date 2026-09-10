import { createClient } from "@/lib/supabase/server";
import type { ContentType } from "@/lib/nodes";

export type Revision = {
  id: string;
  content_version: number;
  name: string;
  author_id: string | null;
  author_email: string | null;
  created_at: string;
  characters: number;
};

export type RevisionBody = {
  id: string;
  content: string;
  name: string;
  content_type: ContentType | null;
};

/**
 * What a page has said, newest first.
 *
 * Through node_history because profiles are private: a join for an author's
 * address returns nothing when done as the reader. The function applies the
 * same can_read the select policy does, so it discloses nothing the table
 * would not.
 */
export async function listRevisions(nodeId: string): Promise<Revision[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("node_history", {
    p_node_id: nodeId,
  });

  if (error) {
    console.error("node_history failed for %s: %s", nodeId, error.message);
  }

  return (data as Revision[] | null) ?? [];
}

/**
 * One revision's text.
 *
 * A plain select: the policy on node_revisions already requires can_read of
 * the page, so an unreadable revision is simply absent, which is the same
 * answer an unreadable page gives.
 */
export async function getRevision(id: string): Promise<RevisionBody | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("node_revisions")
    .select("id, content, name, content_type")
    .eq("id", id)
    .maybeSingle();

  if (!data) return null;
  const row = data as {
    id: string;
    content: string | null;
    name: string;
    content_type: ContentType | null;
  };

  return { ...row, content: row.content ?? "" };
}

export type RestoreResult =
  | { ok: true; version: number }
  | { ok: false; error: string; status: number };

/**
 * Puts a page back to what a revision said.
 *
 * Forward, not backward: the restore is an ordinary save carrying old text, so
 * it takes a new version number and records itself in the history like any
 * other edit. Undoing a restore is therefore just another restore.
 */
export async function restoreRevision(id: string): Promise<RestoreResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("restore_node_revision", {
    p_revision_id: id,
  });

  if (error) return { ok: false, error: "Not found.", status: 404 };

  const node = data as { content_version: number } | null;
  if (!node) return { ok: false, error: "Not found.", status: 404 };

  return { ok: true, version: node.content_version };
}
