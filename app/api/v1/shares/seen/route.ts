import { currentUser } from "@/lib/supabase/server";
import { markSharesSeen } from "@/lib/shares";

export const dynamic = "force-dynamic";

/**
 * Marks everything shared with the caller as seen.
 *
 * Posted by the page that shows the list, once it has been shown. Doing it
 * server-side while rendering would mark things seen that were never on
 * screen, because a render is not a reading.
 */
export async function POST() {
  if (!(await currentUser())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  await markSharesSeen();
  return Response.json({ ok: true });
}
