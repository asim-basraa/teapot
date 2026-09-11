"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import type { TreeNode } from "@/lib/nodes";
import { ShareDialog } from "./Share";
import { Pending } from "@/components/NavLink";

type Props = {
  spaceSlug: string;
  spaceId: string;
  tree: TreeNode[];
  canEdit: boolean;
  /**
   * Whether to offer sharing here. Separate from canEdit because they are
   * different powers: an editor writes, an administrator decides who else can.
   */
  canShare: boolean;
};

type ApiResult = { error: string | null; node?: { path: string } };

async function api(url: string, init: RequestInit): Promise<ApiResult> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });

  if (res.status === 204) return { error: null };

  const body = await res.json().catch(() => ({}));
  if (res.ok) return { error: null, node: body.node };
  return { error: body.error ?? `Request failed (${res.status})` };
}

export function Tree({ spaceSlug, spaceId, tree, canEdit, canShare }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // One dialog for the whole tree rather than one per row: a sidebar with a
  // hundred pages should not mount a hundred dialogs to show none of them.
  const [sharing, setSharing] = useState<TreeNode | null>(null);

  const base = `/s/${spaceSlug}`;

  /** True when the page being viewed is `path` itself or lives under it. */
  const viewing = (path: string) =>
    pathname === `${base}/${path}` || pathname.startsWith(`${base}/${path}/`);

  // The server owns the tree; after any mutation we re-fetch rather than
  // patching local state, so what is shown always matches what RLS allows.
  const refresh = () => startTransition(() => router.refresh());

  /**
   * Navigates somewhere that still exists after a mutation.
   *
   * Refreshing is only correct while the current URL survives. Renaming or
   * deleting the folder you are reading inside destroys the path you are on,
   * and refreshing it would reload a 404 behind a stale sidebar. So a move
   * carries the reader to the node's new path, and a delete falls back to the
   * space root.
   */
  function settle(oldPath: string, newPath: string | null) {
    if (!viewing(oldPath)) {
      refresh();
      return;
    }

    const destination =
      newPath === null
        ? base
        : `${base}/${newPath}${pathname.slice(`${base}/${oldPath}`.length)}`;

    startTransition(() => {
      router.replace(destination);
      router.refresh();
    });
  }

  async function run(work: Promise<ApiResult>, onDone?: (r: ApiResult) => void) {
    const result = await work;
    setError(result.error);
    if (result.error) return;
    if (onDone) onDone(result);
    else refresh();
  }

  const create = (
    parentId: string | null,
    kind: "folder" | "file",
    contentType?: "article" | "skill",
  ) => {
    const name = window.prompt(
      kind === "folder"
        ? "Folder name"
        : contentType === "skill"
          ? "Skill name"
          : "Page name",
    )?.trim();
    if (!name) return;
    void run(
      api("/api/v1/nodes", {
        method: "POST",
        body: JSON.stringify({
          space_id: spaceId,
          parent_id: parentId,
          kind,
          name,
          content_type: contentType,
        }),
      }),
    );
  };

  const rename = (node: TreeNode) => {
    const name = window.prompt("New name", node.name)?.trim();
    if (!name || name === node.name) return;
    const oldPath = node.path;
    void run(
      api(`/api/v1/nodes/${node.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
      (result) => settle(oldPath, result.node?.path ?? null),
    );
  };

  const remove = (node: TreeNode) => {
    const warning =
      node.kind === "folder"
        ? `Delete "${node.name}" and everything inside it?`
        : `Delete "${node.name}"?`;
    if (!window.confirm(warning)) return;
    const oldPath = node.path;
    void run(api(`/api/v1/nodes/${node.id}`, { method: "DELETE" }), () =>
      settle(oldPath, null),
    );
  };

  return (
    <nav className="tree" aria-label="Files">
      <div className="tree-header">
        <span>Files</span>
        {canEdit ? (
          <span className="tree-actions">
            <button
              type="button"
              onClick={() => create(null, "folder")}
              aria-label="New folder at the top level"
            >
              + Folder
            </button>
            <button
              type="button"
              onClick={() => create(null, "file")}
              aria-label="New page at the top level"
            >
              + Page
            </button>
            <button
              type="button"
              onClick={() => create(null, "file", "skill")}
              aria-label="New skill at the top level"
            >
              + Skill
            </button>
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="msg msg-error tree-error" role="alert">
          {error}
        </p>
      ) : null}

      {tree.length === 0 ? (
        <p className="tree-empty">Nothing here yet.</p>
      ) : (
        <TreeLevel
          nodes={tree}
          spaceSlug={spaceSlug}
          pathname={pathname}
          canEdit={canEdit}
          canShare={canShare}
          depth={0}
          onRename={rename}
          onDelete={remove}
          onShare={setSharing}
        />
      )}

      {pending ? <p className="tree-pending">Updating…</p> : null}

      {sharing ? (
        <ShareDialog
          nodeId={sharing.id}
          nodeName={sharing.name}
          spaceId={spaceId}
          onClose={() => setSharing(null)}
        />
      ) : null}
    </nav>
  );
}

function TreeLevel({
  nodes,
  spaceSlug,
  pathname,
  canEdit,
  canShare,
  depth,
  onRename,
  onDelete,
  onShare,
}: {
  nodes: TreeNode[];
  spaceSlug: string;
  pathname: string;
  canEdit: boolean;
  canShare: boolean;
  depth: number;
  onRename: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
  onShare: (node: TreeNode) => void;
}) {
  return (
    <ul
      className="tree-level"
      style={{ paddingLeft: depth === 0 ? 0 : "0.8rem" }}
    >
      {nodes.map((node) => {
        const href = `/s/${spaceSlug}/${node.path}`;
        const current = pathname === href;

        return (
          <li key={node.id} className={`tree-item tree-${node.kind}`}>
            <div className="tree-row">
              {/* A folder is a link like anything else. It was a bare label,
                  which meant a folder was the one thing in the tree you could
                  not open, and therefore the one thing you could not share:
                  the sharing controls live on the page you are looking at. */}
              <Link
                href={href}
                className={
                  node.kind === "folder"
                    ? "tree-name tree-folder-name"
                    : "tree-name"
                }
                aria-current={current ? "page" : undefined}
              >
                {node.name}
                {node.content_type === "skill" ? (
                  // A badge rather than an icon: a skill and an article are
                  // both Markdown, and the difference is worth spelling out
                  // where somebody is choosing between them.
                  <span className="tree-badge">skill</span>
                ) : null}
                <Pending />
              </Link>

              {/* Three at most. Creating things inside a folder used to be
                  here too, which put five buttons on a folder row and left
                  the name — the only part anybody reads — with no room. It
                  lives on the folder's own page now, which is somewhere you
                  can stand and see what is already in it. */}
              {canShare || canEdit ? (
                <span className="tree-actions">
                  {canShare ? (
                    <button
                      type="button"
                      onClick={() => onShare(node)}
                      aria-label={`Share ${node.name}`}
                    >
                      Share
                    </button>
                  ) : null}
                  {canEdit ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onRename(node)}
                        aria-label={`Rename ${node.name}`}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(node)}
                        aria-label={`Delete ${node.name}`}
                      >
                        Delete
                      </button>
                    </>
                  ) : null}
                </span>
              ) : null}
            </div>

            {node.children.length > 0 ? (
              <TreeLevel
                nodes={node.children}
                spaceSlug={spaceSlug}
                pathname={pathname}
                canEdit={canEdit}
                canShare={canShare}
                depth={depth + 1}
                onRename={onRename}
                onDelete={onDelete}
                onShare={onShare}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
