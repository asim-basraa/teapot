import Link from "next/link";
import { AuthForm } from "../AuthForm";
import { signIn } from "../actions";

export const metadata = { title: "Sign in to Teapot" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <>
      <h1>Sign in</h1>

      {error === "link" ? (
        <p className="msg msg-error" role="alert">
          That link is no longer valid. Request a new one below.
        </p>
      ) : null}

      <AuthForm
        action={signIn}
        submitLabel="Sign in"
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
            autoComplete: "current-password",
          },
        ]}
      />

      <p className="auth-alt">
        <Link href="/forgot-password">Forgot your password?</Link>
        <span aria-hidden="true"> / </span>
        <Link href="/signup">Create an account</Link>
      </p>
    </>
  );
}
