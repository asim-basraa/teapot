import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listEffectiveGrants, shareByEmail, isRole } from "@/lib/grants";
import { shareWithTeam } from "@/lib/teams";

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

  const { email, team_id: teamId, role } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof email !== "string" && typeof teamId !== "string") {
    return Response.json(
      { error: "An email or a team is required." },
      { status: 400 },
    );
  }
  if (!isRole(role)) {
    return Response.json(
      { error: "role must be viewer, editor or admin." },
      { status: 400 },
    );
  }

  // A team grant and a personal grant are the same operation with a different
  // grantee, so they share a route rather than diverging into two shapes the
  // client has to know about.
  const result =
    typeof teamId === "string"
      ? await shareWithTeam(id, teamId, role)
      : await shareByEmail(id, email as string, role);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  // `invited` says an account was created and an email sent, which the sharer
  // needs to know: the person is on the list but cannot read anything until
  // they accept.
  return Response.json(
    {
      grants: await listEffectiveGrants(id),
      invited: "invited" in result ? result.invited === true : false,
    },
    { status: 201 },
  );
}
