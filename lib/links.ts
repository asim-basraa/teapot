import { createClient } from "@/lib/supabase/server";

export type Backlink = {
  id: string;
  name: string;
  path: string;
};

/**
 * Pages that link here and that this viewer is allowed to read.
 *
 * No filtering happens in this function. The policy on `links` requires both
 * ends to be readable, so a row naming a source the viewer cannot see never
 * arrives, and a backlinks panel cannot become the thing that reveals a
 * restricted page exists by mentioning it.
 *
 * Read in two steps rather than one embedded query: `links` has two foreign
 * keys to `nodes`, so an embed has to name the constraint to disambiguate, and
 * depending on a generated constraint name is a worse trade than a second
 * round trip. Both steps pass through the same policies either way.
 */
export async function listBacklinks(
  spaceSlug: string,
  nodeId: string,
): Promise<(Backlink & { href: string })[]> {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("links")
    .select("source_node_id")
    .eq("target_node_id", nodeId);

  const sources = (rows ?? []).map((r) => r.source_node_id);
  if (sources.length === 0) return [];

  const { data: nodes } = await supabase
    .from("nodes")
    .select("id, name, path")
    .in("id", sources)
    .order("name");

  return (nodes ?? []).map((node) => ({
    ...node,
    href: `/s/${spaceSlug}/${node.path}`,
  }));
}
