"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The credit, and a way to say something without having an account.
 *
 * The front page is the one screen a stranger reaches, so the box asks for
 * nothing: no name, no address, no sign-up. Anything it asks for is a reason
 * not to bother, and the point is to lower the cost of telling somebody a
 * thing to almost nothing.
 */
export function SiteFooter() {
  const [open, setOpen] = useState(false);

  return (
    <footer className="site-footer">
      <span>
        Built with love <span aria-label="love">❤️</span> by Asim
      </span>
      <span aria-hidden="true">·</span>
      <button type="button" className="linkish" onClick={() => setOpen(true)}>
        Tell me something
      </button>

      {open ? <Note onClose={() => setOpen(false)} /> : null}
    </footer>
  );
}

function Note({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/v1/inbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? "That did not send.");
      return;
    }

    setSent(true);
  }

  return (
    <dialog
      className="share-dialog note-dialog"
      ref={dialog}
      aria-label="Tell me something"
      onClose={onClose}
    >
      <div className="share-head">
        <h2>Tell me something</h2>
        <button
          className="btn btn-secondary btn-small"
          type="button"
          onClick={() => dialog.current?.close()}
        >
          Close
        </button>
      </div>

      {sent ? (
        <>
          <p className="msg msg-notice" role="status">
            Got it. Thank you.
          </p>
          <p className="hint">
            It went straight to a page only I can read.
          </p>
        </>
      ) : (
        <form onSubmit={send}>
          {error ? (
            <p className="msg msg-error" role="alert">
              {error}
            </p>
          ) : null}

          <label className="field">
            <span className="field-label">A joke, a thought, anything</span>
            <textarea
              className="input note-box"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              rows={5}
              placeholder="Two antennas got married. The wedding was terrible, the reception was excellent."
              required
            />
          </label>

          <p className="hint">
            No account, no address, nothing kept but the words. It lands on a
            page only I can read.
          </p>

          <button className="btn" type="submit" disabled={busy || !message.trim()}>
            {busy ? "Sending…" : "Send"}
          </button>
        </form>
      )}
    </dialog>
  );
}
