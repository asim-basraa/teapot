import type { NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { allow, callerAddress } from "@/lib/mcp/rate-limit";

export const dynamic = "force-dynamic";

/** Longer than a joke, shorter than an essay. */
const LIMIT = 2000;

/** Notes one address may send in a window. Enough for a person, not a script. */
const PER_WINDOW = 5;

/**
 * A note from the front page.
 *
 * Deliberately open to anybody, because the front page is: asking somebody to
 * make an account before they can tell you something is asking for the thing
 * after the thing you wanted.
 *
 * Which is why everything here is about bounding it. A length cap, a throttle
 * per address, and a database function that only the service role may call, so
 * this endpoint is the only door rather than one of two.
 *
 * The one thing it now does beyond sending: if somebody is signed in, the note
 * is attributed to them, which is what makes a reply possible. Sending stays
 * exactly as open as it was — nobody is asked to sign in — but the two outcomes
 * are genuinely different, so the response says which one happened rather than
 * letting the page guess.
 */
export async function POST(request: NextRequest) {
  if (!allow(`inbox:${callerAddress(request)}`, PER_WINDOW)) {
    return Response.json(
      { error: "That is a lot of notes. Try again in a minute." },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const message = (body as Record<string, unknown>)?.message;
  if (typeof message !== "string" || message.trim() === "") {
    return Response.json({ error: "Say something first." }, { status: 400 });
  }
  if (message.length > LIMIT) {
    return Response.json(
      { error: `Keep it under ${LIMIT} characters.` },
      { status: 400 },
    );
  }

  // Read on this request's own cookies, so the sender is whoever the session
  // actually belongs to. The admin client below cannot be asked: to it, every
  // caller is the service role and nobody in particular.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    console.error("inbox: no service role key configured");
    return Response.json({ error: "That did not send." }, { status: 500 });
  }

  const { error } = await admin.rpc("send_note", {
    p_message: message,
    p_sender_id: user?.id ?? null,
  });

  if (error) {
    console.error("send_note failed: %s", error.message);
    return Response.json({ error: "That did not send." }, { status: 500 });
  }

  // `threaded` is the honest difference: an attributed note can be answered and
  // an anonymous one cannot, and somebody who just sent one deserves to know
  // which they did before they wait for a reply that is never coming.
  return Response.json({ ok: true, threaded: Boolean(user) });
}
