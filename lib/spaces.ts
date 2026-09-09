import { createClient } from "@/lib/supabase/server";
import type { SpaceContext } from "@teapot/renderer";

export type Space = {
  id: string;
  slug: string;
  name: string;
  owner_id: string;
};

export type Node = {
  id: string;
  space_id: string;
  parent_id: string | null;
  kind: "folder" | "file";
  name: string;
  slug: string;
  path: string;
  content: string | null;
  content_version: number;
  /** null for folders, which are neither prose nor a skill. */
  content_type: "article" | "skill" | null;
};

/** The path of the page shown at a space's root. */
export const INDEX_PATH = "index";

/**
 * Spaces the caller can see: ones they own, and ones where at least one node
 * is readable to them. The filtering happens in RLS, not here.
 */
export async function listSpaces(): Promise<Space[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("spaces")
    .select("id, slug, name, owner_id")
    .order("name");
  return data ?? [];
}

/**
 * Creates a space and its index page.
 *
 * The index node is created eagerly so a new space is immediately viewable
 * rather than 404ing until its owner happens to write something.
 */
export async function createSpace(
  slug: string,
  name: string,
): Promise<{ error?: string; slug?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are not signed in." };

  const { data: space, error: spaceError } = await supabase
    .from("spaces")
    .insert({ slug, name, owner_id: user.id })
    .select("id, slug")
    .single();

  if (spaceError) {
    if (spaceError.code === "23505") {
      return { error: `The address "${slug}" is already taken.` };
    }
    return { error: spaceError.message };
  }

  const { error: nodeError } = await supabase.from("nodes").insert({
    space_id: space.id,
    parent_id: null,
    kind: "file",
    name: name,
    slug: INDEX_PATH,
    path: INDEX_PATH,
    content: welcomeDocument(),
  });

  if (nodeError) return { error: nodeError.message };

  return { slug: space.slug };
}

/**
 * The document a new space starts with.
 *
 * It doubles as a demonstration of the supported syntax, so the first page
 * anyone sees exercises callouts, code highlighting and LaTeX rather than
 * being an empty stub. It carries no title of its own: the page is titled by
 * its name, which follows the space's.
 */
function welcomeDocument(): string {
  return `This space is yours. Everything below is ordinary Markdown, rendered on the
server each time someone reads it.

> [!tip] Sharing
> Nothing here is public until you say so. Files and folders can be shared
> with a person, with a team, or with everyone.

## Writing

Link to other pages with double brackets, like [[another-page]]. A link to
something you cannot read looks exactly like a link to something that does not
exist, which is deliberate.

You can ==highlight== text, write inline code like \`npm run dev\`, and include
fenced blocks:

\`\`\`ts
export function greet(name: string): string {
  return \`Hello, \${name}\`;
}
\`\`\`

Mathematics renders too, inline as $e^{i\\pi} + 1 = 0$ and as a block:

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

Replace all of this with something of your own.
`;
}

/**
 * Renames a space, and its home page with it.
 *
 * The name only. The slug stays put because it is the address: changing it
 * would break every link anyone has already shared, and a rename is not a
 * request to move house.
 *
 * The home page's name follows because it is the space's own page, and a page
 * is titled by its name. Left alone, the space would be called one thing in
 * the list and another at the top of its front page. A plain update, so the
 * node keeps its `index` slug and the space root still resolves; move_node
 * would rederive the slug from the new name and 404 the space.
 *
 * Whether the caller may do this is RLS's decision, not ours: the update
 * matches no row for anybody but the owner, which we report as not found.
 */
export async function renameSpace(
  spaceId: string,
  name: string,
): Promise<{ error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Give the space a name." };
  if (trimmed.length > 200) return { error: "That name is too long." };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("spaces")
    .update({ name: trimmed })
    .eq("id", spaceId)
    .select("id")
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "Not found." };

  await supabase
    .from("nodes")
    .update({ name: trimmed })
    .eq("space_id", spaceId)
    .eq("path", INDEX_PATH);

  return {};
}

export async function getSpaceBySlug(slug: string): Promise<Space | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("spaces")
    .select("id, slug, name, owner_id")
    .eq("slug", slug)
    .maybeSingle();
  return data ?? null;
}

/**
 * A node by its path within a space, or null.
 *
 * Null covers both "no such node" and "not readable by this viewer", because
 * RLS filters the unreadable row out before it reaches us. Callers must render
 * both as a 404: a 403 would confirm that restricted content exists.
 */
export async function getNodeByPath(
  spaceId: string,
  path: string,
): Promise<Node | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("nodes")
    .select(
      "id, space_id, parent_id, kind, name, slug, path, content, content_version, content_type",
    )
    .eq("space_id", spaceId)
    .eq("path", path)
    .maybeSingle();
  return data ?? null;
}

/**
 * Builds a wikilink resolver over the nodes this viewer can read.
 *
 * Because the underlying query is RLS-filtered, a target the viewer cannot
 * read is simply absent from the index and resolves to null, exactly as a
 * nonexistent one does. The renderer cannot tell them apart, which is what
 * stops navigation metadata leaking.
 */
export async function buildSpaceContext(
  spaceId: string,
  spaceSlug: string,
): Promise<SpaceContext> {
  const index = await buildLinkIndex(spaceId);

  return {
    resolveLink(target: string) {
      const hit = index.get(target.toLowerCase());
      return hit ? { href: `/s/${spaceSlug}/${hit.path}` } : null;
    },
  };
}

/**
 * Resolves wikilink targets to node ids, for backlink maintenance.
 *
 * Shares buildLinkIndex with the renderer's resolver on purpose. Two
 * resolution rules, one deciding what a link points at and another deciding
 * what gets recorded, would drift, and the drift would be silent: pages would
 * render a working link that no backlink panel ever mentioned.
 *
 * Unresolvable targets are dropped rather than reported. A target the caller
 * cannot read is one of them, which is what stops the links table being used
 * to assert that a restricted page exists.
 */
export async function resolveLinkTargets(
  spaceId: string,
  targets: string[],
): Promise<string[]> {
  if (targets.length === 0) return [];
  const index = await buildLinkIndex(spaceId);

  const ids = new Set<string>();
  for (const target of targets) {
    const hit = index.get(target.trim().toLowerCase());
    if (hit) ids.add(hit.id);
  }
  return [...ids];
}

type IndexEntry = { id: string; path: string };

/**
 * Every way a node in this space can be named, lowercased.
 *
 * Built through RLS, so nodes the caller cannot read are simply absent, and a
 * link to one resolves to null exactly as a link to a nonexistent page does.
 */
async function buildLinkIndex(
  spaceId: string,
): Promise<Map<string, IndexEntry>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("nodes")
    .select("id, name, slug, path")
    .eq("space_id", spaceId);

  const index = new Map<string, IndexEntry>();
  for (const node of data ?? []) {
    const entry: IndexEntry = { id: node.id, path: node.path };
    // Targets may be written as a full path or as a bare name, both
    // case-insensitively, matching Obsidian's resolution.
    index.set(node.path.toLowerCase(), entry);
    index.set(node.name.toLowerCase(), entry);
    index.set(node.slug.toLowerCase(), entry);
  }
  return index;
}
