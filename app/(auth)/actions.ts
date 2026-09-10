"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AuthState = {
  error?: string;
  notice?: string;
  /**
   * What was typed, handed back so a refused form does not empty itself.
   * React resets an uncontrolled form once its action returns, so a rejected
   * sign-in wiped the address along with the password and made a mistyped
   * password cost two fields instead of one. Passwords are never in here.
   */
  values?: { email?: string };
};

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const { email, password } = readCredentials(formData);

  if (!email || !password) {
    return { error: "Email and password are both required.", values: { email } };
  }
  if (password.length < 8) {
    return {
      error: "Password must be at least 8 characters.",
      values: { email },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${siteUrl()}/auth/confirm` },
  });

  if (error) {
    // The before-user-created hook rejects addresses outside the allowed
    // domain that hold no invitation. Its message is written for the reader,
    // so it is surfaced as-is rather than replaced with something generic.
    return { error: error.message, values: { email } };
  }

  // Deliberately conditional. Supabase answers a signup for an address that
  // already has a confirmed account with success and sends nothing, so that the
  // form cannot be used to discover who has an account. Promising an email
  // outright therefore leaves anybody who forgot they had registered waiting
  // for something that is never coming. This says what is actually true in both
  // cases without giving away which one they are in.
  return {
    notice: `If ${email} is new to Teapot, a confirmation link is on its way, and you will not be able to sign in until you have followed it. If you already have an account, sign in below instead.`,
  };
}

export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const { email, password } = readCredentials(formData);

  if (!email || !password) {
    return { error: "Email and password are both required.", values: { email } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately uniform: distinguishing "no such account" from "wrong
    // password" tells an attacker which addresses are registered.
    return { error: "Those credentials are not valid.", values: { email } };
  }

  revalidatePath("/", "layout");
  redirect("/spaces");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email address." };


  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl()}/auth/confirm?next=/reset-password`,
  });

  // Always the same answer, whether or not the address exists, so this cannot
  // be used to enumerate accounts.
  return {
    notice: `If ${email} has an account, a reset link is on its way.`,
  };
}

export async function updatePassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirm) {
    return { error: "Those passwords do not match." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect("/spaces");
}

/**
 * Changing your password from the account page.
 *
 * Separate from updatePassword, which is the end of the reset-by-email
 * journey and rightly lands you in your spaces. Somebody changing their
 * password from their account settings has not arrived from anywhere and
 * should be left where they were, told it worked.
 */
export async function changePassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirm) {
    return { error: "Those passwords do not match." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  revalidatePath("/account");
  return { notice: "Your password has been changed." };
}
