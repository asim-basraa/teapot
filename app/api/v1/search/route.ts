import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchSpace } from "@/lib/search";

export const dynamic = "force-dynamic";

/**
 * Search within one space.
 *
 * Deliberately open to anonymous callers. Search is filtered by the same
 * policies that decide whether a page renders, so a visitor with no account
 * gets exactly the published subtree and nothing else; refusing them here would
 * add a second rule that could disagree with the first.
 */
export async function GET(request: NextRequest) {
  const spaceId = request.nextUrl.searchParams.get("space_id");
  const query = request.nextUrl.searchParams.get("q") ?? "";

  if (!spaceId) {
    return Response.json({ error: "space_id is required." }, { status: 400 });
  }

  // The slug only decorates the hrefs, and a caller who cannot read the space
  // gets an empty result regardless of what they claim it is called.
  const supabase = await createClient();
  const { data: space } = await supabase
    .from("spaces")
    .select("id, slug")
    .eq("id", spaceId)
    .maybeSingle();

  if (!space) return Response.json({ hits: [] });

  return Response.json({ hits: await searchSpace(space.id, space.slug, query) });
}
