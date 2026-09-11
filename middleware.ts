import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session on every request.
 *
 * Server components cannot write cookies, so without this an expiring token
 * would never be renewed and users would be silently logged out mid-session.
 *
 * This does no authorization. Route protection lives in the pages themselves,
 * because middleware runs before we know which node is being asked for and
 * `can_read` is per-node.
 */
export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Supabase falls back to the project's Site URL when the requested redirect
  // is not on its allow list, which drops an auth code on the landing page
  // where nothing handles it. Forward it to the route that does, so a
  // misconfigured redirect list degrades to a working login rather than a
  // dead end.
  if (pathname === "/" && searchParams.has("code")) {
    const target = request.nextUrl.clone();
    target.pathname = "/auth/confirm";
    return NextResponse.redirect(target);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser revalidates the token with Supabase. getSession would only read
  // the cookie, which a client can forge.
  await supabase.auth.getUser();

  // Every page here depends on who is asking: the same address returns a
  // document to one person and a 404 to the next. A response like that must
  // never be stored, by a shared cache or by the browser that received it.
  // Static assets are outside this matcher and keep their own caching.
  response.headers.set(
    "cache-control",
    "private, no-store, max-age=0, must-revalidate",
  );

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
