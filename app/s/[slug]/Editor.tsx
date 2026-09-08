"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  nodeId: string;
  nodeName: string;
  initialContent: string;
  initialVersion: number;
  viewHref: string;
};

export function Editor({
  nodeId,
  nodeName,
  initialContent,
  initialVersion,
  viewHref,
}: Props) {
  const router = useRouter();
  const [content, setContent] = useState(initialContent);
  const [version, setVersion] = useState(initialVersion);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theirs, setTheirs] = useState<string | null>(null);

  const dirty = content !== initialContent;

  async function save() {
    setSaving(true);
    setError(null);
    setTheirs(null);

    try {
      const res = await fetch(`/api/v1/nodes/${nodeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, content_version: version }),
      });

      const body = await res.json().catch(() => ({}));

      if (res.ok) {
        // Adopt the new version so a second save from this same editor is not
        // itself treated as stale.
        setVersion(body.node?.content_version ?? version + 1);
        router.push(viewHref);
        router.refresh();
        return;
      }

      setError(body.error ?? `Save failed (${res.status})`);
      // On a conflict the server hands back what is currently stored. The
      // editor keeps the author's text and shows the other version rather
      // than overwriting either.
      if (typeof body.current_content === "string") {
        setTheirs(body.current_content);
      }
    } catch {
      setError("Could not reach the server. Your text is still here.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="editor">
      <div className="editor-bar">
        <h1>{nodeName}</h1>
        <div className="editor-actions">
          <a className="btn btn-secondary btn-small" href={viewHref}>
            Cancel
          </a>
          <button
            className="btn btn-small"
            type="button"
            onClick={save}
            disabled={saving || !dirty}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="msg msg-error" role="alert">
          {error}
        </p>
      ) : null}

      <textarea
        className="editor-area"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
        aria-label={`Markdown source for ${nodeName}`}
      />

      {theirs !== null ? (
        <section className="editor-theirs">
          <h2>Currently saved version</h2>
          <pre>{theirs}</pre>
        </section>
      ) : null}
    </div>
  );
}
