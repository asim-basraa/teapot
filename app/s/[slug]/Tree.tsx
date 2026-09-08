"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import type { TreeNode } from "@/lib/nodes";

type Props = {
  spaceSlug: string;
  spaceId: string;
  tree: TreeNode[];
  canEdit: boolean;
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

export function Tree({ spaceSlug, spaceId, tree, canEdit }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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

  const create = (parentId: string | null, kind: "folder" | "file") => {
    const name = window.prompt(
      kind === "folder" ? "Folder name" : "Page name",
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
          depth={0}
          onCreate={create}
          onRename={rename}
          onDelete={remove}
        />
      )}

      {pending ? <p className="tree-pending">Updating…</p> : null}
    </nav>
  );
}

function TreeLevel({
  nodes,
  spaceSlug,
  pathname,
  canEdit,
  depth,
  onCreate,
  onRename,
  onDelete,
}: {
  nodes: TreeNode[];
  spaceSlug: string;
  pathname: string;
  canEdit: boolean;
  depth: number;
  onCreate: (parentId: string | null, kind: "folder" | "file") => void;
  onRename: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
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
              {node.kind === "folder" ? (
                <span className="tree-name tree-folder-name">{node.name}</span>
              ) : (
                <Link
                  href={href}
                  className="tree-name"
                  aria-current={current ? "page" : undefined}
                >
                  {node.name}
                </Link>
              )}

              {canEdit ? (
                <span className="tree-actions">
                  {node.kind === "folder" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onCreate(node.id, "folder")}
                        aria-label={`New folder in ${node.name}`}
                      >
                        +F
                      </button>
                      <button
                        type="button"
                        onClick={() => onCreate(node.id, "file")}
                        aria-label={`New page in ${node.name}`}
                      >
                        +P
                      </button>
                    </>
                  ) : null}
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
                </span>
              ) : null}
            </div>

            {node.children.length > 0 ? (
              <TreeLevel
                nodes={node.children}
                spaceSlug={spaceSlug}
                pathname={pathname}
                canEdit={canEdit}
                depth={depth + 1}
                onCreate={onCreate}
                onRename={onRename}
                onDelete={onDelete}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
