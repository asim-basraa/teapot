import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { replyToNote } from "@/lib/notes";
import { allow, callerAddress } from "@/lib/mcp/rate-limit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Replies one address may send in a window. A conversation, not a flood. */
const PER_WINDOW = 20;

/**
 * Answering a note.
 *
 * Who may answer whom is decided in the database, by the same function for both
 * sides of the conversation, so there is no rule here to drift out of step with
 * it. This checks that somebody is signed in, throttles, and gets out of the way.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  if (!allow(`reply:${callerAddress(request)}`, PER_WINDOW)) {
    return Response.json(
      { error: "That is a lot of replies. Try again in a minute." },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const message = (body as Record<string, unknown>)?.message;
  if (typeof message !== "string") {
    return Response.json({ error: "Say something first." }, { status: 400 });
  }

  const result = await replyToNote(id, message);
  return result.ok
    ? Response.json({ ok: true }, { status: 201 })
    : Response.json({ error: result.error }, { status: result.status });
}
