import { createClient } from "@/lib/supabase/server";
import type { GrantResult, GrantRole } from "@/lib/grants";

export type Team = {
  id: string;
  space_id: string;
  name: string;
};

export type TeamMember = {
  user_id: string;
  email: string;
  display_name: string | null;
  role: "member" | "manager";
};

export type TeamResult =
  | { ok: true; team: Team }
  | { ok: false; error: string; status: number };

/**
 * Teams in a space that the caller can see.
 *
 * RLS decides: the space owner sees all of them, a member sees the ones they
 * belong to, and everyone else sees none. No filtering here.
 */
export async function listTeams(spaceId: string): Promise<Team[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("teams")
    .select("id, space_id, name")
    .eq("space_id", spaceId)
    .order("name");
  return data ?? [];
}

export async function createTeam(
  spaceId: string,
  name: string,
): Promise<TeamResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "A name is required.", status: 400 };

  const supabase = await createClient();

  // Same trick as createNode: RLS on `teams` requires owning the space, and an
  // INSERT ... RETURNING would apply the SELECT policy against the pre-insert
  // snapshot. Generating the id here lets the row be read back separately.
  const id = crypto.randomUUID();

  const { error } = await supabase
    .from("teams")
    .insert({ id, space_id: spaceId, name: trimmed });

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: `A team called "${trimmed}" already exists in this space.`,
        status: 409,
      };
    }
    // Anything else, a policy refusal included, reads as not-found so a caller
    // learns nothing about spaces they do not own.
    return { ok: false, error: "Not found.", status: 404 };
  }

  const { data, error: readError } = await supabase
    .from("teams")
    .select("id, space_id, name")
    .eq("id", id)
    .single();

  if (readError) return { ok: false, error: "Not found.", status: 404 };
  return { ok: true, team: data };
}

export async function deleteTeam(teamId: string): Promise<GrantResult> {
  const supabase = await createClient();
  // Grants naming this team go with it through ON DELETE CASCADE, so deleting a
  // team really does remove the access it conferred.
  const { data, error } = await supabase
    .from("teams")
    .delete()
    .eq("id", teamId)
    .select("id");

  if (error) return { ok: false, error: error.message, status: 400 };
  if (!data || data.length === 0) {
    return { ok: false, error: "Not found.", status: 404 };
  }
  return { ok: true };
}

/**
 * Who is on a team.
 *
 * Through team_roster rather than team_members directly: the RLS policy there
 * lets a member see only their own row, and joining to profiles for addresses
 * would return nothing at all, since a profile is private to its owner.
 */
export async function teamRoster(teamId: string): Promise<TeamMember[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("team_roster", { p_team_id: teamId });
  return (data as TeamMember[] | null) ?? [];
}

/**
 * Adds someone to a team by address.
 *
 * The address is resolved inside the database for the same reason sharing is:
 * profiles are private, and add_team_member is the controlled hole. It checks
 * ownership before it looks at the address, so this cannot be used to find out
 * who has an account.
 */
export async function addTeamMember(
  teamId: string,
  email: string,
  role: "member" | "manager" = "member",
): Promise<GrantResult> {
  const trimmed = email.trim();
  if (!trimmed) {
    return { ok: false, error: "An email address is required.", status: 400 };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_team_member", {
    p_team_id: teamId,
    p_email: trimmed,
    p_role: role,
  });

  if (!error) return { ok: true };

  if (error.code === "P0002" && /no account exists/i.test(error.message)) {
    return {
      ok: false,
      error: `No Teapot account exists for ${trimmed}. They need to sign up first.`,
      status: 404,
    };
  }

  return { ok: false, error: "Not found.", status: 404 };
}

export async function removeTeamMember(
  teamId: string,
  userId: string,
): Promise<GrantResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_team_member", {
    p_team_id: teamId,
    p_user_id: userId,
  });
  if (error) return { ok: false, error: "Not found.", status: 404 };
  return { ok: true };
}

/**
 * Shares a node with a team.
 *
 * Through grant_to_team rather than a client-side upsert: the uniqueness rule
 * on `grants` is a partial index, and inferring it needs an ON CONFLICT clause
 * carrying the same predicate, which PostgREST cannot express. The function
 * makes the same admin check RLS would, and the same-space trigger still runs.
 */
export async function shareWithTeam(
  nodeId: string,
  teamId: string,
  role: GrantRole,
): Promise<GrantResult> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("grant_to_team", {
    p_node_id: nodeId,
    p_team_id: teamId,
    p_role: role,
  });

  if (!error) return { ok: true };

  if (/own space/i.test(error.message)) {
    return {
      ok: false,
      error: "That team belongs to a different space.",
      status: 400,
    };
  }

  return { ok: false, error: "Not found.", status: 404 };
}
