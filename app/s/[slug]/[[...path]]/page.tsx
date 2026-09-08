import Link from "next/link";
import { notFound } from "next/navigation";
import { renderMarkdown } from "@teapot/renderer";
import { createClient } from "@/lib/supabase/server";
import {
  getSpaceBySlug,
  getNodeByPath,
  buildSpaceContext,
  INDEX_PATH,
} from "@/lib/spaces";
import { Editor } from "../Editor";
import "katex/dist/katex.min.css";

export const dynamic = "force-dynamic";

type Params = { slug: string; path?: string[] };
type Search = { edit?: string };

export default async function NodePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { slug, path } = await params;
  const { edit } = await searchParams;
  const nodePath = path?.length ? path.join("/") : INDEX_PATH;

  // Every not-found below is a real 404, including the case where the node
  // exists but this viewer cannot read it. RLS has already removed those rows,
  // so we cannot tell the difference here either, which is the design: a 403
  // would confirm that restricted content exists at this address.
  const space = await getSpaceBySlug(slug);
  if (!space) notFound();

  const node = await getNodeByPath(space.id, nodePath);
  if (!node) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Owner-only until Slice 4 introduces grants. The editor being hidden is
  // presentation; the database refuses the write either way.
  const canEdit = !!user && space.owner_id === user.id;
  const viewHref = `/s/${space.slug}/${node.path}`;

  if (node.kind === "folder") {
    return (
      <article className="prose">
        <h1>{node.name}</h1>
        <p className="empty">This folder has no page of its own.</p>
      </article>
    );
  }

  if (edit && canEdit) {
    return (
      <Editor
        nodeId={node.id}
        nodeName={node.name}
        initialContent={node.content ?? ""}
        initialVersion={node.content_version}
        viewHref={viewHref}
      />
    );
  }

  const ctx = await buildSpaceContext(space.id, space.slug);
  const { html } = await renderMarkdown(node.content ?? "", ctx);

  return (
    <>
      {canEdit ? (
        <div className="page-actions">
          <Link className="btn btn-secondary btn-small" href={`${viewHref}?edit=1`}>
            Edit
          </Link>
        </div>
      ) : null}

      <article
        className="prose"
        // Safe: renderMarkdown sanitizes author HTML before KaTeX and Shiki
        // add their own trusted markup. See packages/renderer/src/sanitize.ts.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
