import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { revokeGrant } from "@/lib/grants";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, { params }: Params) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await params;
  const result = await revokeGrant(id);

  return result.ok
    ? new Response(null, { status: 204 })
    : Response.json({ error: result.error }, { status: result.status });
}
