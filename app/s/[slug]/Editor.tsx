"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { readSkillMetadata } from "@teapot/renderer";
import type { ContentType } from "@/lib/nodes";

type Props = {
  nodeId: string;
  nodeName: string;
  initialContent: string;
  initialVersion: number;
  initialContentType: ContentType;
  viewHref: string;
};

export function Editor({
  nodeId,
  nodeName,
  initialContent,
  initialVersion,
  initialContentType,
  viewHref,
}: Props) {
  const router = useRouter();
  const [content, setContent] = useState(initialContent);
  const [version, setVersion] = useState(initialVersion);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theirs, setTheirs] = useState<string | null>(null);
  const [contentType, setContentType] = useState<ContentType>(
    initialContentType,
  );

  const dirty = content !== initialContent;

  // Advisory, never blocking. A skill missing a description still saves: losing
  // somebody's writing over a formatting detail is a much worse outcome than an
  // incomplete skill, so this warns and gets out of the way.
  const missing =
    contentType === "skill" ? readSkillMetadata(content).missing : [];

  async function retype(next: ContentType) {
    const previous = contentType;
    setContentType(next);
    setError(null);

    const res = await fetch(`/api/v1/nodes/${nodeId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content_type: next }),
    });

    if (!res.ok) {
      setContentType(previous);
      setError("Could not change the type of this page.");
    }
  }

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
          <label className="editor-type">
            <span className="field-label">Type</span>
            <select
              className="input input-small"
              value={contentType}
              onChange={(e) => void retype(e.target.value as ContentType)}
            >
              <option value="article">Article</option>
              <option value="skill">Skill</option>
            </select>
          </label>
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

      {missing.length > 0 ? (
        <p className="msg msg-warn">
          This skill has no {missing.join(" or ")}. Add it to the frontmatter at
          the top so a client can tell what the skill is for. Saving still
          works.
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
