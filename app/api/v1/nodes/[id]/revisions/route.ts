import type { NextRequest } from "next/server";
import { listRevisions } from "@/lib/revisions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * A page's history.
 *
 * No permission check here, deliberately. The policy on node_revisions
 * requires can_read of the page, so a caller who may not read it gets an empty
 * list, which is what a page with no history looks like and what a page that
 * does not exist looks like. One rule, in one place.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  return Response.json({ revisions: await listRevisions(id) });
}
