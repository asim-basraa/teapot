import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import {
  isPlatformAdmin,
  setAdmin,
  setDisabled,
  deleteUser,
} from "@/lib/admin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * One account, as an administrator sees it.
 *
 * PATCH with `{ is_admin }` or `{ disabled }`. DELETE removes it, and is
 * refused while they still own a space.
 *
 * Everything here answers "not found" to somebody who is not an administrator,
 * for the same reason every other endpoint does: telling them the screen
 * exists and is merely closed to them is a fact worth withholding.
 */
async function refuse() {
  return Response.json({ error: "Not found." }, { status: 404 });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  if (!(await currentUser()) || !(await isPlatformAdmin())) return refuse();

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const fields = (body ?? {}) as Record<string, unknown>;

  if (typeof fields.is_admin === "boolean") {
    const result = await setAdmin(id, fields.is_admin);
    return result.ok
      ? Response.json({ ok: true })
      : Response.json({ error: result.error }, { status: result.status });
  }

  if (typeof fields.disabled === "boolean") {
    const result = await setDisabled(id, fields.disabled);
    return result.ok
      ? Response.json({ ok: true })
      : Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json(
    { error: "Say either is_admin or disabled." },
    { status: 400 },
  );
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  if (!(await currentUser()) || !(await isPlatformAdmin())) return refuse();

  const { id } = await params;
  const result = await deleteUser(id);

  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ error: result.error }, { status: result.status });
}
