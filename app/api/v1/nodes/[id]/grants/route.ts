import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listEffectiveGrants, shareByEmail, isRole } from "@/lib/grants";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Who can reach this node, and through which grant. Admin only, enforced in SQL. */
export async function GET(_request: NextRequest, { params }: Params) {
  if (!(await requireUser())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await params;
  return Response.json({ grants: await listEffectiveGrants(id) });
}

export async function POST(request: NextRequest, { params }: Params) {
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

  const { email, role } = (body ?? {}) as Record<string, unknown>;

  if (typeof email !== "string") {
    return Response.json({ error: "An email is required." }, { status: 400 });
  }
  if (!isRole(role)) {
    return Response.json(
      { error: "role must be viewer, editor or admin." },
      { status: 400 },
    );
  }

  const result = await shareByEmail(id, email, role);
  return result.ok
    ? Response.json({ grants: await listEffectiveGrants(id) }, { status: 201 })
    : Response.json({ error: result.error }, { status: result.status });
}
