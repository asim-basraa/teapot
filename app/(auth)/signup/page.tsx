import Link from "next/link";
import { AuthForm } from "../AuthForm";
import { signUp } from "../actions";

export const metadata = { title: "Create a Postit account" };

export default function SignUpPage() {
  return (
    <>
      <h1>Create an account</h1>
      <p className="auth-lede">
        Open to maqsoodlabs.com addresses. Anyone else needs an invitation.
      </p>

      <AuthForm
        action={signUp}
        submitLabel="Create account"
        fields={[
          {
            name: "email",
            label: "Email",
            type: "email",
            autoComplete: "email",
          },
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "new-password",
            hint: "At least 8 characters.",
          },
        ]}
      />

      <p className="auth-alt">
        <Link href="/login">Already have an account?</Link>
      </p>
    </>
  );
}
