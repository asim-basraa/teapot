"use client";

import { useEffect } from "react";

/**
 * Renders mermaid diagrams in the article, in the reader's browser.
 *
 * Client-side on purpose. Mermaid needs a DOM to lay a diagram out, so
 * rendering on the server would mean a headless browser in the request path:
 * a large amount of machinery, and a denial-of-service surface, for something
 * that renders perfectly well where the reader already is.
 *
 * Mermaid is imported dynamically so a page without diagrams never downloads
 * it, and only when a `pre.mermaid` is actually present.
 */
export function Mermaid() {
  useEffect(() => {
    let cancelled = false;

    async function render() {
      const blocks = Array.from(
        document.querySelectorAll<HTMLElement>("pre.mermaid"),
      );
      if (blocks.length === 0) return;

      const mermaid = (await import("mermaid")).default;
      if (cancelled) return;

      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      mermaid.initialize({
        startOnLoad: false,
        // Theme is fixed at initialisation, so it is chosen here and the whole
        // pass is repeated when the reader's theme changes.
        theme: dark ? "dark" : "default",
        securityLevel: "strict",
      });

      for (const [index, block] of blocks.entries()) {
        // The source is kept on the element so a re-render after a theme
        // change still has it: the first pass replaces the text with SVG.
        const source = block.dataset.source ?? block.textContent ?? "";
        block.dataset.source = source;

        try {
          const { svg } = await mermaid.render(
            `mermaid-${index}-${dark ? "dark" : "light"}`,
            source,
          );
          if (cancelled) return;
          block.innerHTML = svg;
          block.classList.remove("mermaid-error");
        } catch (error) {
          if (cancelled) return;
          // Failing visibly. A diagram that quietly disappears leaves an
          // author with nothing to fix; they need the source and the reason.
          block.classList.add("mermaid-error");
          block.textContent = "";

          const message = document.createElement("p");
          message.className = "mermaid-message";
          message.textContent =
            error instanceof Error ? error.message : "Could not draw this diagram.";

          const code = document.createElement("code");
          // textContent, never innerHTML: this is the author's own source
          // coming back, and it has no business being parsed as markup here.
          code.textContent = source;

          block.append(message, code);
        }
      }
    }

    void render();

    // Mermaid bakes its palette in at initialisation, so a theme change needs
    // the whole pass again rather than a restyle.
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => void render();
    scheme.addEventListener("change", onChange);

    return () => {
      cancelled = true;
      scheme.removeEventListener("change", onChange);
    };
  }, []);

  return null;
}
