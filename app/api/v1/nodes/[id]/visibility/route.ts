import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import {
  listEffectiveGrants,
  setVisibility,
  isRole,
  isVisibility,
} from "@/lib/grants";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * How far a node reaches: private, everyone with an account, or the web.
 *
 * PUT with `{ visibility, role? }`. One endpoint rather than one per audience,
 * because it is one question with three answers, and answering it twice is how
 * a node ends up in a state nobody chose. `role` applies only to `everyone`,
 * where reading and writing are both things somebody might want for a whole
 * organisation; public is read-only, enforced in the database.
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

  const fields = (body ?? {}) as Record<string, unknown>;
  const { visibility } = fields;
  const role = fields.role ?? null;

  if (!isVisibility(visibility)) {
    return Response.json(
      { error: "visibility must be private, everyone or public." },
      { status: 400 },
    );
  }
  if (role !== null && !isRole(role)) {
    return Response.json(
      { error: "role must be viewer, editor or null." },
      { status: 400 },
    );
  }

  const result = await setVisibility(id, visibility, role);
  return result.ok
    ? Response.json({ visibility, grants: await listEffectiveGrants(id) })
    : Response.json({ error: result.error }, { status: result.status });
}
