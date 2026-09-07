/**
 * What the renderer needs to know about the space it is rendering inside.
 *
 * The renderer never queries anything. It is handed a resolver and stays a
 * pure function of (markdown, context), which is what makes it testable
 * without a database and what keeps authorization out of the render layer.
 */
export type SpaceContext = {
  /**
   * Resolves a wikilink target to a URL, or null when the target does not
   * exist OR the viewer is not allowed to read it.
   *
   * Collapsing "missing" and "forbidden" into a single null is intentional and
   * is the caller's responsibility to honour: returning different values would
   * let a reader probe for the existence of restricted pages.
   */
  resolveLink(target: string): { href: string } | null;
};

export type RenderResult = {
  /** Sanitized HTML, safe to inject into the page. */
  html: string;
  /** Wikilink targets found in the source, for backlink maintenance. */
  linkTargets: string[];
};
