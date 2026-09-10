import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listSpaces } from "@/lib/spaces";
import { listTokens } from "@/lib/mcp/tokens";
import { signOut } from "../../(auth)/actions";
import { Tokens } from "./Tokens";

export const metadata = { title: "Connect to Claude" };
export const dynamic = "force-dynamic";

export default async function McpSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Sequential, not Promise.all. Two Supabase calls dispatched together on one
  // request's client can each decide the session needs refreshing, and refresh
  // tokens rotate: the loser goes out unauthenticated and comes back empty
  // rather than failing. An empty list of tokens is not a visible error.
  const tokens = await listTokens();
  const spaces = await listSpaces();

  // From the request rather than from configuration. The address in these
  // snippets has to be the one you reached this page on: a misconfigured
  // NEXT_PUBLIC_SITE_URL would otherwise hand somebody a config pointing at
  // the wrong Teapot, which fails as an authentication error and reads like a
  // bad token.
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  const base = host
    ? `${proto}://${host}`
    : (process.env.NEXT_PUBLIC_SITE_URL ?? "");

  return (
    <main className="shell">
      <header className="shell-header">
        <Link href="/spaces" className="shell-brand">
          Teapot
        </Link>
        <form action={signOut}>
          <button className="btn btn-secondary btn-small" type="submit">
            Sign out
          </button>
        </form>
      </header>

      <h1>Connect Teapot to Claude</h1>
      <p className="lede">
        A token lets Claude read and write your Teapot through the MCP server.
        It acts as you and can reach exactly what you can reach, never more.
      </p>

      <Tokens
        initialTokens={tokens}
        spaces={spaces.map((s) => ({ id: s.id, name: s.name }))}
        endpoint={`${base}/api/mcp`}
      />
    </main>
  );
}
