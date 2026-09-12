"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SpaceMember } from "@/lib/members";
import type { Team } from "@/lib/teams";
import { ConfirmDialog } from "@/components/Ask";
import { person } from "@/lib/people";

/**
 * The people and teams in a space.
 *
 * A team can be added as a whole, which is the point of teams: a bucket that
 * makes this one decision instead of one per person, and keeps making it as the
 * bucket's contents change.
 */
export function Members({
  spaceId,
  initial,
  teams,
}: {
  spaceId: string;
  initial: SpaceMember[];
  teams: Team[];
}) {
  const router = useRouter();
  const [members, setMembers] = useState(initial);
  const [email, setEmail] = useState("");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SpaceMember | null>(null);

  async function reload() {
    const res = await fetch(`/api/v1/spaces/${spaceId}/members`);
    if (!res.ok) return;
    setMembers((await res.json()).members ?? []);
    router.refresh();
  }

  async function add(body: Record<string, string>) {
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/v1/spaces/${spaceId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    setBusy(false);

    if (!res.ok) {
      const answer = await res.json().catch(() => ({}));
      setError(answer.error ?? "Could not add them.");
      return;
    }

    setEmail("");
    await reload();
  }

  async function remove(member: SpaceMember) {
    setRemoving(null);
    const res = await fetch(
      `/api/v1/spaces/${spaceId}/members/${member.member_row_id}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      setError("Could not remove them.");
      return;
    }
    await reload();
  }

  return (
    <section className="members">
      {error ? (
        <p className="msg msg-error" role="alert">
          {error}
        </p>
      ) : null}

      <form
        className="share-form"
        onSubmit={(event) => {
          event.preventDefault();
          void add({ email });
        }}
      >
        <label className="field">
          <span className="field-label">Add a person</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@maqsoodlabs.com"
            required
          />
        </label>
        <button className="btn" type="submit" disabled={busy || !email.trim()}>
          {busy ? "Adding…" : "Add"}
        </button>
      </form>

      {teams.length > 0 ? (
        <form
          className="share-form"
          onSubmit={(event) => {
            event.preventDefault();
            void add({ team_id: teamId });
          }}
        >
          <label className="field">
            <span className="field-label">Add a team</span>
            <select
              className="input"
              aria-label="Add a team"
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
          <button className="btn" type="submit" disabled={busy || !teamId}>
            Add
          </button>
        </form>
      ) : null}

      <h2>In this space</h2>

      {members.length === 0 ? (
        <p className="empty">
          Nobody yet, besides you. Adding somebody here lets them read and
          change everything in the space, and start new things in it. What they
          write stays theirs: nobody else can delete it, including you.
        </p>
      ) : (
        <ul className="member-list">
          {members.map((member) => (
            <li key={member.member_row_id}>
              <span className="member-who">
                {member.member_type === "team"
                  ? member.label
                  : person(member.label).label}
                <span className="member-kind">
                  {member.member_type === "team" ? "team" : "person"}
                </span>
              </span>
              <button
                className="btn btn-secondary btn-small"
                type="button"
                onClick={() => setRemoving(member)}
                aria-label={`Remove ${member.label}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {removing ? (
        <ConfirmDialog
          title="Take them out of this space?"
          body={
            removing.member_type === "team"
              ? `Everybody on ${removing.label} loses the space, unless something in it is shared with them some other way. Nothing they wrote is deleted.`
              : `${person(removing.label).label} loses the space, unless something in it is shared with them some other way. Nothing they wrote is deleted.`
          }
          confirmLabel="Remove"
          danger
          onConfirm={() => void remove(removing)}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </section>
  );
}
