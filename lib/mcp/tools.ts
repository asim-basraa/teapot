import { readSkillMetadata, parseFrontmatter } from "@postit/renderer";
import { startingContent, translate } from "@/lib/nodes";
import type { McpSession } from "./session";

export type ToolResult = { text: string } | { error: string };

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(session: McpSession, args: Record<string, unknown>): Promise<ToolResult>;
};

/**
 * The tools the MCP server offers.
 *
 * Every one of them goes through session.supabase, which carries an access
 * token minted for the token's owner. That means RLS and the can_read family
 * decide what each tool can see, exactly as they do in the browser.
 *
 * **No tool makes an access decision of its own.** A tool that filtered its own
 * results would be a second authorization seam, and a second seam is a seam
 * that eventually disagrees with the first. Where a tool looks like it is
 * filtering, it is scoping: `space_id` narrows a query, it does not decide
 * whether a row may be seen.
 *
 * Nothing destructive ships here. There is no delete_page and no move_page, and
 * no way to change who can see anything. A leaked token that can only add is a
 * far smaller problem than one that can remove, and the web app is a perfectly
 * good place to do the dangerous things deliberately.
 *
 * That rule is about removing and re-permissioning, not about creating.
 * create_folder was missing for a while and it was an oversight rather than a
 * decision: folders are the only thing that can contain anything, so without
 * it no structure could be built here at all, and somebody filing seventeen
 * pages had to choose between a flat list and going to the browser.
 */

function text(value: string): ToolResult {
  return { text: value };
}

/**
 * A name, or the reason it is not one.
 *
 * A slash is the thing people reach for when they mean "put this inside that",
 * because every other tool they have used works that way. Here it is just a
 * character, slugified into a hyphen, so "hybrid-web/README" quietly became one
 * flat page called hybrid-web-readme. Saying so is the whole fix.
 */
function readName(value: unknown): string | { error: string } {
  const name = String(value ?? "").trim();
  if (!name) return { error: "A name is required." };

  if (name.includes("/")) {
    return {
      error:
        "A name cannot contain a slash. Nesting is done with parent_id: make the folder with create_folder, then pass its id here.",
    };
  }

  return name;
}

const listSpaces: ToolDefinition = {
  name: "list_spaces",
  description:
    "List the spaces this token can reach. A space is a top-level collection of pages.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async run(session) {
    let query = session.supabase
      .from("spaces")
      .select("id, slug, name")
      .order("name");

    // Scoping, not filtering: a space-scoped token still cannot see anything
    // its owner could not, RLS having already decided that.
    if (session.spaceId) query = query.eq("id", session.spaceId);

    const { data, error } = await query;
    if (error) return { error: error.message };

    const spaces = (data ?? []) as { id: string; slug: string; name: string }[];
    if (spaces.length === 0) return text("No spaces.");

    return text(
      spaces.map((s) => `- ${s.name} (slug: ${s.slug}, id: ${s.id})`).join("\n"),
    );
  },
};

const search: ToolDefinition = {
  name: "search",
  description:
    "Full-text search within one space. Only pages this token can read are returned.",
  inputSchema: {
    type: "object",
    properties: {
      space_id: { type: "string", description: "The space to search." },
      query: { type: "string", description: "What to look for." },
    },
    required: ["space_id", "query"],
    additionalProperties: false,
  },
  async run(session, args) {
    const spaceId = requireSpace(session, args.space_id);
    if (typeof spaceId !== "string") return spaceId;

    const { data, error } = await session.supabase.rpc("search_nodes", {
      p_space_id: spaceId,
      p_query: String(args.query ?? ""),
    });
    if (error) return { error: error.message };

    const hits = (data ?? []) as { name: string; path: string }[];
    if (hits.length === 0) return text("Nothing matched.");

    return text(hits.map((h) => `- ${h.name} (${h.path})`).join("\n"));
  },
};

