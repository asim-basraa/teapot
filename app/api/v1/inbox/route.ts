import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
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
 * this endpoint is the only door rather than one of two. The note is quoted
 * line by line when it lands, and the renderer sanitises HTML on the way out,
 * so nothing sent here can rearrange the page it arrives on.
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

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    console.error("inbox: no service role key configured");
    return Response.json({ error: "That did not send." }, { status: 500 });
  }

  const { error } = await admin.rpc("append_to_inbox", {
    p_message: message,
  });

  if (error) {
    console.error("append_to_inbox failed: %s", error.message);
    return Response.json({ error: "That did not send." }, { status: 500 });
  }

  return Response.json({ ok: true });
}
