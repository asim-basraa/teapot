import Link from "next/link";
import { AuthForm } from "../AuthForm";
import { requestPasswordReset } from "../actions";

export const metadata = { title: "Reset your Postit password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1>Reset your password</h1>
      <p className="auth-lede">
        We will email you a link to choose a new one.
      </p>

      <AuthForm
        action={requestPasswordReset}
        submitLabel="Send reset link"
        fields={[
          {
            name: "email",
            label: "Email",
            type: "email",
            autoComplete: "email",
          },
        ]}
      />

      <p className="auth-alt">
        <Link href="/login">Back to sign in</Link>
      </p>
    </>
  );
}
