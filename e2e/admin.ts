import { createClient } from "@supabase/supabase-js";

/**
 * Appoints the first administrator.
 *
 * Test scaffolding, not a product surface. In a real environment the founding
 * administrator is seeded by migration and appoints the rest from the screen;
 * there is deliberately no way to appoint yourself. CI has no seeded account,
 * so the suite stands one up the same way the migration does, by writing the
 * flag with the service key.
 */
export async function makeAdmin(email: string): Promise<void> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { error } = await supabase
    .from("profiles")
    .update({ is_admin: true })
    .eq("email", email);

  if (error) throw new Error(`could not appoint ${email}: ${error.message}`);
}
