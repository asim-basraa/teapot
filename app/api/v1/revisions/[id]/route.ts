import type { NextRequest } from "next/server";
import { getRevision } from "@/lib/revisions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** One revision's text, for showing it or diffing against it. */
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const revision = await getRevision(id);

  return revision
    ? Response.json({ revision })
    : Response.json({ error: "Not found." }, { status: 404 });
}
