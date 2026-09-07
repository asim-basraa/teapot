import { visit } from "unist-util-visit";
import type { Root, Blockquote, Paragraph } from "mdast";

// > [!note] Optional title
// > body
//
// The +/- suffix is Obsidian's fold marker. We record it but do not implement
// folding here; that is a presentation concern for the reading UI.
const CALLOUT_MARKER = /^\[!([A-Za-z]+)\]([+-]?)[ \t]*(.*)$/;

const KNOWN_TYPES = new Set([
  "note",
  "abstract",
  "info",
  "todo",
  "tip",
  "success",
  "question",
  "warning",
  "failure",
  "danger",
  "bug",
  "example",
  "quote",
]);

/**
 * Turns Obsidian callout blockquotes into structured markup.
 *
 * A blockquote whose first line is a `[!type]` marker becomes a callout
 * element; every other blockquote is left exactly as it was.
 */
export function remarkCallouts() {
  return (tree: Root) => {
    visit(tree, "blockquote", (node: Blockquote) => {
      const firstBlock = node.children[0];
      if (!firstBlock || firstBlock.type !== "paragraph") return;

      const firstInline = firstBlock.children[0];
      if (!firstInline || firstInline.type !== "text") return;

      // The marker occupies the first line only; the rest of the text node is
      // body content and must survive.
      const newlineAt = firstInline.value.indexOf("\n");
      const markerLine =
        newlineAt === -1
          ? firstInline.value
          : firstInline.value.slice(0, newlineAt);
      const remainder =
        newlineAt === -1 ? "" : firstInline.value.slice(newlineAt + 1);

      const match = CALLOUT_MARKER.exec(markerLine);
      if (!match) return;

      const [, rawType, fold, inlineTitle] = match;
      const type = rawType.toLowerCase();
      const kind = KNOWN_TYPES.has(type) ? type : "note";

      firstInline.value = remainder;

      // An empty leading paragraph would render as a blank line above the body.
      if (remainder === "" && firstBlock.children.length === 1) {
        node.children.shift();
      }

      const title: Paragraph = {
        type: "paragraph",
        data: {
          hName: "div",
          hProperties: { className: ["callout-title"] },
        },
        children: [
          { type: "text", value: inlineTitle.trim() || titleCase(kind) },
        ],
      };

      node.children.unshift(title);
      node.data = {
        ...node.data,
        hName: "div",
        hProperties: {
          className: ["callout", `callout-${kind}`],
          "data-callout": kind,
          ...(fold ? { "data-callout-fold": fold } : {}),
        },
      };
    });
  };
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
