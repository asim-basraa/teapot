import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { grantableTeams } from "@/lib/teams";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * The teams this node could be shared with.
 *
 * Replaces asking a space for its teams. That question had the wrong subject:
 * which teams you may hand a document to depends on which teams you are on,
 * not on where the document happens to live. Empty for anybody who cannot
 * share this node at all, which is decided in SQL.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return Response.json({ error: "Not found." }, { status: 404 });

  const { id } = await params;
  return Response.json({ teams: await grantableTeams(id) });
}
