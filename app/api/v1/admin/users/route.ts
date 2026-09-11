import { currentUser } from "@/lib/supabase/server";
import { listUsers } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * Everybody, with what they hold.
 *
 * No separate administrator check: the function behind this returns no rows to
 * anybody who is not one, so the empty list somebody else gets is the same
 * empty list they would get if there were nobody to show.
 */
export async function GET() {
  if (!(await currentUser())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  return Response.json({ users: await listUsers() });
}
