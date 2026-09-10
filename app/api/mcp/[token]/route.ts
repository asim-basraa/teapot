import type { NextRequest } from "next/server";
import { handleMcp, probeAnswer } from "@/lib/mcp/handler";

export const dynamic = "force-dynamic";

/**
 * The same endpoint, with the token in the path instead of a header.
 *
 * It exists for one reason: the Claude desktop and web apps add a connector
 * from a URL and offer no field for a header, so a token that only travels in
 * one cannot be given to them at all.
 *
 * This is the weaker of the two and is presented that way. A secret in a path
 * is a secret in every HTTP log that records the path, in whatever the client
 * stores for the connection, and in every place the URL is subsequently
 * pasted. A header is none of those things. Nothing here logs the path, but
 * that is only the half of it we control.
 *
 * The intended answer is OAuth on the header form, at which point this goes.
 * Until then, prefer a token pinned to a single space when using it, so a leak
 * costs one space rather than an account.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return handleMcp(request, token || null);
}

export function GET() {
  return probeAnswer();
}
