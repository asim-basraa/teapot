import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { GrantRole } from "@/lib/grants";

export type InviteResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * Invites somebody who does not have an account to a node.
 *
 * Sign-up is invitation-only, so sharing with an address that has never signed
 * up used to be a dead end: the sharer was told the person had no account, and
 * the person could not make one. This is the door.
 *
 * Two steps, in this order and no other. The invitation row goes in first
 * because it is what authorises the address to exist at all — the
 * before-user-created hook reads it — and the account is created second,
 * through the auth service, so that the email is the one Supabase already
 * sends over the SMTP that is already configured. Post-it sends no mail itself
 * and holds no template.
 *
 * Whether the caller may do any of this is decided by invite_to_node, which
 * requires admin of the node and reports anything else as not-found.
 */
export async function inviteToNode(
  nodeId: string,
  email: string,
  role: GrantRole,
): Promise<InviteResult> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("invite_to_node", {
    p_node_id: nodeId,
    p_email: email,
    p_role: role,
  });

  if (error) {
    if (/not an email address/i.test(error.message)) {
      return { ok: false, error: "That is not an email address.", status: 400 };
    }
    return { ok: false, error: "Not found.", status: 404 };
  }

  let inviteError: { message: string } | null = null;
  try {
    const admin = createAdminClient();
    ({ error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      // Not /auth/confirm: the auth service verifies an invitation itself and
      // hands the session back in the URL fragment, which the server never
      // sees. /auth/accept is the browser-side landing that can read it.
      // Setting a password is the first thing they need, so that is where it
      // leads.
      redirectTo: `${siteUrl()}/auth/accept?next=/reset-password`,
    }));
  } catch {
    // No service-role key configured. The invitation row is written either
    // way, so the address can still sign up; what is missing is the email
    // telling them to.
    return {
      ok: false,
      error:
        "The invitation was recorded but no email could be sent. Ask an administrator to set SUPABASE_SERVICE_ROLE_KEY.",
      status: 500,
    };
  }

  if (!inviteError) return { ok: true };

  // The address already has an unconfirmed account: somebody invited them
  // before, or they started signing up and never finished. The invitation row
  // is in place and the grant will be made when they arrive, so this is not a
  // failure to report as one.
  if (/already been registered|already exists/i.test(inviteError.message)) {
    return { ok: true };
  }

  return {
    ok: false,
    error: `Could not send an invitation to ${email}. ${inviteError.message}`,
    status: 502,
  };
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}
