/**
 * Reads mail out of the local Supabase stack's Mailpit instance.
 *
 * The confirmation flow is tested through real email rather than by flipping
 * the user's confirmed flag with the admin API. Stubbing it would leave the
 * part most likely to break, the link Supabase actually sends, untested.
 */
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type Summary = { ID: string; To: { Address: string }[]; Created: string };

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Mailpit ${res.status} for ${url}`);
  }
  return (await res.json()) as T;
}

/**
 * Waits for a message addressed to `recipient` and returns the first link in
 * it that points at the app's confirmation route.
 */
export async function waitForConfirmationLink(
  recipient: string,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const target = recipient.toLowerCase();

  while (Date.now() < deadline) {
    const { messages } = await json<{ messages: Summary[] }>(
      `${MAILPIT}/api/v1/messages?limit=50`,
    );

    const match = messages.find((m) =>
      m.To?.some((t) => t.Address.toLowerCase() === target),
    );

    if (match) {
      const body = await json<{ Text: string; HTML: string }>(
        `${MAILPIT}/api/v1/message/${match.ID}`,
      );
      const link = extractConfirmLink(`${body.HTML}\n${body.Text}`);
      if (link) return link;
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error(`No confirmation email arrived for ${recipient}`);
}

function extractConfirmLink(content: string): string | null {
  // Supabase's default template links to {{ .ConfirmationURL }}, which points
  // at the auth server and redirects on to our /auth/confirm route.
  const matches = content.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  const link = matches.find(
    (url) => url.includes("token_hash=") || url.includes("/auth/v1/verify"),
  );
  return link ? link.replace(/&amp;/g, "&") : null;
}

/** Empties the mailbox so one test cannot see another's messages. */
export async function clearMail(): Promise<void> {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
}
