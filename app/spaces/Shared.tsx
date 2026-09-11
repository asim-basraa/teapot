"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { Share } from "@/lib/shares";

/**
 * What other people have handed you.
 *
 * Marked seen from here rather than while rendering on the server, because a
 * render is not a reading: the request that builds this page might be a
 * prefetch, and marking then would clear the very thing somebody came to see.
 */
export function Shared({ shares }: { shares: Share[] }) {
  const unseen = shares.some((s) => s.is_new);

  useEffect(() => {
    if (!unseen) return;
    void fetch("/api/v1/shares/seen", { method: "POST" });
  }, [unseen]);

  if (shares.length === 0) return null;

  return (
    <section className="shared">
      <h2>Shared with you</h2>

      <ul className="shared-list">
        {shares.map((share, i) => (
          <li key={`${share.kind}-${share.href ?? share.label}-${i}`}>
            {share.is_new ? <span className="shared-new">new</span> : null}

            {share.href ? (
              <Link href={share.href} className="shared-what">
                {share.label}
              </Link>
            ) : (
              <span className="shared-what">{share.label}</span>
            )}

            <span className="shared-why">
              {share.kind === "team"
                ? `added to this team in ${share.detail}`
                : `${share.role} in ${share.detail}`}
              {share.actor ? ` · by ${share.actor}` : null}
            </span>

            <span className="shared-when">{when(share.happened_at)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function when(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}
