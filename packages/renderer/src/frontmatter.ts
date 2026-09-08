import { parse as parseYaml } from "yaml";

export type Frontmatter = {
  /** Every scalar key found, lowercased, with string values. */
  data: Record<string, string>;
  /** The document with its frontmatter block removed. */
  body: string;
  /** True when a block was present, even if it parsed to nothing. */
  present: boolean;
  /** A parse failure, worth showing an author. Null when there was none. */
  error: string | null;
};

// Leading `---` on its own line, YAML until a closing `---` or `...`, then the
// rest. Deliberately anchored at the very start: a rule partway down a document
// is a horizontal rule and must stay one.
const BLOCK = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/**
 * Splits YAML frontmatter off a Markdown document.
 *
 * Pure, and deliberately forgiving. A skill whose frontmatter does not parse is
 * still a document somebody wrote: it comes back with its body intact and the
 * error reported, so the caller can save the work and flag the problem rather
 * than refusing the write over a stray colon.
 *
 * Values are flattened to strings because the only consumers are labels: a
 * skill's name and description, shown to a person or handed to a client
 * deciding whether a skill is relevant. Anything structured is stringified
 * rather than dropped, so nothing silently disappears.
 */
export function parseFrontmatter(markdown: string): Frontmatter {
  const match = BLOCK.exec(markdown);

  if (!match) {
    return { data: {}, body: markdown, present: false, error: null };
  }

  const body = markdown.slice(match[0].length);

  let parsed: unknown;
  try {
    parsed = parseYaml(match[1]);
  } catch (error) {
    return {
      data: {},
      body,
      present: true,
      error: error instanceof Error ? error.message : "Invalid frontmatter.",
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      data: {},
      body,
      present: true,
      // An empty block is not an error; a list or a bare scalar is, because
      // there is no way to read a name out of it.
      error:
        parsed === null || parsed === undefined
          ? null
          : "Frontmatter must be a set of key: value pairs.",
    };
  }

  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    data[key.toLowerCase()] = stringify(value);
  }

  return { data, body, present: true, error: null };
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stringify).join(", ");
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export type SkillMetadata = {
  name: string | null;
  description: string | null;
  /** What a skill is missing, in the order an author should fix it. */
  missing: string[];
};

/**
 * The metadata a skill needs, read from its frontmatter.
 *
 * Advisory, never blocking. A skill with no description is still saved and
 * still readable; it is simply flagged, because losing somebody's writing over
 * a formatting detail is a much worse outcome than an incomplete skill.
 */
export function readSkillMetadata(markdown: string): SkillMetadata {
  const { data } = parseFrontmatter(markdown);

  const name = data.name?.trim() || null;
  const description = data.description?.trim() || null;

  const missing: string[] = [];
  if (!name) missing.push("name");
  if (!description) missing.push("description");

  return { name, description, missing };
}
