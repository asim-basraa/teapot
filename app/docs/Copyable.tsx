"use client";

import { useState } from "react";

/**
 * A block of text with a button that copies it.
 *
 * The copy is the point of the docs page: a snippet somebody has to select by
 * hand is a snippet they get subtly wrong. Long ones start collapsed, so six
 * skill files do not bury the rest of the page.
 */
export function Copyable({
  label,
  text,
  collapsed = false,
}: {
  label: string;
  text: string;
  collapsed?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(!collapsed);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused, and a silent failure would leave
      // somebody believing they had copied something. Select it for them
      // instead, so the manual route is one keystroke rather than a drag.
      setOpen(true);
      const block = document.getElementById(blockId(label));
      if (block) {
        const range = document.createRange();
        range.selectNodeContents(block);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }

  return (
    <div className="copyable">
      <div className="copyable-bar">
        <span className="copyable-label">{label}</span>
        {collapsed ? (
          <button
            className="copyable-toggle"
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-controls={blockId(label)}
          >
            {open ? "Hide" : "Show"}
          </button>
        ) : null}
        <button
          className="btn btn-secondary btn-small"
          type="button"
          onClick={() => void copy()}
          aria-label={`Copy ${label}`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre id={blockId(label)} hidden={!open}>
        <code>{text}</code>
      </pre>
    </div>
  );
}

function blockId(label: string): string {
  return `copyable-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