const readPage: ToolDefinition = {
  name: "read_page",
  description:
    "Read one page by its path within a space, or by id. Returns the Markdown source. Reading a folder lists what is inside it instead.",
  inputSchema: {
    type: "object",
    properties: {
      space_id: { type: "string" },
      path: { type: "string", description: "For example 'projects/roadmap'." },
      id: { type: "string", description: "Alternative to space_id and path." },
    },
    additionalProperties: false,
  },
  async run(session, args) {
    const node = await findNode(session, args);
    if ("error" in node) return node;

    // A folder has no body, and answering "(no content)" for one is true and
    // useless. What somebody reading a folder wants is what is in it.
    if (node.content_type === null) {
      const { data } = await session.supabase
        .from("nodes")
        .select("name, path, kind, content_type")
        .eq("parent_id", node.id)
        .order("kind")
        .order("name");

      const children = (data ?? []) as {
        name: string;
        path: string;
        kind: string;
        content_type: string | null;
      }[];

      return text(
        [
          `# ${node.name}`,
          `path: ${node.path}`,
          `id: ${node.id}`,
          `type: folder`,
          "",
          children.length === 0
            ? "This folder is empty."
            : children
                .map(
                  (child) =>
                    `- ${child.path} (${child.kind === "folder" ? "folder" : (child.content_type ?? "article")})`,
                )
                .join("\n"),
        ].join("\n"),
      );
    }

    return text(
      [
        `# ${node.name}`,
        `path: ${node.path}`,
        `id: ${node.id}`,
        `type: ${node.content_type}`,
        `version: ${node.content_version}`,
        "",
        node.content ?? "(no content)",
      ].join("\n"),
    );
  },
};

const listTree: ToolDefinition = {
  name: "list_tree",
  description:
    "List everything in a space that this token can reach, as paths, with each item's kind and id. This is how you find a folder to put things in, and how you see what structure already exists.",
  inputSchema: {
    type: "object",
    properties: {
      space_id: { type: "string" },
      kind: {
        type: "string",
        enum: ["folder", "file"],
        description: "Optional. Narrow to just folders or just pages.",
      },
    },
    required: ["space_id"],
    additionalProperties: false,
  },
  async run(session, args) {
    const spaceId = requireSpace(session, args.space_id);
    if (typeof spaceId !== "string") return spaceId;

    let query = session.supabase
      .from("nodes")
      .select("id, name, path, kind, content_type")
      .eq("space_id", spaceId)
      .order("path");

    if (args.kind === "folder" || args.kind === "file") {
      query = query.eq("kind", args.kind);
    }

    const { data, error } = await query;
    if (error) return { error: error.message };

    const nodes = (data ?? []) as {
      id: string;
      name: string;
      path: string;
      kind: string;
      content_type: string | null;
    }[];
    if (nodes.length === 0) return text("Nothing here.");

    // Path order is tree order, so this reads as the shape it describes
    // without having to nest anything.
    return text(
      nodes
        .map((node) => {
          const what =
            node.kind === "folder" ? "folder" : (node.content_type ?? "article");
          return `- ${node.path} (${what}, id: ${node.id})`;
        })
        .join("\n"),
    );
  },
};

const listSkills: ToolDefinition = {
  name: "list_skills",
  description:
    "List the skills in a space, with the name and description from each one's frontmatter, so a client can choose which to load.",
  inputSchema: {
    type: "object",
    properties: { space_id: { type: "string" } },
    required: ["space_id"],
    additionalProperties: false,
  },
  async run(session, args) {
    const spaceId = requireSpace(session, args.space_id);
    if (typeof spaceId !== "string") return spaceId;

    const { data, error } = await session.supabase
      .from("nodes")
      .select("id, name, path, content")
      .eq("space_id", spaceId)
      .eq("content_type", "skill")
      .order("name");
    if (error) return { error: error.message };

    const skills = (data ?? []) as {
      id: string;
      name: string;
      path: string;
      content: string | null;
    }[];
    if (skills.length === 0) return text("No skills in this space.");

    return text(
      skills
        .map((skill) => {
          const meta = readSkillMetadata(skill.content ?? "");
          const label = meta.name ?? skill.name;
          const description = meta.description ?? "(no description)";
          return `- ${label}: ${description} (path: ${skill.path})`;
        })
        .join("\n"),
    );
  },
};

const getSkill: ToolDefinition = {
  name: "get_skill",
  description:
    "Fetch one skill's full Markdown, ready to follow. Takes the same arguments as read_page.",
  inputSchema: {
    type: "object",
    properties: {
      space_id: { type: "string" },
      path: { type: "string" },
      id: { type: "string" },
    },
    additionalProperties: false,
  },
  async run(session, args) {
    const node = await findNode(session, args);
    if ("error" in node) return node;

    if (node.content_type !== "skill") {
      return { error: `${node.name} is not a skill.` };
    }

    // The body without the metadata block: the frontmatter has already been
    // read to decide this skill was worth loading, and repeating it wastes the
    // reader's attention.
    const { body } = parseFrontmatter(node.content ?? "");
    return text(body.trim());
  },
};

