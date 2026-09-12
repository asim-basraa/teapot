import { extractWikilinkTargets } from "@postit/renderer";
import { createClient } from "@/lib/supabase/server";
import { resolveLinkTargets, type Node } from "@/lib/spaces";

export type TreeNode = Node & { children: TreeNode[] };

export type ContentType = "article" | "skill";

export function isContentType(value: unknown): value is ContentType {
  return value === "article" || value === "skill";
}

/**
 * What the sidebar may offer for one node.
 *
 * Presentation only: every one of these is asked again by the database when the
 * write arrives, and that answer is the one that counts.
 */
export type NodeRights = {
  may_edit: boolean;
  may_delete: boolean;
  may_share: boolean;
  /** Whether this could be sent back to its author's own space. */
  may_evict: boolean;
};

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
export async function listNodes(
  spaceId: string,
  contentType?: ContentType,
): Promise<Node[]> {
  const supabase = await createClient();
  let query = supabase
    .from("nodes")
    .select(
      "id, space_id, parent_id, kind, name, slug, path, content, content_version, content_type",
    )
    .eq("space_id", spaceId);

  // Filtering by type also drops folders, which carry no type. That is the
  // intent: "give me my skills" means the documents, not their containers.
  if (contentType) query = query.eq("content_type", contentType);

  const { data } = await query
    .order("kind", { ascending: true })
    .order("name", { ascending: true });

  return data ?? [];
}

/**
 * What the caller may do to each node in a space, keyed by node id.
 *
 * One round trip for the whole tree. A node missing from the map is one the
 * caller may only read.
 */
export async function listNodeRights(
  spaceId: string,
): Promise<Map<string, NodeRights>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("space_node_rights", {
    p_space_id: spaceId,
  });

  if (error) {
    console.error("space_node_rights failed: %s", error.message);
    return new Map();
  }

  const rights = new Map<string, NodeRights>();
  for (const row of (data as (NodeRights & { node_id: string })[] | null) ?? []) {
    rights.set(row.node_id, {
      may_edit: row.may_edit,
      may_delete: row.may_delete,
      may_share: row.may_share,
      may_evict: row.may_evict,
    });
  }
  return rights;
}

/**
 * Whether the caller is in this space.
 *
 * Which is what decides whether they may start something at the top of it, and
 * is not the same question as whether anything in it has been shared with them.
 */
