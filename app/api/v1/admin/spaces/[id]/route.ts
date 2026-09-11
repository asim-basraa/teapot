import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { isPlatformAdmin, transferSpace } from "@/lib/admin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Hands a space to somebody else.
 *
 * PATCH with `{ owner_id }`. Ownership is where a space's administration comes
 * from, so this is the whole of what "they have left, it is yours now" means.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  if (!(await currentUser()) || !(await isPlatformAdmin())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const ownerId = (body as Record<string, unknown>)?.owner_id;
  if (typeof ownerId !== "string" || !ownerId) {
    return Response.json({ error: "Name the new owner." }, { status: 400 });
  }

  const result = await transferSpace(id, ownerId);

  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: result.error }, { status: result.status });
}
