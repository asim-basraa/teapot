"use client";

import { useEffect, useRef, useState } from "react";
import type { EffectiveGrant, GrantRole } from "@/lib/grants";

export function Share({
  nodeId,
  nodeName,
}: {
  nodeId: string;
  nodeName: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [grants, setGrants] = useState<EffectiveGrant[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<GrantRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  async function load() {
    setError(null);
    const res = await fetch(`/api/v1/nodes/${nodeId}/grants`);
    if (!res.ok) {
      setError("Could not load sharing for this item.");
      setGrants([]);
      return;
    }
    const body = await res.json();
    setGrants(body.grants ?? []);
  }

  function show() {
    setOpen(true);
    setGrants(null);
    void load();
  }

  async function share(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/v1/nodes/${nodeId}/grants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    });

    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? `Could not share (${res.status})`);
      return;
    }

    setEmail("");
    setGrants(body.grants ?? []);
  }

  async function revoke(grantId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/grants/${grantId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError("Could not revoke that access.");
      return;
    }
    void load();
  }

  return (
    <>
      <button className="btn btn-secondary btn-small" type="button" onClick={show}>
        Share
      </button>

      <dialog
        ref={dialog}
        className="share-dialog"
        onClose={() => setOpen(false)}
        aria-label={`Sharing for ${nodeName}`}
      >
        <div className="share-head">
          <h2>Share &ldquo;{nodeName}&rdquo;</h2>
          <button
            className="btn btn-secondary btn-small"
            type="button"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>

        {error ? (
          <p className="msg msg-error" role="alert">
            {error}
          </p>
        ) : null}

        <form className="share-form" onSubmit={share}>
          <label className="field">
            <span className="field-label">Email</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@maqsoodlabs.com"
              required
            />
          </label>

          <label className="field share-role">
            <span className="field-label">Role</span>
            <select
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value as GrantRole)}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Sharing…" : "Share"}
          </button>
        </form>

        <h3>Who has access</h3>

        {grants === null ? (
          <p className="tree-empty">Loading…</p>
        ) : grants.length === 0 ? (
          <p className="tree-empty">Nobody yet, besides the space owner.</p>
        ) : (
          <ul className="share-list">
            {grants.map((g) => (
              <li key={g.grant_id}>
                <span className="share-who">
                  {g.grantee_type === "public"
                    ? "Anyone with the link"
                    : (g.grantee_email ?? g.grantee_type)}
                </span>
                <span className="share-role-label">{g.role}</span>
                {g.inherited ? (
                  // Naming the origin is what makes an audit possible: "why can
                  // they see this" is answered by the folder it came from.
                  <span className="share-origin">
                    inherited from {g.origin_path}
                  </span>
                ) : (
                  <button
                    className="btn btn-secondary btn-small"
                    type="button"
                    onClick={() => revoke(g.grant_id)}
                    disabled={busy}
                    aria-label={`Revoke access for ${g.grantee_email ?? "this grantee"}`}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </dialog>
    </>
  );
}
