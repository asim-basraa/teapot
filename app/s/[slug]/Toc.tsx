import type { Heading } from "@postit/renderer";

/**
 * The sections of the page, as a rail beside it.
 *
 * Plain anchors and no JavaScript: a table of contents is a list of links, and
 * the browser already knows how to follow one. Scrolling is smooth and the
 * landing offset is handled in CSS, so nothing here has to run to work.
 *
 * Absent rather than empty when a document has no sections, and absent for a
 * single one, because a contents list of one entry tells a reader nothing they
 * did not already see.
 */
export function Toc({ headings }: { headings: Heading[] }) {
  if (headings.length < 2) return null;

  return (
    <nav className="toc" aria-label="On this page">
      <h2>On this page</h2>
      <ul>
        {headings.map((heading) => (
          <li
            key={heading.id}
            className={heading.depth > 2 ? "toc-sub" : undefined}
          >
            <a href={`#${heading.id}`}>{heading.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
