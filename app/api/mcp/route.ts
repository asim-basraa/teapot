import type { NextRequest } from "next/server";
import { bearerToken } from "@/lib/mcp/session";
import { handleMcp, probeAnswer } from "@/lib/mcp/handler";

export const dynamic = "force-dynamic";

/**
 * The MCP endpoint, with the token in an Authorization header.
 *
 * The way it should be reached. See ./[token] for the form that carries the
 * token in the path, and why that one exists.
 */
export async function POST(request: NextRequest) {
  return handleMcp(request, bearerToken(request));
}

export function GET() {
  return probeAnswer();
}
