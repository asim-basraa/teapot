import type { EffectiveGrant, GrantRole } from "@/lib/grants";

/**
 * How far a node reaches.
 *
 * Three answers to one question, and they are exclusive: choosing one
 * withdraws the others. "everyone" and "public" are not the same thing, and
 * that difference is the product — everybody at your organisation is not
 * everybody on the internet.
 *
 * Kept apart from lib/grants so the share dialog can use it. Everything here
 * is pure: grants.ts reaches for the server-side Supabase client, and importing
 * that from a client component breaks the build.
 */
export type Visibility = "private" | "everyone" | "public";

export function isVisibility(value: unknown): value is Visibility {
  return value === "private" || value === "everyone" || value === "public";
}

/**
 * Reads a node's own reach back out of its grants.
 *
 * Its own, not what it inherits: this is the state the control on this node
 * can change. What an ancestor confers is reported separately, because a page
 * inside a published folder is public no matter what its own setting says, and
 * a control that pretended otherwise would be lying.
 */
export function readVisibility(grants: EffectiveGrant[]): {
  visibility: Visibility;
  role: GrantRole | null;
} {
  const own = grants.filter((g) => !g.inherited);

  if (own.some((g) => g.grantee_type === "public")) {
    return { visibility: "public", role: null };
  }

  const everyone = own.find((g) => g.grantee_type === "authenticated");
  if (everyone) return { visibility: "everyone", role: everyone.role };

  return { visibility: "private", role: null };
}

/** The widest reach a node gets from an ancestor, and where it came from. */
export function readInheritedVisibility(grants: EffectiveGrant[]): {
  visibility: Visibility;
  role: GrantRole | null;
  originPath: string;
} | null {
  const inherited = grants.filter((g) => g.inherited);

  const open = inherited.find((g) => g.grantee_type === "public");
  if (open) {
    return { visibility: "public", role: null, originPath: open.origin_path };
  }

  const everyone = inherited.find((g) => g.grantee_type === "authenticated");
  if (everyone) {
    return {
      visibility: "everyone",
      role: everyone.role,
      originPath: everyone.origin_path,
    };
  }

  return null;
}
