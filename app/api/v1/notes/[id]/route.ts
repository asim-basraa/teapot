import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readNote, deleteNote } from "@/lib/notes";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * One conversation.
 *
 * Somebody who is not in it gets an empty list rather than a refusal, which is
 * the same answer a conversation that does not exist gives. There is nothing to
 * learn from asking.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await params;
  return Response.json({ messages: await readNote(id) });
}

/**
 * Throws a conversation away.
 *
 * The rule about who may lives in the database, so this checks a session exists
 * and gets out of the way.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await params;
  const result = await deleteNote(id);

  return result.ok
    ? new Response(null, { status: 204 })
    : Response.json({ error: result.error }, { status: result.status });
}
