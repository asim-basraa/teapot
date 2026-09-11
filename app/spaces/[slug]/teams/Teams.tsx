"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { Team, TeamMember, TeamReach } from "@/lib/teams";
import { NavLink } from "@/components/NavLink";

export function Teams({
  spaceId,
  spaceSlug,
  initialTeams,
}: {
  spaceId: string;
  spaceSlug: string;
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
            <TeamCard
              key={team.id}
              team={team}
              spaceSlug={spaceSlug}
              onDelete={remove}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TeamCard({
  team,
  spaceSlug,
  onDelete,
}: {
  team: Team;
  spaceSlug: string;
  onDelete: (team: Team) => void;
}) {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [reach, setReach] = useState<TeamReach[] | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch(`/api/v1/teams/${team.id}/members`);
    if (!res.ok) {
      setError("Could not load this team.");
      setMembers([]);
      setReach([]);
      return;
    }
    const body = await res.json();
    setMembers(body.members ?? []);
    setReach(body.reach ?? []);
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
    setReach(body.reach ?? []);
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

        <Reach reach={reach} teamName={team.name} spaceSlug={spaceSlug} />

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

/**
 * What this team can actually reach.
 *
 * The question QA asked: a team with nobody's pages in it looks broken, and a
 * team with somebody on it looks like it must have granted them something. Both
 * readings are wrong, and neither was contradicted anywhere on this screen.
 * Being a team is not being given anything; a grant is, and this is the list of
 * them.
 */
function Reach({
  reach,
  teamName,
  spaceSlug,
}: {
  reach: TeamReach[] | null;
  teamName: string;
  spaceSlug: string;
}) {
  if (reach === null) return null;

  return (
    <div className="team-reach">
      <h3 className="team-reach-head">What this team can reach</h3>

      {reach.length === 0 ? (
        <p className="hint">
          Nothing yet. Being on {teamName} grants nobody anything on its own —
          open a page or folder in{" "}
          <Link href={`/s/${spaceSlug}`}>this space</Link>, choose Share, and
          share it with {teamName}. Everyone on the team gets it at once, and
          anyone taken off the team loses it.
        </p>
      ) : (
        <ul className="team-reach-list">
          {reach.map((item) => (
            <li key={item.node_id}>
              <NavLink href={item.href} className="team-reach-what">
                {item.label}
              </NavLink>
              <span className="team-reach-role">
                {item.role} · and everything beneath it
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function byName(a: Team, b: Team) {
  return a.name.localeCompare(b.name);
}
