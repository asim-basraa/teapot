"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";

/**
 * A link that admits it has been clicked.
 *
 * Every page that reads content is force-dynamic, so a navigation waits on the
 * database before anything on screen changes. On a fast connection that is
 * imperceptible and on a slow one it is a second or more of a page that looks
 * exactly as it did before the click — so people click again, which starts the
 * whole navigation over and makes the wait longer.
 *
 * useLinkStatus is pending only for the link that actually started the
 * navigation, which is the useful property: the one you clicked says so, and the
 * other nine in the list do not pretend to be loading.
 *
 * Do not reach for a route-level `loading.tsx` instead, which is the obvious
 * answer and is wrong here. It puts the segment behind a Suspense boundary, so
 * Next begins streaming and commits HTTP 200 before the page has decided
 * anything — and then notFound() renders inside a 200 response. This product
 * makes unreadable and nonexistent indistinguishable, and the status code is
 * part of what a caller sees, so eight tests across the suite caught it at once
 * when it was tried. A spinner on the link changes no status code.
 */
export function NavLink({
  children,
  className,
  ...rest
}: ComponentProps<typeof Link>) {
  return (
    <Link className={className} {...rest}>
      {children}
      <Pending />
    </Link>
  );
}

/**
 * The spinner itself, as a child so that useLinkStatus has a Link to read.
 *
 * Exported for the links that cannot become a NavLink because they carry their
 * own layout, and for the one in the header.
 */
export function Pending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <span className="link-pending" role="status" aria-label="Loading">
      <span className="link-spinner" aria-hidden="true" />
    </span>
  );
}
