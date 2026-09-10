import Link from "next/link";
import { notFound } from "next/navigation";
import { renderMarkdown } from "@postit/renderer";
import { nodeCapabilities, listChildren } from "@/lib/nodes";
import { listBacklinks } from "@/lib/links";
import { listComments } from "@/lib/comments";
import { currentUser } from "@/lib/supabase/server";
import { Share } from "../Share";
import { Mermaid } from "../Mermaid";
import { Comments } from "../Comments";
import { History } from "../History";
import { NewChild } from "../NewChild";
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

  // Asked of the predicates, not inferred from ownership, so a grantee with
  // editor or admin gets the matching affordances. Presentation only: the
  // database refuses the write regardless of what is rendered.
  const { canEdit, canAdmin } = await nodeCapabilities(node.id);
  const viewHref = `/s/${space.slug}/${node.path}`;

  // History is offered to anyone who can read the page, not only to editors.
  // "What did this say last week" is a reader's question at least as often as
  // a writer's, and the revisions are already exactly as readable as the page.
  const actions =
    node.kind === "file" || canEdit || canAdmin ? (
      <div className="page-actions">
        {node.kind === "file" ? (
          <History
            nodeId={node.id}
            nodeName={node.name}
            canEdit={canEdit}
            currentContent={node.content ?? ""}
          />
        ) : null}
        {canAdmin ? (
          <Share nodeId={node.id} nodeName={node.name} spaceId={space.id} />
        ) : null}
        {canEdit ? (
          <Link
            className="btn btn-secondary btn-small"
            href={`${viewHref}?edit=1`}
          >
            Edit
          </Link>
        ) : null}
      </div>
    ) : null;

  if (node.kind === "folder") {
    // A folder is somewhere you can stand now that the tree links to one, so
    // it shows what is in it. Only what this viewer can read reaches here: RLS
    // removed the rest before we saw the list.
    const children = await listChildren(node.id);

    return (
      <>
        {actions}
        <article className="prose">
          <h1>{node.name}</h1>

          {canEdit ? (
            <NewChild
              spaceId={space.id}
              spaceSlug={space.slug}
              parentId={node.id}
            />
          ) : null}

          {children.length === 0 ? (
            <p className="empty">This folder is empty.</p>
          ) : (
            <ul className="folder-contents">
              {children.map((child) => (
                <li key={child.id}>
                  <Link href={`/s/${space.slug}/${child.path}`}>
                    {child.name}
                  </Link>
                  {child.kind === "folder" ? (
                    <span className="tree-badge">folder</span>
                  ) : child.content_type === "skill" ? (
                    <span className="tree-badge">skill</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </article>
      </>
    );
  }

  if (edit && canEdit) {
    return (
      <Editor
        nodeId={node.id}
        nodeName={node.name}
        initialContent={node.content ?? ""}
        initialVersion={node.content_version}
        initialContentType={node.content_type ?? "article"}
        viewHref={viewHref}
      />
    );
  }

  const ctx = await buildSpaceContext(space.id, space.slug);
  const { html } = await renderMarkdown(node.content ?? "", ctx);
  const backlinks = await listBacklinks(space.slug, node.id);

  // Comments require an account, even on a published page. An anonymous
  // visitor gets the document and no conversation.
  const user = await currentUser();
  const comments = user ? await listComments(node.id) : [];

  return (
    <>
      {actions}

      <article
        className="prose"
        // Safe: renderMarkdown sanitizes author HTML before KaTeX and Shiki
        // add their own trusted markup. See packages/renderer/src/sanitize.ts.
        // The title is prepended here rather than written into the document,
        // so renaming a page renames what the page calls itself. It is escaped
        // because a node name is not Markdown and has not been through the
        // sanitizer.
        dangerouslySetInnerHTML={{
          __html: `<h1>${escapeHtml(node.name)}</h1>` + html,
        }}
      />

      {/* Hydrates any ```mermaid blocks the document contains. Renders
          nothing itself, and loads mermaid only if a diagram is present. */}
      <Mermaid />

      {backlinks.length > 0 ? (
        // Only what this viewer can read reaches here: the policy on `links`
        // requires both ends to be readable, so the panel cannot become the
        // place that admits a restricted page exists. It is therefore absent
        // rather than empty when nothing readable links here, which is the
        // same thing a page with no backlinks at all shows.
        <nav className="backlinks" aria-label="Pages that link here">
          <h2>Linked from</h2>
          <ul>
            {backlinks.map((link) => (
              <li key={link.id}>
                <Link href={link.href}>{link.name}</Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {user ? (
        <Comments
          nodeId={node.id}
          viewerId={user.id}
          canModerate={canAdmin}
          initialComments={comments}
        />
      ) : null}
    </>
  );
}

/** A node name is plain text; this is what makes it safe to place in markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
