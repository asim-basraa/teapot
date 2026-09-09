import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import {
  listEffectiveGrants,
  setSharedWithEveryone,
  isRole,
} from "@/lib/grants";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Who, among people with an account, may reach this node.
 *
 * PUT with `{ role: "viewer" | "editor" }` to share it with everyone, or
 * `{ role: null }` to stop. One idempotent write, because the client is setting
 * a state rather than creating and destroying a thing.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  if (!(await currentUser())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const role = (body as Record<string, unknown>)?.role ?? null;

  if (role !== null && !isRole(role)) {
    return Response.json(
      { error: "role must be viewer, editor, or null." },
      { status: 400 },
    );
  }

  const result = await setSharedWithEveryone(id, role);
  return result.ok
    ? Response.json({ grants: await listEffectiveGrants(id) })
    : Response.json({ error: result.error }, { status: result.status });
}
