import { redirect } from "next/navigation";
import { AuthForm } from "../AuthForm";
import { updatePassword } from "../actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  // Reaching this page means the reset link already exchanged its token for a
  // session. Without one there is nothing to update, so there is no point
  // showing the form.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?error=link");

  return (
    <>
      <h1>Choose a new password</h1>

      <AuthForm
        action={updatePassword}
        submitLabel="Save password"
        fields={[
          {
            name: "password",
            label: "New password",
            type: "password",
            autoComplete: "new-password",
            hint: "At least 8 characters.",
          },
          {
            name: "confirm",
            label: "Confirm password",
            type: "password",
            autoComplete: "new-password",
          },
        ]}
      />
    </>
  );
}
