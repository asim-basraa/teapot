import { describe, it, expect } from "vitest";
import { renderMarkdown, extractWikilinkTargets } from "../src/index.js";
import type { SpaceContext } from "../src/index.js";

/**
 * A space where `readable` resolves and everything else does not. The renderer
 * cannot tell why a target failed to resolve, which is the point.
 */
const space: SpaceContext = {
  resolveLink: (target) =>
    target === "readable" || target === "Other Note"
      ? { href: `/s/demo/${target.toLowerCase().replace(/\s+/g, "-")}` }
      : null,
};

describe("wikilinks", () => {
  it("resolves a readable target to a link", async () => {
    const { html } = await renderMarkdown("See [[readable]].", space);
    expect(html).toContain('href="/s/demo/readable"');
    expect(html).toContain(">readable</a>");
  });

  it("uses the alias as the link text", async () => {
    const { html } = await renderMarkdown("See [[readable|the notes]].", space);
    expect(html).toContain('href="/s/demo/readable"');
    expect(html).toContain(">the notes</a>");
  });

  it("carries a heading fragment through to the href", async () => {
    const { html } = await renderMarkdown("See [[readable#Setup]].", space);
    expect(html).toContain('href="/s/demo/readable#Setup"');
  });

  it("renders an unreadable target as an inert span, not a link", async () => {
    const { html } = await renderMarkdown("See [[secret]].", space);
    expect(html).toContain("wikilink-unresolved");
    expect(html).not.toContain("<a");
    expect(html).toContain(">secret</span>");
  });

  it("renders missing and unreadable targets identically", async () => {
    // `secret` exists but is forbidden; `does-not-exist` is absent. A reader
    // must not be able to tell which is which.
    const forbidden = await renderMarkdown("[[secret]]", space);
    const missing = await renderMarkdown("[[does-not-exist]]", space);

    const shape = (html: string) => html.replace(/>[^<]+</g, ">TEXT<");
    expect(shape(forbidden.html)).toBe(shape(missing.html));
  });

  it("does not leak the target when an alias is used", async () => {
    const { html } = await renderMarkdown("[[secret|Something]]", space);
    expect(html).not.toContain("secret");
    expect(html).toContain(">Something</span>");
  });

  it("collects link targets for backlink maintenance", () => {
    const targets = extractWikilinkTargets(
      "[[readable]] and [[Other Note|alias]] and [[readable]] again",
    );
    expect(targets).toEqual(["readable", "Other Note"]);
  });
});

describe("callouts", () => {
  it("renders a callout with its type and default title", async () => {
    const { html } = await renderMarkdown("> [!warning]\n> Be careful", space);
    expect(html).toContain('class="callout callout-warning"');
    expect(html).toContain('data-callout="warning"');
    expect(html).toContain("Warning");
    expect(html).toContain("Be careful");
  });

  it("uses a custom title when given", async () => {
    const { html } = await renderMarkdown("> [!tip] Do this\n> Body", space);
    expect(html).toContain('class="callout callout-tip"');
    expect(html).toContain("Do this");
  });

  it("falls back to note for an unknown callout type", async () => {
    const { html } = await renderMarkdown("> [!nonsense]\n> Body", space);
    expect(html).toContain("callout-note");
  });

  it("leaves an ordinary blockquote alone", async () => {
    const { html } = await renderMarkdown("> Just a quote", space);
    expect(html).toContain("<blockquote>");
    expect(html).not.toContain("callout");
  });
});

describe("syntax highlighting", () => {
  it("highlights a fenced code block", async () => {
    const { html } = await renderMarkdown(
      "```ts\nconst x: number = 1;\n```",
      space,
    );
    expect(html).toContain("<pre");
    expect(html).toContain("shiki");
    // Shiki emits per-token colour, which is how we know it actually ran.
    expect(html).toMatch(/style="[^"]*color:/);
  });
});

describe("math", () => {
  it("renders inline LaTeX through KaTeX", async () => {
    const { html } = await renderMarkdown("Euler: $e^{i\\pi} + 1 = 0$", space);
    expect(html).toContain("katex");
  });

  it("renders display LaTeX", async () => {
    // Display math needs the delimiters on their own lines; `$$x$$` inline is
    // parsed as inline math, matching remark-math's rules.
    const { html } = await renderMarkdown(
      "$$\n\\int_0^1 x^2 dx\n$$",
      space,
    );
    expect(html).toContain("katex");
    expect(html).toContain("katex-display");
  });
});

describe("sanitization", () => {
  it("strips script tags", async () => {
    const { html } = await renderMarkdown(
      "Hello <script>alert('xss')</script> world",
      space,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
  });

  it("strips inline event handlers", async () => {
    const { html } = await renderMarkdown(
      '<img src="x" onerror="alert(1)">',
      space,
    );
    expect(html).not.toContain("onerror");
  });

  it("strips javascript: hrefs", async () => {
    const { html } = await renderMarkdown(
      '<a href="javascript:alert(1)">click</a>',
      space,
    );
    expect(html).not.toContain("javascript:");
  });

  it("strips iframes", async () => {
    const { html } = await renderMarkdown(
      '<iframe src="https://evil.test"></iframe>',
      space,
    );
    expect(html).not.toContain("<iframe");
  });

  it("keeps benign inline HTML", async () => {
    const { html } = await renderMarkdown("A <em>real</em> emphasis", space);
    expect(html).toContain("<em>real</em>");
  });
});

describe("markdown flavours", () => {
  it("renders GFM tables", async () => {
    const { html } = await renderMarkdown(
      "| a | b |\n| - | - |\n| 1 | 2 |",
      space,
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  it("renders strikethrough", async () => {
    const { html } = await renderMarkdown("~~gone~~", space);
    expect(html).toContain("<del>gone</del>");
  });

  it("renders Obsidian highlights", async () => {
    const { html } = await renderMarkdown("some ==important== text", space);
    expect(html).toContain("<mark>important</mark>");
  });

  it("adds heading slugs for the table of contents", async () => {
    const { html } = await renderMarkdown("## Getting Started", space);
    expect(html).toContain('id="getting-started"');
  });
});

describe("purity", () => {
  it("returns identical output for identical input", async () => {
    const a = await renderMarkdown("# Same\n\n[[readable]]", space);
    const b = await renderMarkdown("# Same\n\n[[readable]]", space);
    expect(a.html).toBe(b.html);
  });
});
