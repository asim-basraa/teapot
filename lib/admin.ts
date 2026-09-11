import { createClient, createAdminClient } from "@/lib/supabase/server";

export type AdminUser = {
  id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  disabled: boolean;
  spaces: number;
  articles: number;
  skills: number;
  folders: number;
  content_bytes: number;
  history_bytes: number;
};

export type OwnedSpace = { id: string; slug: string; name: string };

export type AdminResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/** Whether the person asking administers the platform. */
export async function isPlatformAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) {
    console.error("is_platform_admin failed: %s", error.message);
    return false;
  }
  return data === true;
}

/**
 * Everybody, with what they hold rather than what they wrote.
 *
 * Empty for anybody who is not an administrator, because the function behind
 * it returns no rows rather than refusing. There is nothing to check here that
 * the database has not already checked, and a second check in front of it
 * would be a second answer to the same question.
 */
export async function listUsers(): Promise<AdminUser[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_users");
  if (error) {
    console.error("admin_users failed: %s", error.message);
    return [];
  }
  return (data as AdminUser[] | null) ?? [];
}

export async function listOwnedSpaces(userId: string): Promise<OwnedSpace[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_user_spaces", {
    p_user_id: userId,
  });
  if (error) {
    console.error("admin_user_spaces failed: %s", error.message);
    return [];
  }
  return (data as OwnedSpace[] | null) ?? [];
}

export async function setAdmin(
  userId: string,
  isAdmin: boolean,
): Promise<AdminResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_admin", {
    p_user_id: userId,
    p_is_admin: isAdmin,
  });

  if (error) {
    // The last-administrator guard says something worth reading; everything
    // else is the usual not-found.
    return error.message.includes("administer")
      ? { ok: false, error: "Somebody has to be able to administer this.", status: 409 }
      : { ok: false, error: "Not found.", status: 404 };
  }
  return { ok: true };
}

export async function transferSpace(
  spaceId: string,
  newOwnerId: string,
): Promise<AdminResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_transfer_space", {
    p_space_id: spaceId,
    p_new_owner: newOwnerId,
  });

  return error ? { ok: false, error: "Not found.", status: 404 } : { ok: true };
}

/**
 * Stops somebody signing in, without touching anything they hold.
 *
 * Their spaces, pages and grants are all exactly as they were, and undoing it
 * puts them back with nothing to restore. That is the difference between this
 * and deleting, and it is the one an administrator wants nine times in ten:
 * somebody has left, and nobody is yet sure what of theirs matters.
 *
 * Through the auth admin API rather than by writing to auth.users, because the
 * ban is GoTrue's own state and reaching into its table would be a second
 * implementation of a rule it already has.
 */
export async function setDisabled(
  userId: string,
  disabled: boolean,
): Promise<AdminResult> {
  if (!(await isPlatformAdmin())) {
    return { ok: false, error: "Not found.", status: 404 };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    // A hundred years, which is off rather than a date anybody is waiting for.
    ban_duration: disabled ? "876000h" : "none",
  });

  if (error) {
    console.error("banning %s failed: %s", userId, error.message);
    return { ok: false, error: "That did not work.", status: 500 };
  }
  return { ok: true };
}

/**
 * Removes an account.
 *
 * Refused while they still own a space. The database refuses it too, with a
 * trigger, because the consequence is the one that cannot be undone: an
 * account cascades to its profile, a profile to its spaces, and a space to
 * every page in it, so one delete would otherwise take a team's writing with
 * it. This check exists to say something useful; the trigger exists so that
 * forgetting to check is not catastrophic.
 */
export async function deleteUser(userId: string): Promise<AdminResult> {
  if (!(await isPlatformAdmin())) {
    return { ok: false, error: "Not found.", status: 404 };
  }

  const owned = await listOwnedSpaces(userId);
  if (owned.length > 0) {
    return {
      ok: false,
      error: `This account still owns ${owned.length === 1 ? "a space" : `${owned.length} spaces`}. Give ${owned.length === 1 ? "it" : "them"} to somebody else first.`,
      status: 409,
    };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);

  if (error) {
    console.error("deleting %s failed: %s", userId, error.message);
    return { ok: false, error: "That did not work.", status: 500 };
  }
  return { ok: true };
}
