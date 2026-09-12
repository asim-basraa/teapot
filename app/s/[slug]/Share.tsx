"use client";

import { useEffect, useRef, useState } from "react";
import type { EffectiveGrant, GrantRole } from "@/lib/grants";
import {
  readVisibility,
  readInheritedVisibility,
  type Visibility,
} from "@/lib/visibility";
import type { GrantableTeam } from "@/lib/teams";

type Grantee = "person" | "team";

/** How far each answer reaches, so a wider one can be recognised as wider. */
const RANK: Record<Visibility, number> = { private: 0, everyone: 1, public: 2 };

const REACH_WORDS: Record<Visibility, string> = {
  private: "private",
  everyone: "readable by everyone signed in to Post-it",
  public: "readable by anyone with the link",
};

/**
 * What each answer means, spelled out under the control.
 *
 * The one that matters is the difference between the middle two and the last:
 * everybody at your organisation is not everybody on the internet, and a
 * control that blurs them is how things get published that were meant to be
 * circulated.
 */
const DESCRIPTIONS: Record<string, string> = {
  private:
    "Nobody but the people and teams listed below, and the space's owner.",
  "everyone:viewer":
    "Everyone with a Post-it account can read it. Signed-out visitors get nothing.",
  "everyone:editor":
    "Everyone with a Post-it account can read and edit it. Signed-out visitors get nothing.",
  public:
    "On the web. No sign-in, no account, anybody with the address. Everything inside it is public too.",
};

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
}: {
  nodeId: string;
  nodeName: string;
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
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export function ShareDialog({
  nodeId,
  nodeName,
  onClose,
}: {
  nodeId: string;
  nodeName: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [grants, setGrants] = useState<EffectiveGrant[] | null>(null);
  const [teams, setTeams] = useState<GrantableTeam[]>([]);
  const [grantee, setGrantee] = useState<Grantee>("person");
  const [email, setEmail] = useState("");
  const [teamId, setTeamId] = useState("");
  const [role, setRole] = useState<GrantRole>("viewer");
  const [busy, setBusy] = useState(false);
  // What the control shows while the write is in flight. A control that does
  // not move when you use it reads as broken, and Playwright agrees: it
  // reports the interaction as having had no effect.
  const [pendingReach, setPendingReach] = useState<string | null>(null);
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
    setPendingReach(null);
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
  //
  // Asked of the node rather than of its space. Which teams you may hand this
  // to is a question about which teams you are on, and a team defined in
  // somebody else's space is still a group of people you know.
  async function loadTeams() {
    const res = await fetch(`/api/v1/nodes/${nodeId}/teams`);
    if (!res.ok) return;
    const body = await res.json();
    const list: GrantableTeam[] = body.teams ?? [];
    setTeams(list);
    if (list.length > 0) setTeamId((current) => current || list[0].team_id);
  }

  const chosenTeam = teams.find((team) => team.team_id === teamId) ?? null;

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
        `${email} has no Post-it account yet. An invitation is on its way, and they will have access as soon as they accept it.`,
      );
    }

    if (grantee === "person") setEmail("");
    setGrants(body.grants ?? []);
  }

  /**
   * One write for one decision.
   *
   * The value carries both halves because they are one answer: "everyone:editor"
   * is a different answer to "who can see this" than "everyone:viewer", not a
   * second setting stacked on top of it.
   */
  async function setReach(next: string) {
    const [visibility, role] = next.split(":");

    setBusy(true);
    setPendingReach(next);
    setError(null);

    const res = await fetch(`/api/v1/nodes/${nodeId}/visibility`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility, role: role ?? null }),
    });

    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setPendingReach(null);

    if (!res.ok) {
      // Snap back to what the server actually says rather than leaving the
      // control asserting something that did not happen.
      setError(body.error ?? `Could not change that (${res.status})`);
      return;
    }

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

  // Derived from the grants already loaded rather than asked for separately,
  // and split in two on purpose. The control changes this node's own reach;
  // what an ancestor confers cannot be changed from here, and a page inside a
  // published folder is public whatever its own setting says. Showing them as
  // one value would make the control lie about what it does.
  const own = readVisibility(grants ?? []);
  const inherited = readInheritedVisibility(grants ?? []);

  const reach =
    pendingReach ??
    (own.visibility === "everyone"
      ? `everyone:${own.role ?? "viewer"}`
      : own.visibility);

  // Wider than what this node sets for itself, so the setting below is not the
  // whole truth about who can read this.
  const overruled =
    inherited !== null && RANK[inherited.visibility] > RANK[own.visibility];

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

      <h3>Who can see this</h3>

      <div className="share-reach">
        <label className="field">
          <span className="field-label">Visibility</span>
          <select
            className="input"
            value={reach}
            disabled={busy || grants === null}
            onChange={(e) => void setReach(e.target.value)}
          >
            <option value="private">
              Private &mdash; only people it is shared with
            </option>
            <option value="everyone:viewer">
              Everyone signed in to Post-it can read
            </option>
            <option value="everyone:editor">
              Everyone signed in to Post-it can edit
            </option>
            <option value="public">
              Public &mdash; anyone with the link, no account needed
            </option>
          </select>
        </label>

        <p className="hint">{DESCRIPTIONS[reach] ?? DESCRIPTIONS.private}</p>

        {inherited ? (
          // Naming the origin is what makes this answerable rather than merely
          // surprising: the folder it comes from is where to change it.
          <p className={overruled ? "msg msg-error" : "hint"}>
            {overruled
              ? `This is inside ${inherited.originPath}, which is ${REACH_WORDS[inherited.visibility]}, so this is too. Change it there.`
              : `Also ${REACH_WORDS[inherited.visibility]} through ${inherited.originPath}.`}
          </p>
        ) : null}
      </div>

      <h3>Share with somebody</h3>

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
          <>
            <label className="field">
              <span className="field-label">Team</span>
              <select
                className="input"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                {teams.map((team) => (
                  <option key={team.team_id} value={team.team_id}>
                    {/* Qualified only when it needs qualifying. A team from
                        this space is the ordinary case and reads better
                        without the extra words. */}
                    {team.same_space
                      ? team.team_name
                      : `${team.team_name} (in ${team.space_name})`}
                  </option>
                ))}
              </select>
            </label>

            {/* The part of group sharing that is easy to find out too late.
                You are handing this to a list somebody else keeps, so it
                covers whoever is on that list later, not only today. */}
            {chosenTeam && !chosenTeam.same_space ? (
              <p className="hint">
                {chosenTeam.team_name} is kept in {chosenTeam.space_name}, so
                whoever owns that space decides who is on it. Anybody added
                later will be able to read this too.
              </p>
            ) : null}
          </>
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
    return "Everyone with a Post-it account";
  }
  if (grant.grantee_type === "team") {
    return `${grant.grantee_name ?? "A team"} (team)`;
  }
  return grant.grantee_email ?? "Someone";
}
