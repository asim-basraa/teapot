import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for server components and route handlers.
 *
 * Carries the caller's session, so every query it makes runs under that
 * user's RLS policies. This is the client almost everything should use: it
 * cannot see more than the person it is acting for.
 *
 * Memoized for the lifetime of one request. That is not a micro-optimisation:
 * a page render reads the space, the node, the viewer's capabilities, the
 * backlinks and the comments, and a separate client for each meant several
 * independent attempts to refresh the same session. Refresh tokens rotate, and
 * a server component cannot write the new one back to the cookie, so whichever
 * client refreshed second was left holding a token that had just been
 * invalidated and reported no user at all. Intermittently, and only ever for
 * the parts of the page whose existence depends on knowing who is reading.
 */
export const createClient = cache(async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server components cannot set cookies. Session refresh happens in
            // middleware instead, so swallowing this is correct rather than
            // merely convenient.
          }
        },
      },
    },
  );
});

/**
 * Who is asking, or null.
 *
 * getUser revalidates the token with the auth server rather than trusting the
 * cookie, so it is a network round trip and worth doing exactly once per
 * request. Memoized for the same reason the client is, and it is the only way
 * anything should ask this question.
 */
export const currentUser = cache(async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only for work that legitimately has no user behind it: signing storage URLs
 * after an explicit can_read check, and administrative flows. Never hand this
 * client a request-shaped query and never let it reach a client component.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}
