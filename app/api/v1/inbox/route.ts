import type { NextRequest } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { allow, callerAddress } from "@/lib/mcp/rate-limit";

export const dynamic = "force-dynamic";

/** Longer than a joke, shorter than an essay. */
const LIMIT = 2000;

/** Notes one address may send in a window. Enough for a person, not a script. */
const PER_WINDOW = 5;

/**
 * A note to the inbox owner.
 *
 * It used to be open to anybody, on the grounds that asking somebody to make an
 * account before they can tell you something is asking for the thing after the
 * thing you wanted. That was right about the cost and wrong about the result: a
 * note from nobody cannot be answered, so every anonymous joke arrived as a
 * conversation with one participant and a dead end where the reply goes.
 *
 * A session is required now. The trade is deliberate: fewer notes, and every one
 * of them can be replied to.
 *
 * The rest is unchanged and still worth having, because a signed-in caller is
 * not a trusted one. A length cap, a throttle per address, and a database
 * function only the service role may call, so this endpoint is the only door.
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

  if (!user) {
    return Response.json(
      { error: "Sign in first, so I have somewhere to reply." },
      { status: 401 },
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    console.error("inbox: no service role key configured");
    return Response.json({ error: "That did not send." }, { status: 500 });
  }

  const { error } = await admin.rpc("send_note", {
    p_message: message,
    p_sender_id: user.id,
  });

  if (error) {
    console.error("send_note failed: %s", error.message);
    return Response.json({ error: "That did not send." }, { status: 500 });
  }

  return Response.json({ ok: true });
}

/**
 * Whether the caller can send at all.
 *
 * Asked when the box opens rather than when it is submitted, so somebody who
 * needs to sign in is told before they write a joke rather than after. Kept on
 * this route because "can I send" is a question about sending; a session check
 * of its own would be a second place for the answer to drift.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return Response.json({ canSend: Boolean(user) });
}
