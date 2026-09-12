import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readNote } from "@/lib/notes";

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
