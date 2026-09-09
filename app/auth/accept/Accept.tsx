"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Turns whatever the auth service put in the URL into a session.
 *
 * Three shapes reach here, and all three have to work:
 *
 *   #access_token=…&refresh_token=…  An invitation verified by the auth
 *                                    service. Only the browser sees this.
 *   ?code=…                          PKCE, which /auth/confirm handles.
 *   ?token_hash=…&type=…             The older OTP link, likewise.
 *
 * The last two are forwarded rather than duplicated: one place decides what a
 * link means, and it is not this one.
 */
export function Accept() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const next = safeNext(query.get("next"));

    if (query.has("code") || query.has("token_hash")) {
      query.set("next", next);
      router.replace(`/auth/confirm?${query.toString()}`);
      return;
    }

    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = fragment.get("access_token");
    const refreshToken = fragment.get("refresh_token");

    if (!accessToken || !refreshToken) {
      setFailed(true);
      return;
    }

    // Clear the fragment before anything else can read it: it holds a live
    // session, and it should not survive in history or be carried anywhere by
    // a later navigation.
    window.history.replaceState(null, "", window.location.pathname);

    const supabase = createClient();
    void supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) {
          setFailed(true);
          return;
        }
        router.replace(next);
      });
  }, [router]);

  if (failed) {
    return (
      <p className="msg msg-error" role="alert">
        That invitation link is no longer valid. Ask whoever invited you to
        send another one.
      </p>
    );
  }

  return <p className="lede">One moment…</p>;
}

/** Same-origin paths only, so a crafted link cannot carry a session off-site. */
function safeNext(value: string | null): string {
  if (!value) return "/reset-password";
  return value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/reset-password";
}
