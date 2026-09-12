"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/Ask";
import type { AdminUser, OwnedSpace } from "@/lib/admin";

/**
 * The table, and the four things an administrator can do from it.
 *
 * Every action re-reads the whole list afterwards rather than patching the row
 * in place. One of them changes another row (handing a space over moves it
 * from one person's count to another's), and a table that updates only the row
 * you touched would quietly disagree with itself.
 */
export function Users({ initial, me }: { initial: AdminUser[]; me: string }) {
  const [users, setUsers] = useState(initial);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handing, setHanding] = useState<AdminUser | null>(null);

  async function refresh() {
    const res = await fetch("/api/v1/admin/users");
    if (res.ok) setUsers((await res.json()).users ?? []);
  }

  async function act(id: string, init: RequestInit) {
    setBusy(id);
    setError(null);

    const res = await fetch(`/api/v1/admin/users/${id}`, init);
    const body = await res.json().catch(() => ({}));
    setBusy(null);

    if (!res.ok) {
      setError(body.error ?? "That did not work.");
      return false;
    }

    await refresh();
    return true;
  }

  const patch = (id: string, fields: Record<string, boolean>) =>
    act(id, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields),
    });

  return (
    <>
      {error ? (
        <p className="msg msg-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="table-scroll">
        <table className="people">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Spaces</th>
              <th scope="col">Articles</th>
              <th scope="col">Skills</th>
              <th scope="col">Storage</th>
              <th scope="col">Last seen</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className={user.disabled ? "is-disabled" : ""}>
                <td>
                  <span className="person-email">{user.email}</span>
                  {user.is_admin ? (
                    <span className="share-role-label">admin</span>
                  ) : null}
                  {user.disabled ? (
                    <span className="share-role-label">disabled</span>
                  ) : null}
                </td>
                <td className="num">{user.spaces}</td>
                <td className="num">{user.articles}</td>
                <td className="num">{user.skills}</td>
                <td className="num" title={`${user.history_bytes} bytes of that is history`}>
                  {bytes(user.content_bytes + user.history_bytes)}
                </td>
                <td>{when(user.last_sign_in_at)}</td>
                <td className="row-actions">
                  {user.spaces > 0 ? (
                    <button
                      className="btn btn-secondary btn-small"
                      type="button"
                      onClick={() => setHanding(user)}
                    >
                      Hand over
                    </button>
                  ) : null}

                  <button
                    className="btn btn-secondary btn-small"
                    type="button"
                    disabled={busy === user.id}
                    onClick={() => patch(user.id, { is_admin: !user.is_admin })}
                  >
                    {user.is_admin ? "Stand down" : "Make admin"}
                  </button>

                  {/* Not on yourself: locking yourself out of the screen that
                      unlocks people is a mistake with no way back through the
                      interface. */}
                  {user.id === me ? null : (
                    <button
                      className="btn btn-secondary btn-small"
                      type="button"
                      disabled={busy === user.id}
                      onClick={() => patch(user.id, { disabled: !user.disabled })}
                    >
                      {user.disabled ? "Enable" : "Disable"}
                    </button>
                  )}

                  {user.id === me ? null : (
                    <button
                      className="btn btn-danger btn-small"
                      type="button"
                      disabled={busy === user.id}
                      onClick={() => setDeleting(user)}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {handing ? (
        <HandOver
          user={handing}
          candidates={users.filter((u) => u.id !== handing.id)}
          onClose={() => setHanding(null)}
          onDone={async () => {
            setHanding(null);
            await refresh();
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Delete ${deleting.email}?`}
          body={`Their account goes for good, along with everything only they could read. This cannot be undone.`}
          confirmLabel="Delete account"
          danger
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            void act(id, { method: "DELETE" });
          }}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Giving one person's spaces to another.
 *
 * One at a time and named, rather than a single "move everything" button,
 * because the spaces somebody owns rarely all belong with the same person
 * afterwards, and the button that moves them together is the one that gets
 * pressed without reading.
 */
function HandOver({
  user,
  candidates,
  onClose,
  onDone,
}: {
  user: AdminUser;
  candidates: AdminUser[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [spaces, setSpaces] = useState<OwnedSpace[] | null>(null);
  const [owner, setOwner] = useState(candidates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const res = await fetch(`/api/v1/admin/users/${user.id}/spaces`);
      const loaded = res.ok ? ((await res.json()).spaces ?? []) : [];
      if (!cancelled) setSpaces(loaded);
    })();

    return () => {
      cancelled = true;
    };
  }, [user.id]);

  async function hand(spaceId: string) {
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/v1/admin/spaces/${spaceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner_id: owner }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(body.error ?? "That did not work.");
      return;
    }

    setSpaces((current) => (current ?? []).filter((s) => s.id !== spaceId));
  }

  return (
    <dialog className="share-dialog" open aria-label={`Spaces owned by ${user.email}`}>
      <div className="share-head">
        <h2>{user.email}</h2>
        <button className="btn btn-secondary btn-small" type="button" onClick={onDone}>
          Close
        </button>
      </div>

      {error ? (
        <p className="msg msg-error" role="alert">
          {error}
        </p>
      ) : null}

      <label className="field">
        <span className="field-label">Hand to</span>
        <select
          className="input"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        >
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.email}
            </option>
          ))}
        </select>
      </label>

      <p className="hint">
        The new owner administers everything in the space. {user.email} keeps
        only what they were separately granted, which for somebody who has left
        is usually nothing.
      </p>

      {spaces === null ? (
        <p className="tree-empty">Loading…</p>
      ) : spaces.length === 0 ? (
        <p className="tree-empty">
          Nothing left to hand over. This account can be deleted now.
        </p>
      ) : (
        <ul className="share-list">
          {spaces.map((space) => (
            <li key={space.id}>
              <span>
                {space.name} <span className="space-slug">/s/{space.slug}</span>
              </span>
              <button
                className="btn btn-secondary btn-small"
                type="button"
                disabled={busy || !owner}
                onClick={() => void hand(space.id)}
              >
                Hand over
              </button>
            </li>
          ))}
        </ul>
      )}

      <button className="btn btn-secondary btn-small" type="button" onClick={onClose} hidden>
        Cancel
      </button>
    </dialog>
  );
}

/** Bytes, in the unit a person would say out loud. */
function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function when(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}
