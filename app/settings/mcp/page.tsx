import Link from "next/link";
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

  const [tokens, spaces] = await Promise.all([listTokens(), listSpaces()]);

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";

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
