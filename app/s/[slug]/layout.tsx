import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { getSpaceBySlug, INDEX_PATH } from "@/lib/spaces";
import { listNodes, buildTree } from "@/lib/nodes";
import { Tree } from "./Tree";
import { Search } from "./Search";
import { SpaceName } from "./SpaceName";
import { AppHeader } from "@/components/AppHeader";

export const dynamic = "force-dynamic";

export default async function SpaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const space = await getSpaceBySlug(slug);
  // A space nobody can read is filtered out by RLS and looks exactly like a
  // space that does not exist, which is the intent.
  if (!space) notFound();

  const user = await currentUser();

  const nodes = await listNodes(space.id);

  // The space's front page is the space, not a file in it. Listing it among
  // the files put a page called "Marketing" inside a tree of folders as though
  // it were one of them, and offered to rename it, which changes its address
  // and takes /s/<slug> with it. It gets its own link instead.
  const home = nodes.find(
    (node) => node.parent_id === null && node.path === INDEX_PATH,
  );
  const tree = buildTree(nodes.filter((node) => node.id !== home?.id));

  // Editing affordances are hidden from people who cannot edit. This is
  // presentation only; the database refuses the write regardless.
  const canEdit = !!user && space.owner_id === user.id;

  return (
    // The space id is in the markup because the tree's client actions need it
    // to create nodes, and tests read it rather than guessing at a UUID.
    <div className="space-shell" data-space-id={space.id}>
      <AppHeader email={user?.email} className="space-header">
        <SpaceName spaceId={space.id} name={space.name} canRename={canEdit} />
        {canEdit ? (
          <Link
            href={`/spaces/${space.slug}/teams`}
            className="btn btn-secondary btn-small"
          >
            Teams
          </Link>
        ) : null}
      </AppHeader>

      <div className="space-body">
        <aside className="space-sidebar">
          <Search spaceId={space.id} />
          {home ? (
            <Link href={`/s/${space.slug}`} className="space-home">
              {home.name}
            </Link>
          ) : null}
          <Tree
            spaceSlug={space.slug}
            spaceId={space.id}
            tree={tree}
            canEdit={canEdit}
            canShare={canEdit}
          />
        </aside>
        <div className="space-content">{children}</div>
      </div>
    </div>
  );
}
