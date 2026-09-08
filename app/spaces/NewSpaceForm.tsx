"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createSpaceAction } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create space"}
    </button>
  );
}

export function NewSpaceForm() {
  const [state, formAction] = useActionState(createSpaceAction, {});

  return (
    <form action={formAction} className="new-space" noValidate>
      {state.error ? (
        <p className="msg msg-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="new-space-row">
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" name="name" type="text" required />
        </label>

        <label className="field">
          <span className="field-label">Address</span>
          <input
            className="input"
            name="slug"
            type="text"
            pattern="[a-z0-9\-]+"
            placeholder="engineering-notes"
            required
          />
        </label>
      </div>

      <Submit />
    </form>
  );
}
