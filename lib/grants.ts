import { createClient } from "@/lib/supabase/server";
import type { Visibility } from "@/lib/visibility";
import { inviteToNode } from "@/lib/invitations";

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
  | { ok: true; invited?: boolean }
  | { ok: false; error: string; status: number };

export const ROLES: GrantRole[] = ["viewer", "editor", "admin"];

export function isRole(value: unknown): value is GrantRole {
  return typeof value === "string" && (ROLES as string[]).includes(value);
}

// Re-exported so callers that already have grants in hand do not need to know
// that the pure half lives apart from the half that talks to the database.
export type { Visibility };
export {
  isVisibility,
  readVisibility,
  readInheritedVisibility,
} from "@/lib/visibility";

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
 *
 * An address with no account is invited rather than refused. Sign-up here is
 * invitation-only, so refusing left the sharer holding an address that could
 * never become an account: the person could not sign up, and nothing in the
 * interface let anyone invite them. The invitation carries the grant, so they
 * arrive at the thing they were shared rather than at an empty list of spaces.
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

  // P0002 is raised for an address with no account, and only after the admin
  // check has passed, so the caller is not a stranger fishing for addresses.
  if (error.code === "P0002" && /no account exists/i.test(error.message)) {
    const invited = await inviteToNode(nodeId, trimmed, role);
    if (!invited.ok) return invited;

    // The account exists now, so the grant can be made the ordinary way. The
    // trigger that runs on account creation has usually made it already; this
    // is the same upsert, and it means the answer does not depend on which of
    // the two got there first.
    await supabase.rpc("grant_to_email", {
      p_node_id: nodeId,
      p_email: trimmed,
      p_role: role,
    });

    return { ok: true, invited: true };
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
 * Sets how far a node reaches, in one write.
 *
 * One call rather than two, because it is one decision. Setting it through
 * separate publish and share-with-everyone writes leaves a window in which a
 * node is both, and leaves the reader to assemble the answer to "who can see
 * this" from two controls that can disagree.
 */
export async function setVisibility(
  nodeId: string,
  visibility: Visibility,
  role: GrantRole | null,
): Promise<GrantResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_node_visibility", {
    p_node_id: nodeId,
    p_visibility: visibility,
    p_role: visibility === "everyone" ? (role ?? "viewer") : null,
  });

  if (!error) return { ok: true };

  if (/cannot confer admin/i.test(error.message)) {
    return { ok: false, error: "Everyone cannot be given admin.", status: 400 };
  }

  return { ok: false, error: "Not found.", status: 404 };
}
