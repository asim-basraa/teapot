import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createNode, listNodes } from "@/lib/nodes";

export const dynamic = "force-dynamic";

/**
 * Node CRUD.
 *
 * These handlers do no authorization of their own. They establish who is
 * asking and hand the query to Supabase, where RLS and the can_read family
 * decide what is visible and writable. Keeping the decision in one place is
 * the whole point: a check duplicated here could drift from the policy.
 */

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET(request: NextRequest) {
  if (!(await requireUser())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const spaceId = request.nextUrl.searchParams.get("space_id");
  if (!spaceId) {
    return Response.json({ error: "space_id is required." }, { status: 400 });
  }

  return Response.json({ nodes: await listNodes(spaceId) });
}

export async function POST(request: NextRequest) {
  if (!(await requireUser())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { space_id, parent_id, kind, name } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof space_id !== "string" || typeof name !== "string") {
    return Response.json(
      { error: "space_id and name are required." },
      { status: 400 },
    );
  }
  if (kind !== "folder" && kind !== "file") {
    return Response.json(
      { error: "kind must be folder or file." },
      { status: 400 },
    );
  }

  const result = await createNode({
    spaceId: space_id,
    parentId: typeof parent_id === "string" ? parent_id : null,
    kind,
    name,
  });

  return result.ok
    ? Response.json({ node: result.node }, { status: 201 })
    : Response.json({ error: result.error }, { status: result.status });
}
