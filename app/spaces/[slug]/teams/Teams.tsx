"use client";

import { useState, useTransition } from "react";
import type { Team, TeamMember } from "@/lib/teams";

export function Teams({
  spaceId,
  initialTeams,
}: {
  spaceId: string;
  initialTeams: Team[];
}) {
  const [teams, setTeams] = useState(initialTeams);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const res = await fetch(`/api/v1/spaces/${spaceId}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? `Could not create that team (${res.status})`);
      return;
    }

    setName("");
    setTeams((current) => [...current, body.team].sort(byName));
  }

  async function remove(team: Team) {
    setError(null);
    const res = await fetch(`/api/v1/teams/${team.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Could not delete that team.");
      return;
    }
    startTransition(() => {
      setTeams((current) => current.filter((t) => t.id !== team.id));
    });
  }

  return (
    <section className="teams">
      {error ? (
        <p className="msg msg-error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="team-form" onSubmit={create}>
        <label className="field">
          <span className="field-label">New team</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Engineering"
            required
          />
        </label>
        <button className="btn" type="submit" disabled={busy}>
          Create team
        </button>
      </form>

      {teams.length === 0 ? (
        <p className="empty">No teams yet.</p>
      ) : (
        <ul className="team-list">
          {teams.map((team) => (
            <TeamCard key={team.id} team={team} onDelete={remove} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TeamCard({
  team,
  onDelete,
}: {
  team: Team;
  onDelete: (team: Team) => void;
}) {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch(`/api/v1/teams/${team.id}/members`);
    if (!res.ok) {
      setError("Could not load this team.");
      setMembers([]);
      return;
    }
    const body = await res.json();
    setMembers(body.members ?? []);
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/v1/teams/${team.id}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? `Could not add them (${res.status})`);
      return;
    }

    setEmail("");
    setMembers(body.members ?? []);
  }

  async function removeMember(member: TeamMember) {
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/v1/teams/${team.id}/members/${member.user_id}`,
      { method: "DELETE" },
    );
    setBusy(false);
    if (!res.ok) {
      setError("Could not remove them.");
      return;
    }
    void load();
  }

  return (
    <li className="team-card">
      <details onToggle={(e) => e.currentTarget.open && !members && load()}>
        <summary>
          <span className="team-name">{team.name}</span>
        </summary>

        {error ? (
          <p className="msg msg-error" role="alert">
            {error}
          </p>
        ) : null}

        <form className="team-member-form" onSubmit={add}>
          <label className="field">
            <span className="field-label">Add by email</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@maqsoodlabs.com"
              required
            />
          </label>
          <button className="btn btn-small" type="submit" disabled={busy}>
            Add
          </button>
        </form>

        {members === null ? (
          <p className="tree-empty">Loading…</p>
        ) : members.length === 0 ? (
          <p className="tree-empty">Nobody on this team yet.</p>
        ) : (
          <ul className="team-members">
            {members.map((member) => (
              <li key={member.user_id}>
                <span className="member-email">{member.email}</span>
                <button
                  className="btn btn-secondary btn-small"
                  type="button"
                  onClick={() => removeMember(member)}
                  disabled={busy}
                  aria-label={`Remove ${member.email} from ${team.name}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="team-danger">
          <button
            className="btn btn-secondary btn-small"
            type="button"
            onClick={() => onDelete(team)}
            aria-label={`Delete the team ${team.name}`}
          >
            Delete team
          </button>
          <span className="hint">
            Deleting a team also removes every grant made to it.
          </span>
        </p>
      </details>
    </li>
  );
}

function byName(a: Team, b: Team) {
  return a.name.localeCompare(b.name);
}
