import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSpaceBySlug } from "@/lib/spaces";
import { listNodes, buildTree } from "@/lib/nodes";
import { signOut } from "../../(auth)/actions";
import { Tree } from "./Tree";

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const nodes = await listNodes(space.id);
  const tree = buildTree(nodes);

  // Editing affordances are hidden from people who cannot edit. This is
  // presentation only; the database refuses the write regardless.
  const canEdit = !!user && space.owner_id === user.id;

  return (
    <div className="space-shell">
      <header className="shell-header space-header">
        <Link href={user ? "/spaces" : "/"} className="shell-brand">
          Teapot
        </Link>
        <span className="space-title">{space.name}</span>
        {user ? (
          <form action={signOut}>
            <button className="btn btn-secondary btn-small" type="submit">
              Sign out
            </button>
          </form>
        ) : (
          <Link href="/login" className="btn btn-secondary btn-small">
            Sign in
          </Link>
        )}
      </header>

      <div className="space-body">
        <aside className="space-sidebar">
          <Tree
            spaceSlug={space.slug}
            spaceId={space.id}
            tree={tree}
            canEdit={canEdit}
          />
        </aside>
        <div className="space-content">{children}</div>
      </div>
    </div>
  );
}