export async function canStartInSpace(spaceId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("in_space", {
    p_space_id: spaceId,
  });
  if (error) {
    console.error("in_space failed: %s", error.message);
    return false;
  }
  return data === true;
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
  "id, space_id, parent_id, kind, name, slug, path, content, content_version, content_type";

/**
 * What is directly inside a folder, folders first then pages.
 *
 * RLS-filtered like everything else, so a child the viewer cannot read is
 * simply absent and the folder looks exactly as it would if that child did
 * not exist.
 */
export async function listChildren(parentId: string): Promise<Node[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("nodes")
    .select(SELECT)
    .eq("parent_id", parentId)
    .order("kind", { ascending: true })
    .order("name", { ascending: true });
  return data ?? [];
}

export async function createNode(input: {
  spaceId: string;
  parentId: string | null;
  kind: "folder" | "file";
  name: string;
  contentType?: ContentType;
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
    // A trigger nulls this for folders and defaults it to article for files,
    // so passing it for a folder is harmless rather than an error.
    content_type: input.contentType ?? null,
    content: input.kind === "file" ? startingContent(name, input.contentType) : null,
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

/**
 * What a new document starts as.
 *
 * No heading: the page's title is its name, rendered from the node, so writing
 * one into the body would make a second copy that rename could not reach.
 *
 * A skill starts with its frontmatter already in place, because the metadata is
 * the part authors forget and the part a client needs. Prefilling it is cheaper
 * than flagging its absence later.
 */
export function startingContent(name: string, contentType?: ContentType): string {
  if (contentType !== "skill") return "";
  return `---\nname: ${name}\ndescription: \n---\n\n`;
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
 * Changes what kind of document a page is.
 *
 * A plain update: RLS requires edit on the node, and the trigger refuses to
 * type a folder, so there is nothing left for this to decide.
 */
export async function setContentType(
  nodeId: string,
  contentType: ContentType,
): Promise<NodeResult> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("nodes")
    .update({ content_type: contentType, updated_at: new Date().toISOString() })
    .eq("id", nodeId);

  if (error) return translate(error);

  const { data, error: readError } = await supabase
    .from("nodes")
    .select(SELECT)
    .eq("id", nodeId)
    .maybeSingle();

  if (readError) return translate(readError);
  if (!data) return { ok: false, error: "Not found.", status: 404 };
  return { ok: true, node: data };
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

  const { data: moved, error } = await supabase.rpc("move_node", args);
  if (error) return translate(error);

  // move_node is SECURITY INVOKER, so a caller who may read a node but not edit
  // it does not trip a check inside the function: they trip RLS on the UPDATE,
  // which changes no rows, raises nothing, and leaves the function returning a
  // row of nulls. Ignoring that return meant the read-back below found the node
  // — readable, and unmoved — and the endpoint answered 200, which a client
  // could not tell from a move that worked. The data was never at risk; the
  // answer was simply untrue.
  //
  // Shape-tolerant on purpose, for the reason in the comment above: how
  // PostgREST renders a single composite is not something to depend on.
  const row = (Array.isArray(moved) ? moved[0] : moved) as
    | { id: string | null }
    | null
    | undefined;
  if (!row || row.id === null) {
    return { ok: false, error: "Not found.", status: 404 };
  }

  const { data, error: readError } = await supabase
    .from("nodes")
    .select(SELECT)
    .eq("id", args.p_node_id as string)
    .single();

  if (readError) return translate(readError);
  return { ok: true, node: data };
}

/**
 * What the current viewer may do with a node.
 *
 * Asks the predicates rather than inferring from ownership, so a grantee with
 * editor sees the edit affordance and an admin sees sharing. These answers are
 * presentation only: the database refuses the write regardless of what the UI
 * chooses to show.
 */
export async function nodeCapabilities(
  nodeId: string,
): Promise<{ canEdit: boolean; canAdmin: boolean }> {
  const supabase = await createClient();

  // One call, deliberately. These used to go out together through
  // Promise.all, which was the only concurrency in a page render: two requests
  // on one client, each able to decide the session needed refreshing, and
  // refresh tokens rotate. Whichever lost that race went out unauthenticated
  // and came back "false" — a permission check failing silently closed, which
  // looks exactly like the rule working. See the migration for the whole story.
  const { data, error } = await supabase
    .rpc("node_capabilities", { p_node_id: nodeId })
    .maybeSingle<{ can_edit: boolean; can_admin: boolean }>();

  if (error) {
    console.error("node_capabilities failed for %s: %s", nodeId, error.message);
  }

  return {
    canEdit: data?.can_edit === true,
    canAdmin: data?.can_admin === true,
  };
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
  if (data) {
    await refreshLinks(data);
    return { ok: true, node: data };
  }

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

/**
 * Rewrites a page's outgoing links after a save.
 *
 * Done here rather than in a database trigger because resolving `[[Roadmap]]`
 * to a node is the renderer's rule, not the schema's, and there is one copy of
 * it. A trigger would need a second.
 *
 * Failure is swallowed on purpose. Backlinks are navigation metadata: losing
 * them until the next save is a small thing, and refusing somebody's writing
 * because an index could not be updated is not.
 */
async function refreshLinks(node: Node): Promise<void> {
  const targets = extractWikilinkTargets(node.content ?? "");
  const ids = await resolveLinkTargets(node.space_id, targets);

  const supabase = await createClient();
  await supabase.rpc("set_node_links", {
    p_source_node_id: node.id,
    p_target_ids: ids,
  });
}

export async function deleteNode(
  nodeId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const supabase = await createClient();
  // Descendants go with it through ON DELETE CASCADE on parent_id.
  //
  // The rows are read back, and not for information. A delete the policy
  // refuses removes nothing and raises nothing, so without this it answered
  // "done" and the item stayed exactly where it was. That mattered little while
  // deleting was the same as editing; now that you may edit something you may
  // not delete, it is the ordinary case rather than a corner of one.
  const { data, error } = await supabase
    .from("nodes")
    .delete()
    .eq("id", nodeId)
    .select("id");

  if (error) return translate(error);
  if (!data || data.length === 0) {
    return { ok: false, error: "Not found.", status: 404 };
  }
  return { ok: true };
}

/**
 * Sends a node back to its author's own space.
 *
 * Not a deletion, and the difference is the whole point: the work survives with
 * its author and its history, and what it loses is this space and everybody who
 * was reaching it through this space.
 */
export async function evictNode(
  nodeId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("evict_node", { p_node_id: nodeId });

  if (!error) return { ok: true };

  // The one refusal worth explaining. An account being gone takes its
  // authorship with it, and there is then nowhere to send the page back to.
  if (/nobody to send it back to/i.test(error.message)) {
    return {
      ok: false,
      error:
        "Whoever wrote this no longer has an account, so there is nowhere to send it back to. You can delete it instead.",
      status: 409,
    };
  }

  if (/your own work/i.test(error.message)) {
    return {
      ok: false,
      error: "This is your own work, in your own space.",
      status: 409,
    };
  }

  return { ok: false, error: "Not found.", status: 404 };
}

/**
 * Maps a Postgres error onto an HTTP status and a message worth showing.
 *
 * RLS makes a forbidden write look like a missing row, so the honest status
 * is 404 rather than 403, consistent with how reads behave.
 */
export function translate(error: {
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
    // Named rather than hidden behind not-found. The caller reached the parent
    // to name it, so its kind is not a secret, and "not found" here sends
    // people looking for a missing thing that is sitting in front of them.
    return {
      ok: false,
      error:
        "Only folders can contain items. Make a folder first, then create things inside it.",
      status: 400,
    };
  }
  if (/home page of a space/i.test(error.message)) {
    return {
      ok: false,
      error: "The home page follows the space. Rename the space instead.",
      status: 400,
    };
  }
  return { ok: false, error: error.message, status: 400 };
}
