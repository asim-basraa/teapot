import { findAndReplace } from "mdast-util-find-and-replace";
import type { Root, PhrasingContent } from "mdast";

// Obsidian's ==highlight== syntax. Non-greedy so `==a== and ==b==` is two
// highlights rather than one spanning both.
const HIGHLIGHT = /==(?!\s)([^=]+?)(?<!\s)==/g;

export function remarkHighlights() {
  return (tree: Root) => {
    findAndReplace(tree, [
      [
        HIGHLIGHT,
        (_match: string, text: string): PhrasingContent =>
          ({
            type: "highlight",
            data: { hName: "mark" },
            children: [{ type: "text", value: text }],
          }) as unknown as PhrasingContent,
      ],
    ]);
  };
}
