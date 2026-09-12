import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeKatex from "rehype-katex";
import rehypeShiki from "@shikijs/rehype";
import rehypeStringify from "rehype-stringify";

import { remarkWikilinks, extractWikilinkTargets } from "./wikilinks";
import { remarkCallouts } from "./callouts";
import { remarkStripTitle } from "./title";
import { remarkHighlights } from "./highlights";
import { rehypeMermaid } from "./mermaid";
import { rehypeCollectHeadings } from "./headings";
import { sanitizeSchema } from "./sanitize";
import { parseFrontmatter } from "./frontmatter";
import type { SpaceContext, RenderResult, Heading } from "./context";

export type { SpaceContext, RenderResult, Heading };
export { extractWikilinkTargets };
export { parseFrontmatter, readSkillMetadata } from "./frontmatter";
export type { Frontmatter, SkillMetadata } from "./frontmatter";

/**
 * Renders a Markdown document to sanitized HTML.
 *
 * The pipeline follows Quartz's shape (github.com/jackyzha0/quartz,
 * `quartz/processors/parse.ts`): parse Markdown, apply Markdown transformers,
 * cross to HTML allowing raw HTML through, sanitize, then apply HTML
 * transformers. Quartz's build system, emitters and components are not used.
 *
 * Pure: the same markdown and the same context always produce the same HTML.
 * Everything the renderer needs to know about permissions arrives through
 * `ctx.resolveLink`, so this function makes no access decisions of its own.
 */
export async function renderMarkdown(
  markdown: string,
  ctx: SpaceContext,
): Promise<RenderResult> {
  // Frontmatter is metadata about the document, not part of it. Stripping it
  // here rather than in a remark plugin keeps it out of every downstream
  // transformer's way, and means an unparseable block still does not render as
  // a stray table of text at the top of the page.
  const { body } = parseFrontmatter(markdown);

  // Filled by the collector below as the tree is walked. Local to the call, so
  // the function stays pure: two renders never see each other's headings.
  const headings: Heading[] = [];

  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    // Before anything else looks at the document: the title belongs to the
    // node, so a leading level-one heading is a restatement of it.
    .use(remarkStripTitle)
    .use(remarkCallouts)
    .use(remarkHighlights)
    .use(remarkWikilinks, ctx)
    // allowDangerousHtml lets author HTML reach rehype-raw, which parses it
    // properly; rehype-sanitize immediately below is what makes that safe.
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeSlug)
    .use(rehypeCollectHeadings, headings)
    .use(rehypeKatex)
    // Before Shiki: a mermaid fence must reach the client as source, and the
    // highlighter would have turned it into coloured markup with no source left.
    .use(rehypeMermaid)
    .use(rehypeShiki, { theme: "github-light" })
    .use(rehypeStringify)
    .process(body);

  return {
    html: String(file),
    linkTargets: extractWikilinkTargets(body),
    headings,
  };
}