const createFolder: ToolDefinition = {
  name: "create_folder",
  description:
    "Create a folder in a space, optionally inside another folder. Folders are the only thing that can contain other items, so building any structure starts here.",
  inputSchema: {
    type: "object",
    properties: {
      space_id: { type: "string" },
      name: { type: "string" },
      parent_id: {
        type: "string",
        description: "Optional folder to create it in. Must be a folder.",
      },
    },
    required: ["space_id", "name"],
    additionalProperties: false,
  },
  async run(session, args) {
    const spaceId = requireSpace(session, args.space_id);
    if (typeof spaceId !== "string") return spaceId;

    const name = readName(args.name);
    if (typeof name !== "string") return name;

    const id = crypto.randomUUID();

    const { error } = await session.supabase.from("nodes").insert({
      id,
      space_id: spaceId,
      parent_id: typeof args.parent_id === "string" ? args.parent_id : null,
      kind: "folder",
      name,
    });

    if (error) return { error: translate(error).error };

    const { data } = await session.supabase
      .from("nodes")
      .select("id, name, path")
      .eq("id", id)
      .maybeSingle();

    // The same shape create_page answers in, so a client that has learned to
    // read one has learned to read both.
    return text(
      data
        ? `Created folder ${name} at ${(data as { path: string }).path} (id: ${id}).`
        : `Created folder ${name}.`,
    );
  },
};

const createPage: ToolDefinition = {
  name: "create_page",
  description:
    "Create a new page in a space. Returns its id and path. Cannot overwrite an existing page.",
  inputSchema: {
    type: "object",
    properties: {
      space_id: { type: "string" },
      name: { type: "string" },
      parent_id: { type: "string", description: "Optional folder to create it in." },
      content_type: { type: "string", enum: ["article", "skill"] },
      content: { type: "string", description: "Optional Markdown body." },
    },
    required: ["space_id", "name"],
    additionalProperties: false,
  },
  async run(session, args) {
    const spaceId = requireSpace(session, args.space_id);
    if (typeof spaceId !== "string") return spaceId;

    const name = readName(args.name);
    if (typeof name !== "string") return name;

    // Named rather than quietly corrected. Passing "folder" here used to
    // produce an article, which reads as the call having worked and leaves
    // somebody wondering why their folder cannot hold anything.
    if (args.content_type === "folder") {
      return {
        error:
          "A folder is not a kind of page. Use create_folder to make one, then pass its id as parent_id here.",
      };
    }
    if (
      args.content_type !== undefined &&
      args.content_type !== "article" &&
      args.content_type !== "skill"
    ) {
      return { error: "content_type must be article or skill." };
    }

    const id = crypto.randomUUID();
    const contentType =
      args.content_type === "skill" ? "skill" : "article";

    const { error } = await session.supabase.from("nodes").insert({
      id,
      space_id: spaceId,
      parent_id: typeof args.parent_id === "string" ? args.parent_id : null,
      kind: "file",
      name,
      content_type: contentType,
      // The same starting text the browser uses. Two copies of this had already
      // drifted: one seeded a heading the other had stopped seeding.
      content:
        typeof args.content === "string"
          ? args.content
          : startingContent(name, contentType),
    });

    if (error) return { error: translate(error).error };

    const { data } = await session.supabase
      .from("nodes")
      .select("id, path")
      .eq("id", id)
      .maybeSingle();

    const created = data as { id: string; path: string } | null;
    return text(
      created
        ? `Created ${name} at ${created.path} (id: ${created.id}).`
        : `Created ${name}.`,
    );
  },
};

