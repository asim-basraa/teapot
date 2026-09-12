import { createClient } from "@/lib/supabase/server";

/**
 * Who is in a space.
 *
 * Distinct from who has been shared something in it, which is what `grants`
 * records. Sharing answers "this page, this person"; membership answers "you
 * work here", and confers the whole space to read and to change.
 */
export type SpaceMember = {
  member_row_id: string;
  member_type: "user" | "team";
  member_id: string;
  /** An address for a person, a name for a team. */
  label: string;
  added_at: string;
};

export type MemberResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/** Everybody in the space. Empty for anybody who is not in it themselves. */
export async function spaceRoster(spaceId: string): Promise<SpaceMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("space_roster", {
    p_space_id: spaceId,
  });

  if (error) {
    console.error("space_roster failed: %s", error.message);
    return [];
  }
  return (data as SpaceMember[] | null) ?? [];
}

export async function addSpaceMember(
  spaceId: string,
  email: string,
): Promise<MemberResult> {
  const trimmed = email.trim();
  if (!trimmed) {
    return { ok: false, error: "An email address is required.", status: 400 };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_space_member", {
    p_space_id: spaceId,
    p_email: trimmed,
  });

  if (!error) return { ok: true };

  if (/no account exists/i.test(error.message)) {
    return {
      ok: false,
      error: `No Post-it account exists for ${trimmed}. They need to sign up first.`,
      status: 404,
    };
  }

  // Worth saying rather than hiding: somebody trying to add the owner has made
  // a harmless mistake, and "not found" would send them looking for a typo.
  if (/already the owner/i.test(error.message)) {
    return {
      ok: false,
      error: "They own this space, so they are already in it.",
      status: 409,
    };
  }

  return { ok: false, error: "Not found.", status: 404 };
}

export async function addSpaceTeam(
  spaceId: string,
  teamId: string,
): Promise<MemberResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_space_team", {
    p_space_id: spaceId,
    p_team_id: teamId,
  });

  if (!error) return { ok: true };

  if (/not yours to share with/i.test(error.message)) {
    return { ok: false, error: "That team is not one of yours.", status: 403 };
  }
  return { ok: false, error: "Not found.", status: 404 };
}

export async function removeSpaceMember(
  memberRowId: string,
): Promise<MemberResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remove_space_member", {
    p_member_row_id: memberRowId,
  });

  if (error) return { ok: false, error: "Not found.", status: 404 };
  if (data !== true) return { ok: false, error: "Not found.", status: 404 };
  return { ok: true };
}
