import { findAndReplace } from "mdast-util-find-and-replace";
import type { Root, PhrasingContent } from "mdast";
import type { SpaceContext } from "./context.js";

// [[target]], [[target|alias]], [[target#heading]], and the ![[embed]] form.
// Targets cannot contain [ ] | or #, which keeps the pattern unambiguous.
const WIKILINK =
  /(!?)\[\[([^[\]|#]+)(#[^[\]|]+)?(?:\|([^[\]]+))?\]\]/g;

/**
 * Resolves Obsidian wikilinks against the viewer's readable set.
 *
 * A target the viewer cannot read and a target that does not exist both render
 * as the same inert span. That indistinguishability is deliberate: if a broken
 * link looked different from a forbidden one, the difference would itself
 * disclose that restricted content exists.
 */
export function remarkWikilinks(ctx: SpaceContext) {
  return (tree: Root) => {
    findAndReplace(tree, [
      [
        WIKILINK,
        (
          _match: string,
          bang: string,
          target: string,
          hash: string | undefined,
          alias: string | undefined,
        ): PhrasingContent => {
          const label = (alias ?? target).trim();
          const resolved = ctx.resolveLink(target.trim());

          // Transclusion is out of scope, so an embed renders as a plain link
          // to its target rather than inlining the other document.
          const isEmbed = bang === "!";

          if (resolved === null) {
            return {
              type: "wikilink",
              data: {
                hName: "span",
                hProperties: {
                  className: ["wikilink", "wikilink-unresolved"],
                  // Not a link, and announced as unavailable rather than broken,
                  // so assistive tech gets the same ambiguity everyone else does.
                  "aria-disabled": "true",
                },
              },
              children: [{ type: "text", value: label }],
            } as unknown as PhrasingContent;
          }

          return {
            type: "link",
            url: `${resolved.href}${hash ?? ""}`,
            title: null,
            data: {
              hProperties: {
                className: isEmbed
                  ? ["wikilink", "wikilink-embed"]
                  : ["wikilink"],
              },
            },
            children: [{ type: "text", value: label }],
          };
        },
      ],
    ]);
  };
}

/**
 * Every wikilink target in a document, in source order, deduplicated.
 * Used to maintain the `links` table on save so backlinks stay current.
 */
export function extractWikilinkTargets(markdown: string): string[] {
  const targets = new Set<string>();
  for (const match of markdown.matchAll(WIKILINK)) {
    const target = match[2]?.trim();
    if (target) targets.add(target);
  }
  return [...targets];
}
