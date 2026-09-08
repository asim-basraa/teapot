import { visit } from "unist-util-visit";
import type { Root, Element, Text } from "hast";

/**
 * Turns ```mermaid fences into blocks the client can hydrate.
 *
 * A mermaid fence arrives here as `<pre><code class="language-mermaid">`, which
 * Shiki would otherwise syntax-highlight into a tree of coloured spans. That is
 * both wrong to look at and destructive: mermaid needs the diagram source, and
 * by then there is no source left, only markup.
 *
 * So this rewrites the pair into a single `<pre class="mermaid">` holding the
 * text unchanged, and must run BEFORE the highlighter.
 *
 * It runs after sanitization for the same reason everything else does: the
 * diagram source is author input and has already been through the schema. This
 * step only moves text that survived that pass, so a diagram cannot be used to
 * smuggle markup through.
 */
export function rehypeMermaid() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "pre" || !parent || index === undefined) return;

      const code = node.children.find(
        (child): child is Element =>
          child.type === "element" && child.tagName === "code",
      );
      if (!code || !isMermaid(code)) return;

      const source = code.children
        .filter((child): child is Text => child.type === "text")
        .map((child) => child.value)
        .join("");

      const replacement: Element = {
        type: "element",
        tagName: "pre",
        properties: { className: ["mermaid"] },
        children: [{ type: "text", value: source }],
      };

      parent.children[index] = replacement;
    });
  };
}

function isMermaid(code: Element): boolean {
  const classes: unknown = code.properties?.className;
  if (Array.isArray(classes)) return classes.includes("language-mermaid");
  return typeof classes === "string" && classes.includes("language-mermaid");
}
