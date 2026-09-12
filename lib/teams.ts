import { createClient } from "@/lib/supabase/server";
import type { GrantResult, GrantRole } from "@/lib/grants";

export type Team = {
  id: string;
  space_id: string;
  name: string;
};

/** A team a particular node could be handed to, for the sharing dialog. */
export type GrantableTeam = {
  team_id: string;
  team_name: string;
  space_name: string;
  /** False when the team belongs to another space, which the picker says out loud. */
  same_space: boolean;
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

/**
 * The teams this node could be shared with.
 *
 * Node-scoped rather than space-scoped, which is the whole point: a team you
 * are on is a team you can hand something to, wherever it was defined. The
 * database decides, so the picker cannot offer something the grant would then
 * refuse.
 */
export async function grantableTeams(
  nodeId: string,
): Promise<GrantableTeam[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("grantable_teams", {
    p_node_id: nodeId,
  });

  if (error) {
    console.error("grantable_teams failed: %s", error.message);
    return [];
  }
  return (data as GrantableTeam[] | null) ?? [];
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
 * Who is on a team: the space owner or anybody on the team may ask.
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
      error: `No Post-it account exists for ${trimmed}. They need to sign up first.`,
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
 * makes the same admin check RLS would, and the trigger that decides whether
 * this team is yours to name still runs.
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

  // A team belonging to another space is fine now. Naming one you have nothing
  // to do with is not, and saying so plainly is better than not-found here: the
  // picker only ever offers teams you can see, so anybody hitting this reached
  // past it and is owed a straight answer.
  if (/not yours to share with|no such team/i.test(error.message)) {
    return {
      ok: false,
      error: "That team is not one of yours.",
      status: 403,
    };
  }

  return { ok: false, error: "Not found.", status: 404 };
}

export type TeamReach = {
  node_id: string;
  label: string;
  href: string;
  role: GrantRole;
  space_name: string;
};

export type MyTeam = {
  team_id: string;
  team_name: string;
  space_name: string;
  space_slug: string;
  my_role: "member" | "manager";
  member_count: number;
  reach_count: number;
  added_at: string;
  added_by: string | null;
};

/**
 * What a team reaches: the pages and folders shared with it.
 *
 * The space owner and the team's own members both get an answer; anybody else
 * gets an empty list, which is the same thing they would get for a team that
 * does not exist.
 */
export async function teamReach(teamId: string): Promise<TeamReach[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("team_reach", { p_team_id: teamId });
  return (data as TeamReach[] | null) ?? [];
}

/** The teams the caller is on, across every space. */
export async function myTeams(): Promise<MyTeam[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_teams");
  if (error) {
    console.error("my_teams failed: %s", error.message);
    return [];
  }
  return (data as MyTeam[] | null) ?? [];
}

/**
 * Everything all of the caller's teams reach, keyed by team.
 *
 * One call rather than one per team: the page groups the rows itself.
 */
export async function myTeamReach(): Promise<Map<string, TeamReach[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_team_reach");
  if (error) {
    console.error("my_team_reach failed: %s", error.message);
    return new Map();
  }

  const byTeam = new Map<string, TeamReach[]>();
  for (const row of (data as (TeamReach & { team_id: string })[] | null) ?? []) {
    const list = byTeam.get(row.team_id);
    if (list) list.push(row);
    else byTeam.set(row.team_id, [row]);
  }
  return byTeam;
}
