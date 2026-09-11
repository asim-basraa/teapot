import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

export type McpToken = {
  id: string;
  name: string;
  space_id: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

export type CreateTokenResult =
  | { ok: true; token: string; record: McpToken }
  | { ok: false; error: string; status: number };

const SELECT =
  "id, name, space_id, expires_at, last_used_at, created_at, revoked_at";

/** How long a token may sit unused before the UI calls it forgotten. */
export const STALE_AFTER_DAYS = 60;

/**
 * Mints a token for the signed-in user.
 *
 * The plaintext is returned exactly once and never stored: only its SHA-256
 * hash goes to the database, so a leak there hands over nothing that can be
 * used. If showing it once turns out to be annoying, the answer is making
 * revoke-and-recreate easy, not keeping the secret around.
 *
 * 256 bits of entropy from the system CSPRNG, prefixed so a token found in a
 * log or a config file is recognisable for what it is and can be revoked.
 */
export async function createToken(input: {
  name: string;
  spaceId?: string | null;
  expiresAt?: string | null;
}): Promise<CreateTokenResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "A name is required.", status: 400 };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not found.", status: 404 };

  const token = `post_${randomBytes(32).toString("base64url")}`;
  const id = crypto.randomUUID();

  const { error } = await supabase.from("mcp_tokens").insert({
    id,
    user_id: user.id,
    name,
    token_hash: hashToken(token),
    space_id: input.spaceId ?? null,
    expires_at: input.expiresAt ?? null,
  });

  if (error) return { ok: false, error: "Not found.", status: 404 };

  const { data, error: readError } = await supabase
    .from("mcp_tokens")
    .select(SELECT)
    .eq("id", id)
    .single();

  if (readError) return { ok: false, error: "Not found.", status: 404 };

  return { ok: true, token, record: data as McpToken };
}

/**
 * The caller's own tokens.
 *
 * RLS restricts this to the owner, and the hash is not in the projection: there
 * is no screen anywhere that needs to show it, so it does not leave the
 * database.
 */
export async function listTokens(): Promise<McpToken[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("mcp_tokens")
    .select(SELECT)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  return (data as McpToken[] | null) ?? [];
}

/**
 * Revokes a token.
 *
 * Marked rather than deleted, so "this token was used at 3am from somewhere I
 * do not recognise" remains answerable after the token is turned off. It stops
 * working on the very next request either way, because resolve_mcp_token
 * ignores anything revoked.
 */
export async function revokeToken(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mcp_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null)
    .select("id");

  if (error) return { ok: false, error: error.message, status: 400 };
  if (!data || data.length === 0) {
    return { ok: false, error: "Not found.", status: 404 };
  }
  return { ok: true };
}

/** Must agree with resolve_mcp_token, which hashes the presented token in SQL. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Whether a token has gone long enough unused to be worth questioning. */
export function isStale(token: McpToken): boolean {
  const last = token.last_used_at ?? token.created_at;
  const age = Date.now() - new Date(last).getTime();
  return age > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
