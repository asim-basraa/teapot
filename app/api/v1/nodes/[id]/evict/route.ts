import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { evictNode } from "@/lib/nodes";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Sends a node back to its author's own space.
 *
 * A POST rather than a DELETE, because it is emphatically not a deletion: the
 * page survives, keeps its author and its history, and changes address. The
 * space's owner may ask; the database decides.
 */
export async function POST(_request: NextRequest, { params }: Params) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not found." }, { status: 404 });

  const { id } = await params;
  const result = await evictNode(id);

  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: result.error }, { status: result.status });
}
