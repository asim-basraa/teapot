import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { teamRoster, addTeamMember } from "@/lib/teams";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** The roster, which the database will only return to the space owner. */
export async function GET(_request: NextRequest, { params }: Params) {
  if (!(await requireUser())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await params;
  return Response.json({ members: await teamRoster(id) });
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
  if (role !== undefined && role !== "member" && role !== "manager") {
    return Response.json(
      { error: "role must be member or manager." },
      { status: 400 },
    );
  }

  const result = await addTeamMember(id, email, role ?? "member");
  return result.ok
    ? Response.json({ members: await teamRoster(id) }, { status: 201 })
    : Response.json({ error: result.error }, { status: result.status });
}
