"use client";

import { useState } from "react";
import type { McpToken } from "@/lib/mcp/tokens";

type Space = { id: string; name: string };

export function Tokens({
  initialTokens,
  spaces,
  endpoint,
}: {
  initialTokens: McpToken[];
  spaces: Space[];
  endpoint: string;
}) {
  const [tokens, setTokens] = useState(initialTokens);
  const [name, setName] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The plaintext, held only in this component's state and only until the page
  // is left. It is not stored anywhere and cannot be fetched again.
  const [issued, setIssued] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/v1/mcp-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, space_id: spaceId || null }),
    });

    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? `Could not create a token (${res.status})`);
      return;
    }

    setName("");
    setIssued(body.token);
    setTokens((current) => [body.record, ...current]);
  }

  async function revoke(token: McpToken) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/mcp-tokens/${token.id}`, {
      method: "DELETE",
    });
    setBusy(false);

    if (!res.ok) {
      setError("Could not revoke that token.");
      return;
    }
    setTokens((current) => current.filter((t) => t.id !== token.id));
  }

  const spaceName = (id: string | null) =>
    id ? (spaces.find((s) => s.id === id)?.name ?? "a space") : "everything";

  return (
    <section className="tokens">
      {error ? (
        <p className="msg msg-error" role="alert">
          {error}
        </p>
      ) : null}

      {issued ? (
        <div className="token-issued">
          <h2>Your new token</h2>
          <p className="hint">
            Copy it now. It is stored only as a hash, so this is the one and
            only time it can be shown. If you lose it, revoke it and make
            another.
          </p>
          <code className="token-value">{issued}</code>

          <h3>Configuration</h3>
          <pre className="token-config">
            {JSON.stringify(
              {
                mcpServers: {
                  teapot: {
                    type: "http",
                    url: endpoint,
                    headers: { Authorization: `Bearer ${issued}` },
                  },
                },
              },
              null,
              2,
            )}
          </pre>

          <button
            className="btn btn-secondary btn-small"
            type="button"
            onClick={() => setIssued(null)}
          >
            Done
          </button>
        </div>
      ) : null}

      <form className="token-form" onSubmit={create}>
        <label className="field">
          <span className="field-label">Name this token</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Laptop"
            required
          />
        </label>

        <label className="field">
          <span className="field-label">Reaches</span>
          <select
            className="input"
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
          >
            <option value="">Everything I can read</option>
            {spaces.map((space) => (
              <option key={space.id} value={space.id}>
                Only {space.name}
              </option>
            ))}
          </select>
        </label>

        <button className="btn" type="submit" disabled={busy}>
          Create token
        </button>
      </form>

      <h2>Your tokens</h2>

      {tokens.length === 0 ? (
        <p className="empty">None yet.</p>
      ) : (
        <ul className="token-list">
          {tokens.map((token) => (
            <li key={token.id}>
              <span className="token-name">{token.name}</span>
              <span className="token-scope">
                reaches {spaceName(token.space_id)}
              </span>
              <span className="token-used">
                {token.last_used_at
                  ? `last used ${new Date(token.last_used_at).toLocaleDateString()}`
                  : "never used"}
              </span>
              <button
                className="btn btn-secondary btn-small"
                type="button"
                onClick={() => revoke(token)}
                disabled={busy}
                aria-label={`Revoke the token ${token.name}`}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
