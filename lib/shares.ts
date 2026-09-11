import { createClient } from "@/lib/supabase/server";

export type Share = {
  kind: "page" | "team";
  label: string;
  detail: string | null;
  href: string | null;
  role: string;
  actor: string | null;
  happened_at: string;
  is_new: boolean;
};

/**
 * What has been shared with the person asking, newest first.
 *
 * The gap this closes: sharing with somebody who has no account sends them an
 * email, because that is how they get in at all, and sharing with somebody who
 * already has one used to do nothing they could see. The grant landed and the
 * page was theirs to read, and they had no way of knowing.
 */
export async function listShares(): Promise<Share[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("shared_with_me");

  if (error) {
    console.error("shared_with_me failed: %s", error.message);
    return [];
  }
  return (data as Share[] | null) ?? [];
}

/** How many are new, for the count in the header. */
export async function countNewShares(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("new_share_count");

  if (error) {
    console.error("new_share_count failed: %s", error.message);
    return 0;
  }
  return (data as number | null) ?? 0;
}

export async function markSharesSeen(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_shares_seen");
  if (error) console.error("mark_shares_seen failed: %s", error.message);
}
