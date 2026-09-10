"use client";

import { useState } from "react";
import Link from "next/link";
import { Copyable } from "@/components/Copyable";
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
        // Every client, with the real token already in it. The alternative is
        // a page that shows one shape and leaves you to work out the other
        // two, transcribing a secret by hand in the process, where one wrong
        // character costs an hour and reads like a permissions problem.
        <div className="token-issued">
          <h2>Your new token</h2>
          <p className="hint">
            Copy it now. Postit stores only a hash of it, so this is the one
            and only time it can be shown. If you lose it, revoke it and make
            another.
          </p>

          <Copyable label="Token" text={issued} />

          <h3>Set it up</h3>
          <p className="hint">
            Pick the one for the client you are using. Each already contains
            this token and this Postit&rsquo;s address.
          </p>

          <Copyable
            label="Claude Code, command line"
            text={`claude mcp add --transport http postit ${endpoint} \\\n  --header "Authorization: Bearer ${issued}"`}
          />

          <Copyable
            label="Claude Code, .mcp.json"
            text={JSON.stringify(
              {
                mcpServers: {
                  postit: {
                    type: "http",
                    url: endpoint,
                    headers: { Authorization: `Bearer ${issued}` },
                  },
                },
              },
              null,
              2,
            )}
          />

          <h3>The Claude apps, desktop and web</h3>
          <p className="hint">
            Settings, then Connectors, then Add custom connector, and give it
            this URL. That dialog takes a URL and nothing else, so this is the
            one form with the token in it.
          </p>

          <Copyable label="Connector URL" text={`${endpoint}/${issued}`} />

          <p className="msg msg-error">
            <strong>Weaker than the two above, on purpose.</strong> A token in a
            URL is in every HTTP log that records the path, in whatever Claude
            stores for the connection, and anywhere the URL is pasted. A token
            in a header is in none of those. Use this only where a header is
            not on offer, and prefer a token pinned to a single space so a leak
            costs one space rather than your account.
          </p>

          {/* curl rather than a bare body, because the beta header is half of
              the requirement and a JSON block cannot show it. Without the
              header, and without the matching mcp_toolset entry, the request
              is rejected as a validation error rather than merely ignoring the
              server. */}
          <Copyable
            label="Anthropic API"
            text={apiExample(endpoint, issued)}
            collapsed
          />

          <p className="hint">
            <Link href="/docs#reach">
              What a connected Claude can and cannot reach
            </Link>
          </p>

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

/**
 * A complete request, header included.
 *
 * The MCP connector needs three things that are easy to give two of: the beta
 * header, the server in `mcp_servers`, and a matching `mcp_toolset` entry in
 * `tools`. Leaving the toolset out is not a quiet no-op; the request is
 * refused. So this is a whole command rather than a body somebody has to
 * assemble a request around.
 */
function apiExample(endpoint: string, token: string): string {
  const body = JSON.stringify(
    {
      model: "claude-opus-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: "What is on my todo list?" }],
      mcp_servers: [
        {
          type: "url",
          url: endpoint,
          name: "postit",
          authorization_token: token,
        },
      ],
      tools: [{ type: "mcp_toolset", mcp_server_name: "postit" }],
    },
    null,
    2,
  );

  return [
    "curl https://api.anthropic.com/v1/messages \\",
    '  -H "content-type: application/json" \\',
    '  -H "x-api-key: $ANTHROPIC_API_KEY" \\',
    '  -H "anthropic-version: 2023-06-01" \\',
    '  -H "anthropic-beta: mcp-client-2025-11-20" \\',
    `  -d '${body}'`,
  ].join("\n");
}
