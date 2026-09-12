"use client";

import { useRef } from "react";
import type { TreeNode } from "@/lib/nodes";

/**
 * The controls on a tree row: sharing, and everything else behind a menu.
 *
 * Four labelled buttons used to sit here, and on a narrow sidebar they took
 * more room than the name did. The name is the part anybody reads; the buttons
 * are the part somebody occasionally wants. So sharing keeps its own button,
 * because it is the one reached for often enough to be worth a click, and
 * renaming, moving and deleting go behind the three dots.
 *
 * Built on the popover API rather than a div and a click-away listener. That
 * hands the browser four things worth not writing again: it closes on Escape,
 * it closes when you click elsewhere, opening one menu closes any other, and it
 * renders in the top layer. The last of those is not a nicety — the sidebar
 * scrolls, so an absolutely positioned menu would be clipped by it, and the
 * options at the bottom of a long tree would be the ones you could not reach.
 *
 * The top layer costs the positioning, which no longer comes from the document
 * flow, so it is measured off the button each time the menu opens.
 */
export function RowActions({
  node,
  canEdit,
  canShare,
  onShare,
  onRename,
  onMove,
  onDelete,
}: {
  node: TreeNode;
  canEdit: boolean;
  canShare: boolean;
  onShare: (node: TreeNode) => void;
  onRename: (node: TreeNode) => void;
  onMove: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  if (!canShare && !canEdit) return null;

  const menuId = `row-menu-${node.id}`;

  /**
   * Puts the menu under its button, or above it when there is no room below.
   *
   * Measured on open rather than tracked, because the menu closes on scroll
   * elsewhere anyway and a stale position for something already dismissed is
   * not worth a listener.
   */
  function place() {
    const el = menu.current;
    const from = trigger.current;
    if (!el || !from) return;

    const anchor = from.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const gap = 4;

    const below = anchor.bottom + gap;
    const fitsBelow = below + box.height <= window.innerHeight - 8;

    el.style.top = `${fitsBelow ? below : Math.max(8, anchor.top - gap - box.height)}px`;
    // Right-aligned to the button, then pulled back inside the viewport, which
    // is what a narrow phone needs and a wide screen never notices.
    el.style.left = `${Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8))}px`;
  }

  function choose(action: (node: TreeNode) => void) {
    menu.current?.hidePopover();
    action(node);
  }

  return (
    <span className="tree-actions">
      {canShare ? (
        <button
          type="button"
          className="tree-icon-btn"
          onClick={() => onShare(node)}
          aria-label={`Share ${node.name}`}
          title="Share"
        >
          <ShareIcon />
        </button>
      ) : null}

      {canEdit ? (
        <>
          <button
            ref={trigger}
            type="button"
            className="tree-icon-btn"
            /* popoverTarget does the opening, the closing, the Escape key and
               the click-away, so there is no open state here to get wrong. */
            popoverTarget={menuId}
            aria-label={`More for ${node.name}`}
            title="More"
          >
            <MoreIcon />
          </button>

          <div
            ref={menu}
            id={menuId}
            popover="auto"
            className="row-menu"
            role="menu"
            aria-label={`Actions for ${node.name}`}
            onToggle={(event) => {
              if ((event as unknown as { newState: string }).newState === "open") {
                place();
              }
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onRename)}
              aria-label={`Rename ${node.name}`}
            >
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onMove)}
              aria-label={`Move ${node.name}`}
            >
              Move
            </button>
            <button
              type="button"
              role="menuitem"
              className="row-menu-danger"
              onClick={() => choose(onDelete)}
              aria-label={`Delete ${node.name}`}
            >
              Delete
            </button>
          </div>
        </>
      ) : null}
    </span>
  );
}

/* Decorative: every button carries its own label, so the glyph is not the
   thing being read. */

function ShareIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <circle cx="12" cy="3.2" r="2.1" />
      <circle cx="4" cy="8" r="2.1" />
      <circle cx="12" cy="12.8" r="2.1" />
      <path d="M10.2 4.3 5.8 6.9M5.8 9.1l4.4 2.6" strokeWidth="1.3" fill="none" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
    </svg>
  );
}
