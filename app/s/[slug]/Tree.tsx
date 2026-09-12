"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import type { TreeNode, NodeRights } from "@/lib/nodes";
import { ShareDialog } from "./Share";
import { MoveDialog } from "./Move";
import { AskDialog, ConfirmDialog } from "@/components/Ask";
import { Pending } from "@/components/NavLink";
import { RowActions } from "./RowActions";

type Props = {
  spaceSlug: string;
  spaceId: string;
  tree: TreeNode[];
  /**
   * What the reader may do to each node, by id. Per item rather than per space,
   * because that is how the policies decide it: writing, deciding who else may
   * read, and throwing away are three different powers and somebody can hold
   * any one of them on one page and none on the next.
   */
  rights: Map<string, NodeRights>;
  /** Whether to offer starting something at the top of the space. */
  canStart: boolean;
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

export function Tree({ spaceSlug, spaceId, tree, rights, canStart }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<TreeNode | null>(null);
  /**
   * Whatever the tree is currently asking about, or null.
   *
   * One piece of state rather than three booleans: only one of these dialogs
   * can be open at a time, and a shape that cannot represent two of them open
   * together is a shape that cannot get into that state.
   */
  const [asking, setAsking] = useState<
    | { kind: "create"; nodeKind: "folder" | "file"; contentType?: "article" | "skill"; parentId: string | null }
    | { kind: "rename"; node: TreeNode }
    | { kind: "delete"; node: TreeNode }
    | { kind: "evict"; node: TreeNode }
    | null
  >(null);
  const [dragging, setDragging] = useState<TreeNode | null>(null);
  /** The id being hovered, or "" for the top level. Null when nothing is. */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
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

  /**
   * Sends somebody else's work back to their own space.
   *
   * Offered only where the database already says it is possible, which is work
   * that is not yours, in a space that is.
   */
  const evict = (node: TreeNode) => {
    setAsking(null);
    void run(
      api(`/api/v1/nodes/${node.id}/evict`, { method: "POST" }),
      () => settle(node.path, null),
    );
  };

  const create = (name: string) => {
    if (asking?.kind !== "create") return;
    const { parentId, nodeKind, contentType } = asking;
    setAsking(null);
    void run(
      api("/api/v1/nodes", {
        method: "POST",
        body: JSON.stringify({
          space_id: spaceId,
          parent_id: parentId,
          kind: nodeKind,
          name,
          content_type: contentType,
        }),
      }),
    );
  };

  /**
   * Moves a node under a new parent, or to the top level with null.
   *
   * The whole thing was already here except the way to ask for it: the endpoint,
   * the database function that rewrites every descendant's path, and the refusal
   * to make a folder its own ancestor. The tree offered Rename and Delete and no
   * way to move anything, while this file's own settle() had a comment about
   * carrying the reader to a moved node's new path. QA found it before anybody
   * else did.
   */
  const move = (node: TreeNode, parentId: string | null) => {
    setMoving(null);
    if (node.parent_id === parentId) return;

    const oldPath = node.path;
    void run(
      api(`/api/v1/nodes/${node.id}`, {
        method: "PATCH",
        body: JSON.stringify({ parent_id: parentId }),
      }),
      (result) => settle(oldPath, result.node?.path ?? null),
    );
  };

  /**
   * Whether a node may be dropped on a destination.
   *
   * Only folders hold things, nothing is dropped on itself or on the parent it
   * already has, and a folder may not be dropped inside itself — the last one is
   * the only interesting case, and the database refuses it too.
   */
  const may = (node: TreeNode) =>
    rights.get(node.id) ?? {
      may_edit: false,
      may_delete: false,
      may_share: false,
      may_evict: false,
    };

  const canDrop = (node: TreeNode, target: TreeNode | null) => {
    // Moving is a write on the thing moved and on where it lands. The top
    // level is not a node, so the space's own permission stands in for it.
    if (!may(node).may_edit) return false;
    if (target === null) return canStart && node.parent_id !== null;
    if (!may(target).may_edit) return false;
    if (target.kind !== "folder") return false;
    if (target.id === node.id) return false;
    if (target.id === node.parent_id) return false;
    return !contains(node, target.id);
  };

  const drop = (target: TreeNode | null) => {
    const node = dragging;
    setDragging(null);
    setDropTarget(null);
    if (node && canDrop(node, target)) move(node, target?.id ?? null);
  };

  const rename = (node: TreeNode, name: string) => {
    setAsking(null);
    if (name === node.name) return;
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
    setAsking(null);
    const oldPath = node.path;
    void run(api(`/api/v1/nodes/${node.id}`, { method: "DELETE" }), () =>
      settle(oldPath, null),
    );
  };

  return (
    <nav className="tree" aria-label="Files">
      <div
        className={
          dropTarget === "" ? "tree-header is-drop-target" : "tree-header"
        }
        onDragOver={(e) => {
          if (!dragging || !canDrop(dragging, null)) return;
          e.preventDefault();
          setDropTarget("");
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => {
          e.preventDefault();
          drop(null);
        }}
      >
        {/* The header doubles as the way out of a folder: with nothing else at
            the top level there would be nothing to drop onto. */}
        <span>{dropTarget === "" ? "Move to the top level" : "Files"}</span>
        {canStart ? (
          <span className="tree-actions">
            <button
              type="button"
              onClick={() =>
                setAsking({ kind: "create", nodeKind: "folder", parentId: null })
              }
              aria-label="New folder at the top level"
            >
              + Folder
            </button>
            <button
              type="button"
              onClick={() =>
                setAsking({ kind: "create", nodeKind: "file", parentId: null })
              }
              aria-label="New page at the top level"
            >
              + Page
            </button>
            <button
              type="button"
              onClick={() =>
                setAsking({ kind: "create", nodeKind: "file", contentType: "skill", parentId: null })
              }
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
          rights={rights}
          depth={0}
          onRename={(node) => setAsking({ kind: "rename", node })}
          onDelete={(node) => setAsking({ kind: "delete", node })}
          onEvict={(node) => setAsking({ kind: "evict", node })}
          onShare={setSharing}
          onMoveRequest={setMoving}
          dragging={dragging}
          dropTarget={dropTarget}
          canDrop={canDrop}
          onDragStart={setDragging}
          onDragEnd={() => {
            setDragging(null);
            setDropTarget(null);
          }}
          onDragEnterNode={setDropTarget}
          onDropNode={drop}
        />
      )}

      {pending ? <p className="tree-pending">Updating…</p> : null}

      {asking?.kind === "create" ? (
        <AskDialog
          title={
            asking.nodeKind === "folder"
              ? "New folder"
              : asking.contentType === "skill"
                ? "New skill"
                : "New page"
          }
          label="Name"
          submitLabel="Create"
          hint={
            asking.contentType === "skill"
              ? "A skill is a page Claude reads to learn how you want a job done."
              : undefined
          }
          onSubmit={create}
          onClose={() => setAsking(null)}
        />
      ) : null}

      {asking?.kind === "rename" ? (
        <AskDialog
          title={`Rename ${asking.node.name}`}
          label="New name"
          value={asking.node.name}
          hint="The address changes to match, so existing links to it will break."
          onSubmit={(name) => rename(asking.node, name)}
          onClose={() => setAsking(null)}
        />
      ) : null}

      {asking?.kind === "delete" ? (
        <ConfirmDialog
          title={`Delete ${asking.node.name}?`}
          body={
            asking.node.kind === "folder"
              ? `Everything inside "${asking.node.name}" goes with it, and none of it can be brought back.`
              : `"${asking.node.name}" and its whole history go, and cannot be brought back.`
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(asking.node)}
          onClose={() => setAsking(null)}
        />
      ) : null}

      {asking?.kind === "evict" ? (
        <ConfirmDialog
          title={`Remove ${asking.node.name} from this space?`}
          /* Said in full because the word "remove" reads like deleting, and
             this is the opposite: the work survives and goes home. What is
             lost is this space's reach, which is the thing being chosen. */
          body={
            asking.node.kind === "folder"
              ? `It goes back to its author's own space, with everything inside it. Nothing is deleted, and they keep it. What changes is that nobody reaches it through this space any more.`
              : `It goes back to its author's own space. Nothing is deleted, and they keep it. What changes is that nobody reaches it through this space any more.`
          }
          confirmLabel="Remove from space"
          onConfirm={() => evict(asking.node)}
          onClose={() => setAsking(null)}
        />
      ) : null}

      {moving ? (
        <MoveDialog
          node={moving}
          tree={tree}
          onMove={move}
          onClose={() => setMoving(null)}
        />
      ) : null}

      {sharing ? (
        <ShareDialog
          nodeId={sharing.id}
          nodeName={sharing.name}
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
  rights,
  depth,
  onRename,
  onDelete,
  onEvict,
  onShare,
  onMoveRequest,
  dragging,
  dropTarget,
  canDrop,
  onDragStart,
  onDragEnd,
  onDragEnterNode,
  onDropNode,
}: {
  nodes: TreeNode[];
  spaceSlug: string;
  pathname: string;
  rights: Map<string, NodeRights>;
  depth: number;
  onRename: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
  onEvict: (node: TreeNode) => void;
  onShare: (node: TreeNode) => void;
  onMoveRequest: (node: TreeNode) => void;
  dragging: TreeNode | null;
  dropTarget: string | null;
  canDrop: (node: TreeNode, target: TreeNode | null) => boolean;
  onDragStart: (node: TreeNode) => void;
  onDragEnd: () => void;
  onDragEnterNode: (id: string) => void;
  onDropNode: (target: TreeNode) => void;
}) {
  return (
    <ul
      className="tree-level"
      style={{ paddingLeft: depth === 0 ? 0 : "0.8rem" }}
    >
      {nodes.map((node) => {
        const href = `/s/${spaceSlug}/${node.path}`;
        const current = pathname === href;

        const receiving = dropTarget === node.id && dragging !== null;
        const lifted = dragging?.id === node.id;
        const may = rights.get(node.id) ?? {
          may_edit: false,
          may_delete: false,
          may_share: false,
          may_evict: false,
        };

        return (
          <li key={node.id} className={`tree-item tree-${node.kind}`}>
            <div
              className={
                "tree-row" +
                (receiving ? " is-drop-target" : "") +
                (lifted ? " is-dragging" : "") +
                (may.may_edit ? " is-draggable" : "")
              }
              draggable={may.may_edit}
              onDragStart={(e) => {
                // Carried so a drop outside the tree does something sensible
                // rather than nothing: the state below is what this tree reads.
                e.dataTransfer.setData("text/plain", node.name);
                e.dataTransfer.effectAllowed = "move";
                onDragStart(node);
              }}
              onDragEnd={onDragEnd}
              onDragOver={(e) => {
                if (!dragging || !canDrop(dragging, node)) return;
                // preventDefault is what makes this a drop target at all, so
                // refusing it is how an illegal destination declines the drop.
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                onDragEnterNode(node.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDropNode(node);
              }}
            >
              {/* A folder is a link like anything else. It was a bare label,
                  which meant a folder was the one thing in the tree you could
                  not open, and therefore the one thing you could not share:
                  the sharing controls live on the page you are looking at. */}
              <Link
                href={href}
                // Otherwise the browser drags the URL and the row never gets a
                // chance: a link is draggable by default.
                draggable={false}
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

              {/* Sharing on its own, the rest behind the dots. Four labelled
                  buttons used to sit here and they took more of the row than
                  the name did, which is the one part anybody reads. */}
              <RowActions
                node={node}
                canEdit={may.may_edit}
                canDelete={may.may_delete}
                canShare={may.may_share}
                canEvict={may.may_evict}
                onShare={onShare}
                onRename={onRename}
                onMove={onMoveRequest}
                onDelete={onDelete}
                onEvict={onEvict}
              />
            </div>

            {node.children.length > 0 ? (
              <TreeLevel
                nodes={node.children}
                spaceSlug={spaceSlug}
                pathname={pathname}
                rights={rights}
                depth={depth + 1}
                onRename={onRename}
                onDelete={onDelete}
                onEvict={onEvict}
                onShare={onShare}
                onMoveRequest={onMoveRequest}
                dragging={dragging}
                dropTarget={dropTarget}
                canDrop={canDrop}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragEnterNode={onDragEnterNode}
                onDropNode={onDropNode}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Whether `id` is anywhere beneath `node`. Stops a folder becoming its own parent. */
function contains(node: TreeNode, id: string): boolean {
  return node.children.some((child) => child.id === id || contains(child, id));
}
