import { createClient } from "@/lib/supabase/server";
import type { Node } from "@/lib/spaces";

export type TreeNode = Node & { children: TreeNode[] };

export type NodeResult =
  | { ok: true; node: Node }
  | { ok: false; error: string; status: number };

/**
 * Every node in a space the caller can read, flat and path-ordered.
 *
 * The filtering is RLS's job, not ours: unreadable rows never arrive, so the
 * tree drawn from this list cannot reveal a node the viewer is not allowed to
 * know exists.
 */
export async function listNodes(spaceId: string): Promise<Node[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("nodes")
    .select(
      "id, space_id, parent_id, kind, name, slug, path, content, content_version",
    )
    .eq("space_id", spaceId)
    .order("kind", { ascending: true })
    .order("name", { ascending: true });
  return data ?? [];
}

/**
 * Nests a flat node list.
 *
 * A node whose parent is missing from the list is treated as a root rather
 * than dropped. That happens legitimately: a viewer granted a deep file but
 * not its folders can read the file and must still see it somewhere.
 */
export function buildTree(nodes: Node[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(
    nodes.map((n) => [n.id, { ...n, children: [] }]),
  );
  const roots: TreeNode[] = [];

  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Folders before files, then alphabetical, at every level.
  const sort = (list: TreeNode[]) => {
    list.sort((a, b) =>
      a.kind === b.kind
        ? a.name.localeCompare(b.name)
        : a.kind === "folder"
          ? -1
          : 1,
    );
    for (const child of list) sort(child.children);
  };
  sort(roots);

  return roots;
}

const SELECT =
  "id, space_id, parent_id, kind, name, slug, path, content, content_version";

export async function createNode(input: {
  spaceId: string;
  parentId: string | null;
  kind: "folder" | "file";
  name: string;
}): Promise<NodeResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "A name is required.", status: 400 };

  const supabase = await createClient();

  // The id is generated here rather than by the database so the row can be
  // read back in a separate statement. Insert and read cannot be combined:
  // `INSERT ... RETURNING` makes Postgres apply the SELECT policy to the new
  // row, that policy calls can_read, and can_read is STABLE so it runs against
  // the snapshot taken before the insert. It therefore cannot see the very row
  // being inserted and correctly reports no such node, which RLS turns into a
  // policy violation. Splitting the two lets the read use a fresh snapshot.
  const id = crypto.randomUUID();

  // `slug` and `path` are deliberately omitted: a database trigger derives
  // them from the parent, so a caller cannot place a node at a path that
  // disagrees with its position in the tree.
  const { error } = await supabase.from("nodes").insert({
    id,
    space_id: input.spaceId,
    parent_id: input.parentId,
    kind: input.kind,
    name,
    content: input.kind === "file" ? `# ${name}\n\n` : null,
  });

  if (error) return translate(error);

  const { data, error: readError } = await supabase
    .from("nodes")
    .select(SELECT)
    .eq("id", id)
    .single();

  if (readError) return translate(readError);
  return { ok: true, node: data };
}

export async function renameNode(
  nodeId: string,
  name: string,
): Promise<NodeResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "A name is required.", status: 400 };

  // move_node rewrites descendant paths too; a plain update would rename the
  // folder and strand its children at the old prefix.
  return callMoveNode({
    p_node_id: nodeId,
    p_new_name: trimmed,
    p_reparent: false,
  });
}

export async function moveNode(
  nodeId: string,
  newParentId: string | null,
): Promise<NodeResult> {
  return callMoveNode({
    p_node_id: nodeId,
    p_new_parent_id: newParentId,
    p_reparent: true,
  });
}

/**
 * Runs move_node and reads the result back.
 *
 * The row is fetched separately rather than projected off the RPC. move_node
 * returns a single composite, and how PostgREST shapes that (object versus
 * single-element array) is an implementation detail we would otherwise be
 * depending on. A plain select by id is unambiguous, and matches how
 * createNode reads back its insert.
 */
async function callMoveNode(
  args: Record<string, unknown>,
): Promise<NodeResult> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("move_node", args);
  if (error) return translate(error);

  const { data, error: readError } = await supabase
    .from("nodes")
    .select(SELECT)
    .eq("id", args.p_node_id as string)
    .single();

  if (readError) return translate(readError);
  return { ok: true, node: data };
}

export type SaveResult =
  | { ok: true; node: Node }
  | { ok: false; error: string; status: number; currentContent?: string };

/**
 * Saves page content, refusing to overwrite a concurrent edit.
 *
 * The update is conditional on `content_version`, so two people who loaded the
 * same revision cannot both save: the second write matches no row.
 *
 * A no-match is ambiguous on its own, since RLS also yields no row when the
 * caller may not edit. We disambiguate by reading the node back: if it is
 * visible, somebody else moved the version on and this is a conflict; if it is
 * not, the honest answer is 404, exactly as for a read.
 */
export async function saveNodeContent(
  nodeId: string,
  content: string,
  expectedVersion: number,
): Promise<SaveResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("nodes")
    .update({
      content,
      content_version: expectedVersion + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", nodeId)
    .eq("content_version", expectedVersion)
    .select(SELECT)
    .maybeSingle();

  if (error) return translate(error);
  if (data) return { ok: true, node: data };

  const { data: current } = await supabase
    .from("nodes")
    .select(SELECT)
    .eq("id", nodeId)
    .maybeSingle();

  if (!current) {
    return { ok: false, error: "Not found.", status: 404 };
  }

  return {
    ok: false,
    status: 409,
    error:
      "Someone else saved this page while you were editing. Your text is untouched below; copy anything you need before reloading.",
    // Returned so the editor can show both versions rather than silently
    // discarding one of them.
    currentContent: current.content ?? "",
  };
}

export async function deleteNode(
  nodeId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const supabase = await createClient();
  // Descendants go with it through ON DELETE CASCADE on parent_id.
  const { error } = await supabase.from("nodes").delete().eq("id", nodeId);
  if (error) return translate(error);
  return { ok: true };
}

/**
 * Maps a Postgres error onto an HTTP status and a message worth showing.
 *
 * RLS makes a forbidden write look like a missing row, so the honest status
 * is 404 rather than 403, consistent with how reads behave.
 */
function translate(error: {
  code?: string;
  message: string;
}): { ok: false; error: string; status: number } {
  if (error.code === "23505") {
    return {
      ok: false,
      error: "Something with that name already exists here.",
      status: 409,
    };
  }
  if (error.code === "PGRST116" || error.code === "no_data_found") {
    return { ok: false, error: "Not found.", status: 404 };
  }
  if (/inside itself|own subtree/i.test(error.message)) {
    return {
      ok: false,
      error: "A folder cannot be moved inside itself.",
      status: 400,
    };
  }
  if (/not a folder/i.test(error.message)) {
    return { ok: false, error: "Only folders can contain items.", status: 400 };
  }
  return { ok: false, error: error.message, status: 400 };
}
