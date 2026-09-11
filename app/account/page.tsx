import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { listSpaces } from "@/lib/spaces";
import { listTokens } from "@/lib/mcp/tokens";
import { AppHeader } from "@/components/AppHeader";
import { isPlatformAdmin } from "@/lib/admin";
import { AuthForm } from "../(auth)/AuthForm";
import { changePassword } from "../(auth)/actions";

export const metadata = { title: "Your account" };
export const dynamic = "force-dynamic";

/**
 * Everything about you rather than about a space.
 *
 * There was nowhere to stand and see your own account: the connection settings
 * were reachable from one link in the body of the space list, and nothing at
 * all told you which account you were signed in as. Both are now in the header
 * of every page, and this is where that header leads.
 */
export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  // Sequential, not Promise.all: two Supabase calls dispatched together on one
  // request's client can each decide the session needs refreshing, and the one
  // that loses that race comes back empty rather than failing.
  const spaces = await listSpaces();
  const tokens = await listTokens();
  const admin = await isPlatformAdmin();

  const live = tokens.filter((token) => !token.revoked_at);

  return (
    <main className="shell">
      <AppHeader email={user.email} admin={admin} />

      <h1>Your account</h1>

      <section className="account-section">
        <h2>Signed in as</h2>
        <p className="account-identity">{user.email}</p>
        <p className="hint">
          Every page you can reach, and everything a connected Claude can reach
          on your behalf, is decided by this account and nothing else.
        </p>
      </section>

      <section className="account-section">
        <h2>Your spaces</h2>
        {spaces.length === 0 ? (
          <p className="empty">
            None yet. <Link href="/spaces">Create your first one.</Link>
          </p>
        ) : (
          <p>
            <Link href="/spaces">
              {spaces.length === 1
                ? "1 space you own or have been shared"
                : `${spaces.length} spaces you own or have been shared`}
            </Link>
          </p>
        )}
      </section>

      <section className="account-section">
        <h2>Claude</h2>
        <p>
          <Link href="/settings/mcp">Connect Post-it to Claude</Link>
        </p>
        <p className="hint">
          {live.length === 0
            ? "No connections yet. A token lets Claude read and write exactly what you can, and never more."
            : live.length === 1
              ? "One token in use. It reaches exactly what you can reach, and no more."
              : `${live.length} tokens in use. Each reaches exactly what you can reach, and no more.`}
        </p>
      </section>

      <section className="account-section">
        <h2>Change your password</h2>
        <AuthForm
          action={changePassword}
          submitLabel="Change password"
          fields={[
            {
              name: "password",
              label: "New password",
              type: "password",
              autoComplete: "new-password",
              hint: "At least 8 characters.",
            },
            {
              name: "confirm",
              label: "Confirm password",
              type: "password",
              autoComplete: "new-password",
            },
          ]}
        />
      </section>
    </main>
  );
}
