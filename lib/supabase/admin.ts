import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * A client that bypasses row-level security.
 *
 * Two callers, both narrow: minting a session for an MCP token, and creating
 * an account for somebody who has been invited. Neither reads or writes
 * content — every content operation in Teapot runs as the person making it, so
 * that RLS is the one place access is decided.
 *
 * Null when the key is absent, so a misconfigured deployment degrades to the
 * feature not working rather than to a crash on an unrelated page.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
