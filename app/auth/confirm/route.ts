import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Lands the confirmation and password-reset links sent by email.
 *
 * Supabase sends one of two shapes depending on the flow in play, and both
 * have to work:
 *
 *   ?code=...                  PKCE, which @supabase/ssr enables by default.
 *                              Exchanged with exchangeCodeForSession.
 *   ?token_hash=...&type=...   The older OTP link, still produced by some
 *                              email templates. Verified with verifyOtp.
 *
 * A failed or replayed link goes to a generic error rather than saying which.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/spaces";

  // Only same-origin paths, so a crafted link cannot bounce someone off-site
  // carrying a freshly minted session.
  const destination =
    next.startsWith("/") && !next.startsWith("//") ? next : "/spaces";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) redirect("/login?error=link");
    redirect(destination);
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error) redirect("/login?error=link");
    redirect(destination);
  }

  redirect("/login?error=link");
}
