import { visit } from "unist-util-visit";
import type { Root, Element, ElementContent } from "hast";
import type { Heading } from "./context";

/** Depths that become entries. h1 is the page title, which is not a section. */
const COLLECTED = new Set(["h2", "h3"]);

/**
 * Collects the document's section headings, for a table of contents.
 *
 * Must run AFTER rehype-slug, because the id it records is the one the heading
 * will actually carry in the page, and BEFORE rehype-katex, so that a heading
 * with maths in it contributes its source rather than a tree of KaTeX spans.
 *
 * The reading order of the tree is the reading order of the page, so the list
 * comes out in the order a reader meets the sections, and no sorting is needed.
 */
export function rehypeCollectHeadings(collected: Heading[]) {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (!COLLECTED.has(node.tagName)) return;

      const id = typeof node.properties?.id === "string" ? node.properties.id : null;
      const text = textOf(node.children).trim();

      // A heading with no id cannot be linked to, and one with no text has
      // nothing to show in the list. Either way it is not an entry.
      if (!id || !text) return;

      collected.push({ depth: Number(node.tagName.slice(1)), id, text });
    });
  };
}

/** The visible text of a heading, ignoring whatever markup carries it. */
function textOf(nodes: ElementContent[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") out += node.value;
    else if (node.type === "element") out += textOf(node.children);
  }
  return out;
}
