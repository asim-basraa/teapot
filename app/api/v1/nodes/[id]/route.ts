import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  renameNode,
  moveNode,
  deleteNode,
  saveNodeContent,
  setContentType,
  isContentType,
} from "@/lib/nodes";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Rename and move.
 *
 * Both go through move_node in the database, which rewrites descendant paths
 * in the same statement. Renaming a folder here and updating its children in a
 * follow-up request would leave a window where the tree is inconsistent, and a
 * failure in between would leave it permanently so.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  if (!(await requireUser())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const fields = (body ?? {}) as Record<string, unknown>;
  const { name, parent_id, content, content_version } = fields;
  const contentType = fields.content_type;
  const wantsMove = "parent_id" in fields;
  const wantsContent = "content" in fields;

  if (wantsContent) {
    if (typeof content !== "string" || typeof content_version !== "number") {
      return Response.json(
        { error: "content and content_version are both required." },
        { status: 400 },
      );
    }

    const saved = await saveNodeContent(id, content, content_version);
    if (saved.ok) return Response.json({ node: saved.node });

    return Response.json(
      { error: saved.error, current_content: saved.currentContent },
      { status: saved.status },
    );
  }

  // Changing the type is its own edit rather than a field on a content save,
  // so an author can reclassify a page without rewriting it.
  if (contentType !== undefined) {
    if (!isContentType(contentType)) {
      return Response.json(
        { error: "content_type must be article or skill." },
        { status: 400 },
      );
    }

    const typed = await setContentType(id, contentType);
    return typed.ok
      ? Response.json({ node: typed.node })
      : Response.json({ error: typed.error }, { status: typed.status });
  }

  if (typeof name !== "string" && !wantsMove) {
    return Response.json(
      { error: "Provide a name, parent_id, content, or content_type." },
      { status: 400 },
    );
  }

  const result = wantsMove
    ? await moveNode(id, typeof parent_id === "string" ? parent_id : null)
    : await renameNode(id, name as string);

  return result.ok
    ? Response.json({ node: result.node })
    : Response.json({ error: result.error }, { status: result.status });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  if (!(await requireUser())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await params;
  const result = await deleteNode(id);

  return result.ok
    ? new Response(null, { status: 204 })
    : Response.json({ error: result.error }, { status: result.status });
}