const updatePage: ToolDefinition = {
  name: "update_page",
  description:
    "Replace a page's Markdown. Requires the version returned by read_page, and refuses if somebody else has saved since.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      content: { type: "string" },
      version: {
        type: "number",
        description: "The version from read_page. Guards against clobbering.",
      },
    },
    required: ["id", "content", "version"],
    additionalProperties: false,
  },
  async run(session, args) {
    const id = String(args.id ?? "");
    const content = String(args.content ?? "");
    const version = Number(args.version);

    if (!id || !Number.isFinite(version)) {
      return { error: "id, content and version are all required." };
    }

    const { data, error } = await session.supabase
      .from("nodes")
      .update({
        content,
        content_version: version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("content_version", version)
      .select("id, name, content_version")
      .maybeSingle();

    if (error) return { error: error.message };

    if (!data) {
      // No row matched, which is either a stale version or no access. Reading
      // it back disambiguates, exactly as the web editor does.
      const { data: current } = await session.supabase
        .from("nodes")
        .select("content_version")
        .eq("id", id)
        .maybeSingle();

      if (!current) return { error: "Not found." };

      return {
        error: `Someone else saved this page. It is now at version ${
          (current as { content_version: number }).content_version
        }. Read it again before writing.`,
      };
    }

    const saved = data as { name: string; content_version: number };
    return text(`Saved ${saved.name}, now at version ${saved.content_version}.`);
  },
};

const listBacklinks: ToolDefinition = {
  name: "list_backlinks",
  description:
    "Pages that link to a given page. Only sources this token can read are listed.",
  inputSchema: {
    type: "object",
    properties: {
      space_id: { type: "string" },
      path: { type: "string" },
      id: { type: "string" },
    },
    additionalProperties: false,
  },
  async run(session, args) {
    const node = await findNode(session, args);
    if ("error" in node) return node;

    const { data: rows } = await session.supabase
      .from("links")
      .select("source_node_id")
      .eq("target_node_id", node.id);

    const sources = ((rows ?? []) as { source_node_id: string }[]).map(
      (r) => r.source_node_id,
    );
    if (sources.length === 0) return text("Nothing links here.");

    const { data } = await session.supabase
      .from("nodes")
      .select("name, path")
      .in("id", sources)
      .order("name");

    const links = (data ?? []) as { name: string; path: string }[];
    if (links.length === 0) return text("Nothing links here.");

    return text(links.map((l) => `- ${l.name} (${l.path})`).join("\n"));
  },
};

export const TOOLS: ToolDefinition[] = [
  listSpaces,
  search,
  listTree,
  readPage,
  listSkills,
  getSkill,
  createFolder,
  createPage,
  updatePage,
  listBacklinks,
];

type FoundNode = {
  id: string;
  name: string;
  path: string;
  content: string | null;
  content_version: number;
  content_type: "article" | "skill" | null;
};

/**
 * Looks a node up by id, or by path within a space.
 *
 * RLS decides whether it is visible, so a node the token cannot read is
 * reported as missing. That is the same answer the web app gives, and for the
 * same reason: a different answer would confirm the page exists.
 */
async function findNode(
  session: McpSession,
  args: Record<string, unknown>,
): Promise<FoundNode | { error: string }> {
  const select = "id, name, path, content, content_version, content_type";

  if (typeof args.id === "string" && args.id) {
    const { data } = await session.supabase
      .from("nodes")
      .select(select)
      .eq("id", args.id)
      .maybeSingle();
    return (data as FoundNode | null) ?? { error: "Not found." };
  }

  const spaceId = requireSpace(session, args.space_id);
  if (typeof spaceId !== "string") return { error: spaceId.error };

  if (typeof args.path !== "string" || !args.path) {
    return { error: "Provide either an id, or a space_id and a path." };
  }

  const { data } = await session.supabase
    .from("nodes")
    .select(select)
    .eq("space_id", spaceId)
    .eq("path", args.path)
    .maybeSingle();

  return (data as FoundNode | null) ?? { error: "Not found." };
}

/**
 * The space a call applies to, honouring a token pinned to one.
 *
 * A space-scoped token asking about another space is refused here rather than
 * quietly answered about the wrong one. This is scoping the token's reach, not
 * deciding access: RLS still has the final say on everything inside.
 */
function requireSpace(
  session: McpSession,
  requested: unknown,
): string | { error: string } {
  if (session.spaceId) {
    if (typeof requested === "string" && requested !== session.spaceId) {
      return { error: "This token is scoped to a different space." };
    }
    return session.spaceId;
  }

  if (typeof requested !== "string" || !requested) {
    return { error: "space_id is required." };
  }
  return requested;
}
