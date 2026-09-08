"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { AuthState } from "./actions";

type Field = {
  name: string;
  label: string;
  type: "email" | "password";
  autoComplete: string;
  hint?: string;
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? "Working…" : label}
    </button>
  );
}

export function AuthForm({
  action,
  fields,
  submitLabel,
}: {
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
  fields: Field[];
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction} className="auth-form" noValidate>
      {state.error ? (
        <p className="msg msg-error" role="alert">
          {state.error}
        </p>
      ) : null}

      {state.notice ? (
        <p className="msg msg-notice" role="status">
          {state.notice}
        </p>
      ) : null}

      {fields.map((field) => (
        <label key={field.name} className="field">
          <span className="field-label">{field.label}</span>
          <input
            className="input"
            name={field.name}
            type={field.type}
            autoComplete={field.autoComplete}
            required
          />
          {field.hint ? <span className="field-hint">{field.hint}</span> : null}
        </label>
      ))}

      <Submit label={submitLabel} />
    </form>
  );
}
