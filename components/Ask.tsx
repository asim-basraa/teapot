"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The two dialogs that replace window.prompt and window.confirm.
 *
 * The native ones were quick to write and wrong in every other way: they are
 * styled by the browser rather than the product, they cannot say which thing
 * they are about beyond one line of plain text, they cannot mark a destructive
 * action as destructive, some browsers offer to suppress them after the second
 * one, and on a phone they arrive as an operating-system panel that looks like
 * it came from somewhere else entirely.
 *
 * Both are built on <dialog> and showModal, like the sharing and move dialogs
 * already here, so focus is trapped, Escape closes, and the page behind is
 * inert without any of that being hand-rolled.
 */

export function AskDialog({
  title,
  label,
  value = "",
  hint,
  submitLabel = "Save",
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  value?: string;
  hint?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    dialog.current?.close();
  }

  return (
    <dialog
      className="share-dialog ask-dialog"
      ref={dialog}
      aria-label={title}
      onClose={onClose}
    >
      <div className="share-head">
        <h2>{title}</h2>
        <button
          className="btn btn-secondary btn-small"
          type="button"
          onClick={() => dialog.current?.close()}
        >
          Close
        </button>
      </div>

      <form onSubmit={submit}>
        <label className="field">
          <span className="field-label">{label}</span>
          <input
            id="ask-value"
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            /* Selected rather than merely focused, because the common case is
               replacing the old name rather than editing one character of it. */
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            required
          />
        </label>

        {hint ? <p className="hint">{hint}</p> : null}

        <div className="dialog-actions">
          <button className="btn" type="submit" disabled={!draft.trim()}>
            {submitLabel}
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  /** Marks the action as one that destroys something, and styles it as such. */
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  return (
    <dialog
      className="share-dialog ask-dialog"
      ref={dialog}
      aria-label={title}
      onClose={onClose}
    >
      <div className="share-head">
        <h2>{title}</h2>
        <button
          className="btn btn-secondary btn-small"
          type="button"
          onClick={() => dialog.current?.close()}
        >
          Close
        </button>
      </div>

      <p className="confirm-body">{body}</p>

      <div className="dialog-actions">
        {/* Cancel first, and focused, so the safe answer is the one a return
            key reaches. The native confirm() put OK there. */}
        <button
          className="btn btn-secondary"
          type="button"
          autoFocus
          onClick={() => dialog.current?.close()}
        >
          Cancel
        </button>
        <button
          className={danger ? "btn btn-danger" : "btn"}
          type="button"
          onClick={() => {
            onConfirm();
            dialog.current?.close();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
