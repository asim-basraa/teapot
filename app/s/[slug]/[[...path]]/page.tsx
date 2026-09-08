import { notFound } from "next/navigation";
import { renderMarkdown } from "@teapot/renderer";
import {
  getSpaceBySlug,
  getNodeByPath,
  buildSpaceContext,
  INDEX_PATH,
} from "@/lib/spaces";
import "katex/dist/katex.min.css";

export const dynamic = "force-dynamic";

type Params = { slug: string; path?: string[] };

export default async function NodePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug, path } = await params;
  const nodePath = path?.length ? path.join("/") : INDEX_PATH;

  // Every not-found below is a real 404, including the case where the node
  // exists but this viewer cannot read it. RLS has already removed those rows,
  // so we cannot tell the difference here either, which is the design: a 403
  // would confirm that restricted content exists at this address.
  const space = await getSpaceBySlug(slug);
  if (!space) notFound();

  const node = await getNodeByPath(space.id, nodePath);
  if (!node) notFound();

  // A folder has no content of its own. Rather than 404, show it as an empty
  // section so the sidebar selection still makes sense.
  if (node.kind === "folder") {
    return (
      <article className="prose">
        <h1>{node.name}</h1>
        <p className="empty">This folder has no page of its own.</p>
      </article>
    );
  }

  const ctx = await buildSpaceContext(space.id, space.slug);
  const { html } = await renderMarkdown(node.content ?? "", ctx);

  return (
    <article
      className="prose"
      // Safe: renderMarkdown sanitizes author HTML before KaTeX and Shiki
      // add their own trusted markup. See packages/renderer/src/sanitize.ts.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
