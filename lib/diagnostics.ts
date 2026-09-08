export type Check = {
  key: string;
  value: string;
  ok: boolean;
};

/** True when the value is present and not an empty string. */
function present(v: string | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Reports whether a secret is configured without ever revealing it.
 * Only the presence and length are surfaced.
 */
function secretStatus(v: string | undefined): Check["value"] {
  return present(v) ? `set (${v!.length} chars)` : "missing";
}

/**
 * Hits Supabase's unauthenticated auth health endpoint. This proves the URL
 * and the anon key are both correct, which a mere presence check cannot.
 */
async function pingSupabase(
  url: string | undefined,
  anonKey: string | undefined,
): Promise<Check> {
  if (!present(url) || !present(anonKey)) {
    return {
      key: "Supabase reachable",
      value: "skipped (url or key missing)",
      ok: false,
    };
  }

  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anonKey! },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return {
      key: "Supabase reachable",
      value: res.ok ? `yes (HTTP ${res.status})` : `no (HTTP ${res.status})`,
      ok: res.ok,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return { key: "Supabase reachable", value: `no (${reason})`, ok: false };
  }
}

export async function collectDiagnostics(): Promise<{
  environment: Check[];
  supabase: Check[];
  build: Check[];
  allOk: boolean;
}> {
  const env = process.env;

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const environment: Check[] = [
    {
      key: "Environment",
      value: env.RAILWAY_ENVIRONMENT_NAME ?? env.NEXT_PUBLIC_APP_ENV ?? "local",
      ok: true,
    },
    {
      key: "Region",
      value: env.RAILWAY_REPLICA_REGION ?? "n/a (not on Railway)",
      ok: true,
    },
    {
      key: "Site URL",
      value: env.NEXT_PUBLIC_SITE_URL ?? "unset",
      ok: present(env.NEXT_PUBLIC_SITE_URL),
    },
    { key: "Node", value: process.version, ok: true },
  ];

  const supabase: Check[] = [
    {
      key: "NEXT_PUBLIC_SUPABASE_URL",
      value: supabaseUrl ?? "missing",
      ok: present(supabaseUrl),
    },
    {
      key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      value: secretStatus(anonKey),
      ok: present(anonKey),
    },
    {
      // Used for one thing only: asking Supabase for a user's session when an
      // MCP token is presented. Without it the MCP endpoint refuses everything.
      key: "SUPABASE_SERVICE_ROLE_KEY",
      value: secretStatus(env.SUPABASE_SERVICE_ROLE_KEY),
      ok: present(env.SUPABASE_SERVICE_ROLE_KEY),
    },
    await pingSupabase(supabaseUrl, anonKey),
  ];

  const build: Check[] = [
    {
      key: "Commit",
      value: (env.RAILWAY_GIT_COMMIT_SHA ?? "local").slice(0, 12),
      ok: true,
    },
    { key: "Branch", value: env.RAILWAY_GIT_BRANCH ?? "local", ok: true },
    { key: "Rendered at", value: new Date().toISOString(), ok: true },
  ];

  const allOk = [...environment, ...supabase, ...build].every((c) => c.ok);

  return { environment, supabase, build, allOk };
}
