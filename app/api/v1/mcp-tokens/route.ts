import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listTokens, createToken } from "@/lib/mcp/tokens";

export const dynamic = "force-dynamic";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  if (!(await requireUser())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return Response.json({ tokens: await listTokens() });
}

/**
 * Mints a token.
 *
 * The plaintext is in this response and nowhere else, ever. It is not stored,
 * not logged, and cannot be recovered: the only thing kept is its hash.
 */
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

  const { name, space_id: spaceId, expires_at: expiresAt } = (body ??
    {}) as Record<string, unknown>;

  if (typeof name !== "string") {
    return Response.json({ error: "A name is required." }, { status: 400 });
  }

  const result = await createToken({
    name,
    spaceId: typeof spaceId === "string" && spaceId ? spaceId : null,
    expiresAt: typeof expiresAt === "string" && expiresAt ? expiresAt : null,
  });

  return result.ok
    ? Response.json(
        { token: result.token, record: result.record },
        { status: 201 },
      )
    : Response.json({ error: result.error }, { status: result.status });
}
