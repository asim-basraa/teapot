import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listTeams, createTeam } from "@/lib/teams";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Teams in a space, filtered by RLS to the ones the caller may see. */
export async function GET(_request: NextRequest, { params }: Params) {
  if (!(await requireUser())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await params;
  return Response.json({ teams: await listTeams(id) });
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

  const { name } = (body ?? {}) as Record<string, unknown>;
  if (typeof name !== "string") {
    return Response.json({ error: "A name is required." }, { status: 400 });
  }

  const result = await createTeam(id, name);
  return result.ok
    ? Response.json({ team: result.team }, { status: 201 })
    : Response.json({ error: result.error }, { status: result.status });
}
