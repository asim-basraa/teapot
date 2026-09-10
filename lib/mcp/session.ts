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

/**
 * Turns a presented MCP token into a session that behaves like a signed-in user.
 *
 * The whole design rests on this one function. It resolves the token to an
 * account, obtains a Supabase access token for that account, and hands back a
 * client carrying it. Everything downstream is then an ordinary authenticated
 * request: RLS and the can_read family decide what is visible, exactly as they
 * do for the browser, and no tool has any filtering of its own to get wrong.
 *
 * The alternative, a service-role client plus hand-written filters, would be a
 * second authorization seam. That is precisely what this codebase exists to
 * avoid, so it is not on the table however convenient it looks. The service
 * role is used here only to ask Supabase for a user's session, never to read
 * or write content.
 *
 * Returns null for an unknown, revoked or expired token, without saying which.
 */
export async function resolveSession(
  token: string,
): Promise<McpSession | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;

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

  const accessToken = await accessTokenFor(userId, url);
  if (!accessToken) return null;

  const supabase = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  return { tokenId, userId, spaceId, supabase };
}

type CachedToken = { accessToken: string; expiresAt: number };

/**
 * Access tokens already obtained, by user.
 *
 * Minting one costs two round trips to the auth server and counts against its
 * rate limits, so doing it per request would be both slow and fragile. Held in
 * memory rather than in the database because it is a cache of something
 * reissuable, not a fact worth persisting: losing it on a restart costs one
 * round trip.
 */
const cache = new Map<string, CachedToken>();

/** Refresh a little before expiry, so a long call cannot outlive its token. */
const REFRESH_MARGIN_MS = 5 * 60_000;

/**
 * A Supabase access token for a user, minted by Supabase itself.
 *
 * Signing our own would mean holding the key that signs every token in the
 * project. Supabase has moved to asymmetric signing keys whose private half
 * never leaves their infrastructure, and the legacy shared secret it replaced
 * is verify-only and revocable. Asking the auth server for a session instead
 * means this keeps working across a key rotation, and means Postit never holds
 * signing material at all.
 *
 * The service role key is required and is used for nothing else.
 */
async function accessTokenFor(
  userId: string,
  url: string,
): Promise<string | null> {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return cached.accessToken;
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;

  const admin = createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile } = await admin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();

  const email = (profile as { email: string } | null)?.email;
  if (!email) return null;

  // generateLink returns the link rather than sending it, which is what makes
  // it usable here: no email is dispatched, and the token it yields is
  // exchanged immediately below and never leaves this process.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  const hashedToken = link?.properties?.hashed_token;
  if (linkError || !hashedToken) return null;

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const verifier = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: verified, error: verifyError } = await verifier.auth.verifyOtp({
    type: "magiclink",
    token_hash: hashedToken,
  });

  const session = verified?.session;
  if (verifyError || !session?.access_token) return null;

  cache.set(userId, {
    accessToken: session.access_token,
    expiresAt: (session.expires_at ?? 0) * 1000,
  });

  return session.access_token;
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

/** Test seam: the cache is process-global, and a suite needs a clean slate. */
export function clearSessionCache(): void {
  cache.clear();
}
