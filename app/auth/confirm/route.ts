import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Lands the confirmation and password-reset links sent by email.
 *
 * Exchanges the one-time token for a session, then forwards the visitor on.
 * A failed or replayed link goes to a generic error page rather than saying
 * why it failed.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/spaces";

  // Only same-origin paths, so a crafted link cannot bounce someone off-site
  // carrying a freshly minted session.
  const destination = next.startsWith("/") && !next.startsWith("//")
    ? next
    : "/spaces";

  if (!tokenHash || !type) {
    redirect("/login?error=link");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });

  if (error) {
    redirect("/login?error=link");
  }

  redirect(destination);
}
