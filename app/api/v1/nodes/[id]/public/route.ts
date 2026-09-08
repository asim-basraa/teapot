import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listEffectiveGrants, setPublic } from "@/lib/grants";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Publishing state as a single idempotent write.
 *
 * PUT with `{ public: true | false }` rather than POST-to-publish and
 * DELETE-to-unpublish, because the client is setting a state rather than
 * creating and destroying a thing, and repeating the call must be harmless.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not found." }, { status: 404 });

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const isPublic = (body as Record<string, unknown>)?.public;
  if (typeof isPublic !== "boolean") {
    return Response.json(
      { error: "public must be true or false." },
      { status: 400 },
    );
  }

  const result = await setPublic(id, isPublic);
  return result.ok
    ? Response.json({ grants: await listEffectiveGrants(id) })
    : Response.json({ error: result.error }, { status: result.status });
}
