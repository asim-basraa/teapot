import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { listOwnedSpaces } from "@/lib/admin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The spaces one person owns, for handing them to somebody else. */
export async function GET(_request: NextRequest, { params }: Params) {
  if (!(await currentUser())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await params;
  return Response.json({ spaces: await listOwnedSpaces(id) });
}
