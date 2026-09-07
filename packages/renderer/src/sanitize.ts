import { defaultSchema } from "rehype-sanitize";
import type { Options as SanitizeSchema } from "rehype-sanitize";

/**
 * Sanitization schema for author-supplied HTML.
 *
 * This runs immediately after raw HTML is parsed and BEFORE KaTeX and Shiki.
 * That ordering matters: everything reaching the sanitizer is untrusted author
 * input, while the markup those two plugins emit afterwards is ours and needs
 * no scrubbing. Sanitizing after them would mean writing an allow list broad
 * enough to cover all of KaTeX's MathML, which is a much larger surface to get
 * wrong.
 */
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // Class names survive because the pipeline depends on them: `math` and
    // `math-display` mark nodes for KaTeX, `language-*` marks code blocks for
    // Shiki, and callouts and wikilinks carry their own. The cost is that an
    // author can apply an app class to their own content; it buys no script
    // execution, and content is only ever shown to people already permitted
    // to read it.
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className"],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      "className",
      "ariaDisabled",
    ],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      "className",
      "dataCallout",
      "dataCalloutFold",
    ],
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    pre: [...(defaultSchema.attributes?.pre ?? []), "className"],
  },
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "mark",
    "section",
    // remark-math emits these before rehype-katex replaces them.
    "math",
    "semantics",
    "annotation",
  ],
  // `javascript:` and friends are already excluded by the default protocol
  // list; restated here so the guarantee is visible at the call site.
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto", "#"],
    src: ["http", "https"],
  },
};
