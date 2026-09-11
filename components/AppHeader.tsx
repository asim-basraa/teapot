import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/(auth)/actions";
import { Mark } from "@/components/Mark";

/**
 * The bar across the top of every signed-in page.
 *
 * One component because there were three copies of it and they had already
 * drifted: two offered no way to reach your own account and the third had a
 * different set of controls. Anything a particular page needs goes in as
 * children, between the brand and the account.
 *
 * The address is the label on purpose. In a product whose whole subject is who
 * can see what, "which of my accounts is this?" is a question people ask
 * constantly, and a page that answers it only after a click has not answered it.
 */
export function AppHeader({
  email,
  className,
  admin = false,
  children,
}: {
  email?: string | null;
  className?: string;
  /** Whether to offer the way in to the people screen. */
  admin?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className={className ? `shell-header ${className}` : "shell-header"}>
      <Link href={email ? "/spaces" : "/"} className="shell-brand">
        <Mark size={19} />
        Post-it
      </Link>

      {children}

      {/* One group, pushed right, so a page that slots something in the middle
          does not rearrange where the account and sign-out live. */}
      <div className="shell-actions">
        {email ? (
          <>
            {admin ? (
              <Link href="/admin" className="shell-admin">
                People
              </Link>
            ) : null}
            <Link href="/account" className="shell-account" title="Your account">
              {email}
            </Link>
            <form action={signOut}>
              <button className="btn btn-secondary btn-small" type="submit">
                Sign out
              </button>
            </form>
          </>
        ) : (
          <Link href="/login" className="btn btn-secondary btn-small">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
