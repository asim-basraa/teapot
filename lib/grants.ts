import { createClient } from "@/lib/supabase/server";

export type GrantRole = "viewer" | "editor" | "admin";

export type EffectiveGrant = {
  grant_id: string;
  origin_node_id: string;
  origin_path: string;
  inherited: boolean;
  grantee_type: "user" | "team" | "public" | "authenticated";
  grantee_id: string | null;
  grantee_email: string | null;
  grantee_name: string | null;
  role: GrantRole;
};

export type GrantResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

export const ROLES: GrantRole[] = ["viewer", "editor", "admin"];

export function isRole(value: unknown): value is GrantRole {
  return typeof value === "string" && (ROLES as string[]).includes(value);
}

/**
 * Every grant reaching a node, including inherited ones and where they came
 * from.
 *
 * Goes through node_effective_grants rather than querying `grants` directly:
 * RLS on that table requires admin of the grant's own node, and an admin of a
 * child is not necessarily an admin of its parent, so inherited rows would be
 * invisible. The function is gated on admin of the node being asked about.
 */
export async function listEffectiveGrants(
  nodeId: string,
): Promise<EffectiveGrant[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("node_effective_grants", {
    p_node_id: nodeId,
  });
  return (data as EffectiveGrant[] | null) ?? [];
}

/**
 * Shares a node with the holder of an email address.
 *
 * The address is resolved inside the database, because profiles are private
 * and nothing running as the caller could look someone else up. See
 * grant_to_email: it checks admin before it looks at the address, so this
 * cannot be used to discover who has an account.
 */
export async function shareByEmail(
  nodeId: string,
  email: string,
  role: GrantRole,
): Promise<GrantResult> {
  const trimmed = email.trim();
  if (!trimmed) {
    return { ok: false, error: "An email address is required.", status: 400 };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("grant_to_email", {
    p_node_id: nodeId,
    p_email: trimmed,
    p_role: role,
  });

  if (!error) return { ok: true };

  // P0002 is raised for an address with no account. The caller already holds
  // admin here, so naming the problem is safe and useful.
  if (error.code === "P0002" && /no account exists/i.test(error.message)) {
    return {
      ok: false,
      error: `No Teapot account exists for ${trimmed}. They need to sign up first.`,
      status: 404,
    };
  }

  // Anything else, including "not admin", is reported as not-found so a
  // caller learns nothing about nodes they cannot administer.
  return { ok: false, error: "Not found.", status: 404 };
}

/**
 * Revokes a grant.
 *
 * No explicit permission check: RLS on `grants` already requires admin of the
 * grant's node, so a caller without it deletes nothing. Reporting that as
 * not-found keeps it consistent with reads.
 */
export async function revokeGrant(grantId: string): Promise<GrantResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("grants")
    .delete()
    .eq("id", grantId)
    .select("id");

  if (error) return { ok: false, error: error.message, status: 400 };
  if (!data || data.length === 0) {
    return { ok: false, error: "Not found.", status: 404 };
  }
  return { ok: true };
}

/**
 * Shares a node with everyone who has an account, or stops doing so.
 *
 * A third thing, distinct from both a named grantee and publishing. Passing
 * null withdraws it. The database refuses admin here: viewer and editor are
 * both things somebody might want for a whole organisation, but the power to
 * change who else can see a thing is not something anyone hands to "everyone"
 * on purpose.
 */
export async function setSharedWithEveryone(
  nodeId: string,
  role: GrantRole | null,
): Promise<GrantResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_shared_with_everyone", {
    p_node_id: nodeId,
    p_role: role,
  });

  if (!error) return { ok: true };

  if (/cannot confer admin/i.test(error.message)) {
    return {
      ok: false,
      error: "Everyone cannot be given admin.",
      status: 400,
    };
  }

  return { ok: false, error: "Not found.", status: 404 };
}

/**
 * Publishes or unpublishes a node.
 *
 * Through set_public rather than a client-side upsert: uniqueness for public
 * grants is a partial index, which PostgREST cannot name in an ON CONFLICT
 * clause. The function makes the same admin check RLS would, and a trigger
 * refuses any public grant stronger than viewer, on every write path.
 *
 * Publishing a folder publishes what is under it, because that is what
 * inheritance already means. There is no second rule here to drift from it.
 */
export async function setPublic(
  nodeId: string,
  isPublic: boolean,
): Promise<GrantResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_public", {
    p_node_id: nodeId,
    p_public: isPublic,
  });
  if (error) return { ok: false, error: "Not found.", status: 404 };
  return { ok: true };
}
