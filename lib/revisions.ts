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
 * One revision's text, put back together.
 *
 * A revision holds the difference from the version after it, not a copy of the
 * page, so there is nothing to select: the text is rebuilt by starting at what
 * the page says now and walking the chain down. Through a function because
 * that walk has to happen where the rows are, and because the same can_read
 * the table's policy applies gates it, so an unreadable revision is simply
 * absent, which is the answer an unreadable page gives too.
 */
export async function getRevision(id: string): Promise<RevisionBody | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("node_revision_text", {
    p_revision_id: id,
  });

  if (error) {
    console.error("node_revision_text failed for %s: %s", id, error.message);
    return null;
  }

  const rows = (data as RevisionBody[] | null) ?? [];
  const row = rows[0];
  if (!row) return null;

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
