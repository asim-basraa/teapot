import { createHmac, timingSafeEqual } from "node:crypto";
import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

export type McpSession = {
  tokenId: string;
  userId: string;
  /** Non-null when the token was pinned to a single space at creation. */
  spaceId: string | null;
  /** A Supabase client acting as the token's owner, with RLS applied. */
  supabase: SupabaseClient;
};

/** How long a minted access token lives. Short, because it is trivial to remint. */
const TOKEN_TTL_SECONDS = 300;

/**
 * Turns a presented MCP token into a session that behaves like a signed-in user.
 *
 * The whole design rests on this one function. It resolves the token to an
 * account, mints a Supabase access token for that account, and hands back a
 * client carrying it. Everything downstream is then an ordinary authenticated
 * request: RLS and the can_read family decide what is visible, exactly as they
 * do for the browser, and no tool has any filtering of its own to get wrong.
 *
 * The alternative, a service-role client plus hand-written filters, would be a
 * second authorization seam. That is precisely what this codebase exists to
 * avoid, so it is not on the table however convenient it looks.
 *
 * Returns null for an unknown, revoked or expired token, without saying which.
 */
export async function resolveSession(
  token: string,
): Promise<McpSession | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_JWT_SECRET;

  if (!url || !anonKey || !secret) return null;

  // Resolved through a SECURITY DEFINER function that hashes the token itself,
  // so a leaked database yields hashes this refuses rather than usable keys.
  const anon = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await anon.rpc("resolve_mcp_token", {
    p_token: token,
  });

  if (error) return null;

  const rows = (data ?? []) as {
    token_id: string;
    user_id: string;
    space_id: string | null;
  }[];
  if (rows.length === 0) return null;

  const { token_id: tokenId, user_id: userId, space_id: spaceId } = rows[0];

  const accessToken = signAccessToken(userId, url, secret);

  const supabase = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  return { tokenId, userId, spaceId, supabase };
}

/**
 * Mints a Supabase access token for a user.
 *
 * Signed with the project's JWT secret, which is the mechanism Supabase
 * provides for exactly this: a server that has already established who the
 * caller is needs to speak to PostgREST as them. The token is short-lived and
 * never leaves this process.
 */
function signAccessToken(userId: string, url: string, secret: string): string {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    iss: `${url.replace(/\/$/, "")}/auth/v1`,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };

  const body = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(payload),
  )}`;

  const signature = createHmac("sha256", secret).update(body).digest("base64url");

  return `${body}.${signature}`;
}

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/**
 * The bearer token on a request, if there is one.
 *
 * Accepts only the Authorization header. A token in a query string ends up in
 * access logs, browser history and referer headers, which is a poor place for a
 * long-lived credential to live.
 */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Constant-time comparison, for anywhere a secret is compared in this process.
 *
 * Not used on the token itself, which is compared inside Postgres by hash, but
 * exported so that anything added later has an obvious right answer to hand.
 */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
