"use client";

import { useEffect, useRef } from "react";
import type { TreeNode } from "@/lib/nodes";

/**
 * Where to move something, for people not using a mouse.
 *
 * Dragging is the fast way and it is the only way for nobody: it cannot be done
 * from a keyboard, it is miserable on a touchscreen, and a deep tree makes it
 * fiddly even with a mouse. So every move is available here too, and both paths
 * call the same endpoint.
 *
 * The list is the destinations that are actually legal: folders only, since a
 * page holds nothing, and never the moving node or anything inside it, because a
 * folder cannot become its own ancestor. The database refuses those as well —
 * this is so the choice is never offered, not so the rule is enforced here.
 */
export function MoveDialog({
  node,
  tree,
  onMove,
  onClose,
}: {
  node: TreeNode;
  tree: TreeNode[];
  onMove: (node: TreeNode, parentId: string | null) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  const destinations = folders(tree, node.id);
  const alreadyAtTop = node.parent_id === null;

  return (
    <dialog
      className="share-dialog move-dialog"
      ref={dialog}
      aria-label={`Move ${node.name}`}
      onClose={onClose}
    >
      <div className="share-head">
        <h2>Move {node.name}</h2>
        <button
          className="btn btn-secondary btn-small"
          type="button"
          onClick={() => dialog.current?.close()}
        >
          Close
        </button>
      </div>

      <p className="hint">
        Everything inside it goes too, and its address changes to match.
      </p>

      <ul className="move-list">
        <li>
          <button
            type="button"
            onClick={() => onMove(node, null)}
            disabled={alreadyAtTop}
          >
            The top level
            {alreadyAtTop ? <span className="move-here"> · already here</span> : null}
          </button>
        </li>

        {destinations.map((folder) => {
          const here = node.parent_id === folder.id;
          return (
            <li key={folder.id}>
              <button
                type="button"
                onClick={() => onMove(node, folder.id)}
                disabled={here}
              >
                {folder.path}
                {here ? <span className="move-here"> · already here</span> : null}
              </button>
            </li>
          );
        })}
      </ul>

      {destinations.length === 0 && alreadyAtTop ? (
        <p className="tree-empty">
          There is nowhere else to put it yet. Make a folder first.
        </p>
      ) : null}
    </dialog>
  );
}

/** Every folder in the tree except the one moving and its descendants. */
function folders(nodes: TreeNode[], excludeId: string): TreeNode[] {
  const out: TreeNode[] = [];

  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.id === excludeId) continue; // and, with it, everything beneath it
      if (n.kind === "folder") out.push(n);
      walk(n.children);
    }
  };

  walk(nodes);
  return out;
}
