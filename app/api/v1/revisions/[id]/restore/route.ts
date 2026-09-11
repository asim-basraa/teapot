import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { restoreRevision } from "@/lib/revisions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Puts a page back to what this revision said.
 *
 * POST rather than PUT: it creates a new revision rather than setting one, and
 * repeating it is not the same as doing it once. Whether the caller may is
 * decided in SQL, where the edit rule already lives.
 */
export async function POST(_request: NextRequest, { params }: Params) {
  if (!(await currentUser())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await params;
  const result = await restoreRevision(id);

  return result.ok
    ? Response.json({ version: result.version })
    : Response.json({ error: result.error }, { status: result.status });
}
