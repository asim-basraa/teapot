"use client";

import { useEffect, useRef, useState } from "react";
import type { EffectiveGrant, GrantRole } from "@/lib/grants";
import type { Team } from "@/lib/teams";

type Grantee = "person" | "team";

/**
 * The Share button, and the dialog it opens.
 *
 * Two entry points because sharing is asked for in two places: on the page you
 * are reading, and in the sidebar, where a folder is the thing most people
 * want to share and is not somewhere you can stand. Both open the same dialog;
 * ShareDialog is it, on its own, for callers that already have a button.
 */
export function Share({
  nodeId,
  nodeName,
  spaceId,
}: {
  nodeId: string;
  nodeName: string;
  spaceId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="btn btn-secondary btn-small"
        type="button"
        onClick={() => setOpen(true)}
      >
        Share
      </button>

      {open ? (
        <ShareDialog
          nodeId={nodeId}
          nodeName={nodeName}
          spaceId={spaceId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export function ShareDialog({
  nodeId,
  nodeName,
  spaceId,
  onClose,
}: {
  nodeId: string;
  nodeName: string;
  spaceId: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [grants, setGrants] = useState<EffectiveGrant[] | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [grantee, setGrantee] = useState<Grantee>("person");
  const [email, setEmail] = useState("");
  const [teamId, setTeamId] = useState("");
  const [role, setRole] = useState<GrantRole>("viewer");
  const [busy, setBusy] = useState(false);
  // What the toggle shows while the write is in flight. A checkbox that does
  // not move when you click it reads as broken, and Playwright agrees: it
  // reports the click as having had no effect.
  const [pendingPublic, setPendingPublic] = useState<boolean | null>(null);
  const [pendingEveryone, setPendingEveryone] = useState<GrantRole | "" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Mounted means open: the caller decides whether the dialog exists, which
  // keeps the loading below tied to being shown rather than to a second flag.
  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  useEffect(() => {
    setGrants(null);
    setPendingPublic(null);
    setPendingEveryone(null);
    void load();
    void loadTeams();
    // Once, for the node this dialog is about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

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

  // Teams are loaded alongside the grants rather than lazily: whether the
  // "Team" option is worth offering at all depends on there being any.
  async function loadTeams() {
    const res = await fetch(`/api/v1/spaces/${spaceId}/teams`);
    if (!res.ok) return;
    const body = await res.json();
    const list: Team[] = body.teams ?? [];
    setTeams(list);
    if (list.length > 0) setTeamId((current) => current || list[0].id);
  }

  async function share(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const payload =
      grantee === "team" ? { team_id: teamId, role } : { email, role };

    const res = await fetch(`/api/v1/nodes/${nodeId}/grants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? `Could not share (${res.status})`);
      return;
    }

    // They had no account, so one was created and an invitation emailed. Worth
    // saying: they appear on the list below but cannot read anything until
    // they accept, and somebody who does not know that will wonder why.
    if (body.invited) {
      setNotice(
        `${email} has no Teapot account yet. An invitation is on its way, and they will have access as soon as they accept it.`,
      );
    }

    if (grantee === "person") setEmail("");
    setGrants(body.grants ?? []);
  }

  async function publish(next: boolean) {
    setBusy(true);
    setPendingPublic(next);
    setError(null);

    const res = await fetch(`/api/v1/nodes/${nodeId}/public`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ public: next }),
    });

    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      // Snap back to what the server actually says rather than leaving the
      // toggle asserting something that did not happen.
      setPendingPublic(null);
      setError(body.error ?? `Could not change that (${res.status})`);
      return;
    }

    setGrants(body.grants ?? []);
    setPendingPublic(null);
  }

  // The parameter is deliberately not called `role`: there is already a `role`
  // in scope for the person-or-team form, and the two mean different things.
  async function shareWithEveryone(next: GrantRole | "") {
    setBusy(true);
    setPendingEveryone(next);
    setError(null);

    const res = await fetch(`/api/v1/nodes/${nodeId}/everyone`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: next === "" ? null : next }),
    });

    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setPendingEveryone(null);
      setError(body.error ?? `Could not change that (${res.status})`);
      return;
    }

    setGrants(body.grants ?? []);
    setPendingEveryone(null);
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

  // Derived from the grants already loaded rather than asked for separately.
  // The distinction matters: a page under a published folder is readable by
  // anyone, but the grant to remove is the folder's, not the page's, so the
  // toggle has to show the state it can actually change.
  const publicGrants = (grants ?? []).filter(
    (g) => g.grantee_type === "public",
  );
  const published = pendingPublic ?? publicGrants.some((g) => !g.inherited);
  const inheritedPublic = publicGrants.find((g) => g.inherited) ?? null;

  const everyoneGrants = (grants ?? []).filter(
    (g) => g.grantee_type === "authenticated",
  );
  const everyoneHere = everyoneGrants.find((g) => !g.inherited) ?? null;
  const inheritedEveryone = everyoneGrants.find((g) => g.inherited) ?? null;
  const everyoneRole = pendingEveryone ?? everyoneHere?.role ?? "";

  return (
    <dialog
      ref={dialog}
      className="share-dialog"
      onClose={onClose}
      aria-label={`Sharing for ${nodeName}`}
    >
      <div className="share-head">
        <h2>Share &ldquo;{nodeName}&rdquo;</h2>
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

      <form className="share-form" onSubmit={share}>
        {teams.length > 0 ? (
          <label className="field share-with">
            <span className="field-label">Share with</span>
            <select
              className="input"
              value={grantee}
              onChange={(e) => setGrantee(e.target.value as Grantee)}
            >
              <option value="person">A person</option>
              <option value="team">A team</option>
            </select>
          </label>
        ) : null}

        {grantee === "team" ? (
          <label className="field">
            <span className="field-label">Team</span>
            <select
              className="input"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
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
        )}

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

      <h3>Everyone here</h3>

      <div className="share-everyone">
        <label className="field">
          <span className="field-label">Everyone with a Teapot account</span>
          <select
            className="input"
            value={everyoneRole}
            disabled={busy || grants === null || inheritedEveryone !== null}
            onChange={(e) =>
              void shareWithEveryone(e.target.value as GrantRole | "")
            }
          >
            <option value="">No access</option>
            <option value="viewer">Can read</option>
            <option value="editor">Can edit</option>
          </select>
        </label>

        {inheritedEveryone ? (
          <p className="hint">
            Already shared with everyone through {inheritedEveryone.origin_path}
            . Change it there.
          </p>
        ) : (
          <p className="hint">
            Everyone signed in to Teapot, and nobody else. This is not the same
            as putting it on the web, below.
          </p>
        )}
      </div>

      <h3>On the web</h3>

      <div className="share-public">
        <label className="share-public-toggle">
          <input
            type="checkbox"
            checked={published}
            disabled={busy || grants === null || inheritedPublic !== null}
            onChange={(e) => void publish(e.target.checked)}
          />
          <span>Anyone with the link can read this</span>
        </label>

        {inheritedPublic ? (
          // The toggle would appear to do nothing here: the grant lives on an
          // ancestor, and this node is public because of it.
          <p className="hint">
            Already public through {inheritedPublic.origin_path}. Turn it off
            there.
          </p>
        ) : published ? (
          <p className="hint">
            No sign-in needed. Everything inside this item is public too.
          </p>
        ) : null}
      </div>

      <h3>Who has access</h3>

      {grants === null ? (
        <p className="tree-empty">Loading…</p>
      ) : grants.length === 0 ? (
        <p className="tree-empty">Nobody yet, besides the space owner.</p>
      ) : (
        <ul className="share-list">
          {grants.map((g) => (
            <li key={g.grant_id}>
              <span className="share-who">{describe(g)}</span>
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
                  aria-label={`Revoke access for ${describe(g)}`}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </dialog>
  );
}

/**
 * How a grantee is named in the list.
 *
 * A team grant used to read as the bare word "team", which answers nothing when
 * a space has several. Naming it is what makes the list auditable.
 */
function describe(grant: EffectiveGrant): string {
  if (grant.grantee_type === "public") return "Anyone with the link";
  if (grant.grantee_type === "authenticated") {
    return "Everyone with a Teapot account";
  }
  if (grant.grantee_type === "team") {
    return `${grant.grantee_name ?? "A team"} (team)`;
  }
  return grant.grantee_email ?? "Someone";
}
