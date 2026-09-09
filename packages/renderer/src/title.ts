import type { Root, Heading } from "mdast";

/**
 * Removes a level-one heading standing at the top of a document.
 *
 * The title of a page is its name, and the name is what the sidebar shows,
 * what a link resolves by and what rename changes. A document that also
 * carries its title as a heading has a second copy of it, and the two drift
 * apart the moment anyone renames anything: the sidebar says one thing and the
 * page says another. That is the bug this removes rather than papers over.
 *
 * Only the first block, and only level one. A heading further down is a
 * section, and a level-two heading is never a title, so neither is touched.
 */
export function remarkStripTitle() {
  return (tree: Root) => {
    const first = tree.children[0];
    if (!first || first.type !== "heading") return;
    if ((first as Heading).depth !== 1) return;
    tree.children.shift();
  };
}
