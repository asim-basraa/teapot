"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AskDialog } from "@/components/Ask";

/**
 * Making something inside a folder, from the folder.
 *
 * This used to be two buttons on the folder's row in the sidebar, which put
 * five controls on one row of a narrow column and squeezed out the name. Here
 * there is room, and you can see what is already inside before adding to it.
 */
export function NewChild({
  spaceId,
  spaceSlug,
  parentId,
}: {
  spaceId: string;
  spaceSlug: string;
  parentId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<
    { kind: "folder" | "file"; contentType?: "article" | "skill" } | null
  >(null);

  async function create(name: string) {
    if (!asking) return;
    const { kind, contentType } = asking;
    setAsking(null);
    setError(null);
    const res = await fetch("/api/v1/nodes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        space_id: spaceId,
        parent_id: parentId,
        kind,
        name,
        content_type: contentType,
      }),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(body.error ?? `Could not create that (${res.status})`);
      return;
    }

    // Go to the thing you just made. Staying put and hoping the sidebar
    // catches up leaves you looking at a list that does not yet contain it,
    // and there is nowhere else you would rather be than in the new page.
    startTransition(() => {
      router.push(`/s/${spaceSlug}/${body.node.path}`);
      router.refresh();
    });
  }

  return (
    <div className="folder-actions">
      <button
        className="btn btn-secondary btn-small"
        type="button"
        disabled={pending}
        onClick={() => setAsking({ kind: "file" })}
      >
        New page
      </button>
      <button
        className="btn btn-secondary btn-small"
        type="button"
        disabled={pending}
        onClick={() => setAsking({ kind: "file", contentType: "skill" })}
      >
        New skill
      </button>
      <button
        className="btn btn-secondary btn-small"
        type="button"
        disabled={pending}
        onClick={() => setAsking({ kind: "folder" })}
      >
        New folder
      </button>

      {asking ? (
        <AskDialog
          title={
            asking.kind === "folder"
              ? "New folder"
              : asking.contentType === "skill"
                ? "New skill"
                : "New page"
          }
          label="Name"
          submitLabel="Create"
          hint={
            asking.contentType === "skill"
              ? "A skill is a page Claude reads to learn how you want a job done."
              : undefined
          }
          onSubmit={(name) => void create(name)}
          onClose={() => setAsking(null)}
        />
      ) : null}

      {error ? (
        <p className="msg msg-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
