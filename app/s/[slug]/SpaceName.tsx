"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AskDialog } from "@/components/Ask";
import { renameSpaceAction } from "@/app/spaces/actions";

/**
 * The space's name, and for its owner the way to change it.
 *
 * A space could not be renamed at all. What people found instead was the home
 * page sitting in the file tree under the space's name, and renaming that
 * rederived its address, so the space itself 404ed. The rename people were
 * reaching for is this one, and it changes the name everywhere the space is
 * named: here, its front page, and the list of spaces.
 */
export function SpaceName({
  spaceId,
  name,
  canRename,
}: {
  spaceId: string;
  name: string;
  canRename: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  function rename(next: string) {
    setAsking(false);
    if (next === name) return;

    startTransition(async () => {
      const result = await renameSpaceAction(spaceId, next);
      setError(result.error ?? null);
      if (!result.error) router.refresh();
    });
  }

  return (
    <span className="space-title">
      {name}
      {canRename ? (
        <button
          type="button"
          className="space-rename"
          onClick={() => setAsking(true)}
          disabled={pending}
          aria-label={`Rename ${name}`}
        >
          Rename
        </button>
      ) : null}
      {error ? (
        <span className="msg msg-error" role="alert">
          {error}
        </span>
      ) : null}

      {asking ? (
        <AskDialog
          title={`Rename ${name}`}
          label="Space name"
          value={name}
          hint="Only the name changes. The address stays as it is, so nothing anybody has linked breaks."
          onSubmit={rename}
          onClose={() => setAsking(false)}
        />
      ) : null}
    </span>
  );
}
