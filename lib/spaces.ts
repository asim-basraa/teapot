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
    content: welcomeDocument(name),
  });

  if (nodeError) return { error: nodeError.message };

  return { slug: space.slug };
}

/**
 * The document a new space starts with.
 *
 * It doubles as a demonstration of the supported syntax, so the first page
 * anyone sees exercises callouts, code highlighting and LaTeX rather than
 * being an empty stub.
 */
function welcomeDocument(name: string): string {
  return `# ${name}

This space is yours. Everything below is ordinary Markdown, rendered on the
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
      "id, space_id, parent_id, kind, name, slug, path, content, content_version",
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
  const supabase = await createClient();
  const { data } = await supabase
    .from("nodes")
    .select("name, slug, path")
    .eq("space_id", spaceId);

  const index = new Map<string, string>();
  for (const node of data ?? []) {
    const href = `/s/${spaceSlug}/${node.path}`;
    // Targets may be written as a full path or as a bare name, both
    // case-insensitively, matching Obsidian's resolution.
    index.set(node.path.toLowerCase(), href);
    index.set(node.name.toLowerCase(), href);
    index.set(node.slug.toLowerCase(), href);
  }

  return {
    resolveLink(target: string) {
      const href = index.get(target.toLowerCase());
      return href ? { href } : null;
    },
  };
}
