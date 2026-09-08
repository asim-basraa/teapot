import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listComments, addComment } from "@/lib/comments";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET(_request: NextRequest, { params }: Params) {
  // Comments require an account even on a published page, so an anonymous
  // caller is refused here as well as by the policy.
  if (!(await requireUser())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await params;
  return Response.json({ comments: await listComments(id) });
}

export async function POST(request: NextRequest, { params }: Params) {
  if (!(await requireUser())) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { body: text, parent_id: parentId } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof text !== "string") {
    return Response.json({ error: "A comment is required." }, { status: 400 });
  }

  const result = await addComment(
    id,
    text,
    typeof parentId === "string" && parentId ? parentId : null,
  );

  return result.ok
    ? Response.json({ comments: await listComments(id) }, { status: 201 })
    : Response.json({ error: result.error }, { status: result.status });
}
