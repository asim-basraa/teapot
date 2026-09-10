"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { diffLines, diffSummary, type DiffLine } from "@/lib/diff";
import type { Revision } from "@/lib/revisions";

/**
 * What a page has said, and what changed between any two of those.
 *
 * A list of timestamps answers "something changed" and never "what", which is
 * the question anybody opening a history actually has. So the diff is not an
 * extra here; it is the feature, and the list is how you choose its ends.
 */
export function History({
  nodeId,
  nodeName,
  canEdit,
  currentContent,
}: {
  nodeId: string;
  nodeName: string;
  canEdit: boolean;
  currentContent: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="btn btn-secondary btn-small"
        type="button"
        onClick={() => setOpen(true)}
      >
        History
      </button>

      {open ? (
        <HistoryDialog
          nodeId={nodeId}
          nodeName={nodeName}
          canEdit={canEdit}
          currentContent={currentContent}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function HistoryDialog({
  nodeId,
  nodeName,
  canEdit,
  currentContent,
  onClose,
}: {
  nodeId: string;
  nodeName: string;
  canEdit: boolean;
  currentContent: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const res = await fetch(`/api/v1/nodes/${nodeId}/revisions`);
      if (cancelled) return;
      if (!res.ok) {
        setError("Could not load the history for this page.");
        setRevisions([]);
        return;
      }
      const loaded: Revision[] = (await res.json()).revisions ?? [];
      setRevisions(loaded);
      // The most recent one that is not simply the page as it stands, because
      // comparing something with itself is the one answer nobody wants.
      setSelected(loaded[1]?.id ?? loaded[0]?.id ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  useEffect(() => {
    if (!selected) {
      setBody(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/v1/revisions/${selected}`);
      if (cancelled) return;
      setBody(res.ok ? ((await res.json()).revision.content ?? "") : null);
    })();

    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function restore() {
    if (!selected) return;
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/v1/revisions/${selected}/restore`, {
      method: "POST",
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(payload.error ?? `Could not restore that (${res.status})`);
      return;
    }

    setNotice(
      "Restored. That went in as a new version, so this restore is itself in the history and can be undone.",
    );
    router.refresh();
  }

  const lines: DiffLine[] | null =
    body === null ? null : diffLines(body, currentContent);
  const summary = lines ? diffSummary(lines) : null;

  return (
    <dialog
      ref={dialog}
      className="history-dialog"
      onClose={onClose}
      aria-label={`History of ${nodeName}`}
    >
      <div className="share-head">
        <h2>History of &ldquo;{nodeName}&rdquo;</h2>
        <button
          className="btn btn-secondary btn-small"
          type="button"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      {error ? (
        <p className="msg msg-error" role="alert">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="msg msg-notice" role="status">
          {notice}
        </p>
      ) : null}

      {revisions === null ? (
        <p className="tree-empty">Loading…</p>
      ) : revisions.length === 0 ? (
        <p className="tree-empty">Nothing recorded yet.</p>
      ) : (
        <div className="history-body">
          <ul className="history-list">
            {revisions.map((revision, index) => (
              <li key={revision.id}>
                <button
                  type="button"
                  className={
                    revision.id === selected
                      ? "history-entry history-entry-selected"
                      : "history-entry"
                  }
                  onClick={() => setSelected(revision.id)}
                  aria-current={revision.id === selected ? "true" : undefined}
                >
                  <span className="history-when">
                    {new Date(revision.created_at).toLocaleString()}
                    {index === 0 ? " (current)" : ""}
                  </span>
                  <span className="history-who">
                    {revision.author_email ?? "before history was kept"}
                  </span>
                  <span className="history-meta">
                    v{revision.content_version} &middot; {revision.characters}{" "}
                    characters
                    {revision.name !== nodeName
                      ? ` · named "${revision.name}"`
                      : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="history-diff">
            {lines === null ? (
              <p className="tree-empty">Pick a version.</p>
            ) : (
              <>
                <p className="hint">
                  {summary && summary.added === 0 && summary.removed === 0
                    ? "Identical to the page as it stands."
                    : `Compared with the page as it stands: ${summary?.added} added, ${summary?.removed} removed.`}
                </p>

                <pre className="diff">
                  {lines.map((line, i) => (
                    <span key={i} className={`diff-${line.kind}`}>
                      {line.kind === "added"
                        ? "+"
                        : line.kind === "removed"
                          ? "-"
                          : " "}
                      {line.text}
                      {"\n"}
                    </span>
                  ))}
                </pre>

                {canEdit ? (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => void restore()}
                    disabled={busy}
                  >
                    {busy ? "Restoring…" : "Restore this version"}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
