import Link from "next/link";
import { Accept } from "./Accept";

export const metadata = { title: "Accepting your invitation" };

/**
 * Where an invitation link lands.
 *
 * It cannot be a route handler like /auth/confirm, and that is the whole
 * reason this exists. An invitation is verified by the auth service itself,
 * which returns the session in the URL *fragment* — and a fragment never
 * reaches the server, so nothing running there can see it. Only the browser
 * can, so the work happens in the browser.
 */
export default function AcceptPage() {
  return (
    // The same frame as the sign-in pages, which this sits between.
    <main className="auth">
      <Link href="/" className="auth-brand">
        Post-it
      </Link>
      <div className="auth-card">
        <h1>Accepting your invitation</h1>
        <Accept />
      </div>
    </main>
  );
}
