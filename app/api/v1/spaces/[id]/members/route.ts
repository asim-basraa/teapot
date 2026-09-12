import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { spaceRoster, addSpaceMember, addSpaceTeam } from "@/lib/members";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Who is in this space. Empty for anybody who is not in it. */
export async function GET(_request: NextRequest, { params }: Params) {
  if (!(await requireUser())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await params;
  return Response.json({ members: await spaceRoster(id) });
}

/** Adds a person by address, or a team by id. The owner's, enforced in SQL. */
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

  const { email, team_id: teamId } = (body ?? {}) as Record<string, unknown>;

  const result =
    typeof teamId === "string"
      ? await addSpaceTeam(id, teamId)
      : typeof email === "string"
        ? await addSpaceMember(id, email)
        : {
            ok: false as const,
            error: "An email address or a team is required.",
            status: 400,
          };

  return result.ok
    ? Response.json({ ok: true }, { status: 201 })
    : Response.json({ error: result.error }, { status: result.status });
}
