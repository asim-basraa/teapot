import type { NextRequest } from "next/server";
import { resolveSession, bearerToken } from "@/lib/mcp/session";
import { TOOLS } from "@/lib/mcp/tools";
import {
  allowToken,
  allowFailure,
  callerAddress,
} from "@/lib/mcp/rate-limit";

export const dynamic = "force-dynamic";

/**
 * The MCP endpoint.
 *
 * Speaks JSON-RPC 2.0 over a single POST, which is the stateless shape of MCP's
 * streamable HTTP transport. Written directly rather than through the SDK
 * because the SDK expects Node's req/res and this is a Web Request handler; the
 * subset a stateless server needs is small enough that adapting it would be
 * more machinery than implementing it.
 *
 * It holds no session state of its own. Every request carries its token, and
 * the token is what establishes who is asking, so there is nothing to expire,
 * pin to an instance, or get out of step.
 */

const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  const address = callerAddress(request);
  const token = bearerToken(request);

  if (!token) {
    allowFailure(address);
    return unauthorized();
  }

  // Throttled before the token is looked at, so a flood of guesses cannot be
  // turned into a flood of database round trips.
  if (!allowFailure(address)) return tooMany();

  const session = await resolveSession(token);
  if (!session) return unauthorized();

  if (!allowToken(session.tokenId)) return tooMany();

  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const { id = null, method } = body;

  // Notifications carry no id and expect no response. `initialized` is the one
  // a client sends after the handshake.
  if (id === null && typeof method === "string" && method.startsWith("notifications/")) {
    return new Response(null, { status: 202 });
  }

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "teapot", version: "1.0.0" },
      });

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });

    case "tools/call": {
      const name = body.params?.name;
      const tool = TOOLS.find((t) => t.name === name);

      if (!tool) {
        return rpcError(id, -32602, `No such tool: ${String(name)}`);
      }

      const args = (body.params?.arguments ?? {}) as Record<string, unknown>;

      try {
        const result = await tool.run(session, args);

        // A tool that refuses reports it through isError rather than a
        // JSON-RPC error: the call itself succeeded, and the client should see
        // the reason as content it can act on.
        return "error" in result
          ? rpcResult(id, {
              content: [{ type: "text", text: result.error }],
              isError: true,
            })
          : rpcResult(id, {
              content: [{ type: "text", text: result.text }],
            });
      } catch {
        // Deliberately opaque. An exception here could carry a database message
        // naming a table or a constraint, which is not the caller's business.
        return rpcResult(id, {
          content: [{ type: "text", text: "That call failed." }],
          isError: true,
        });
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${String(method)}`);
  }
}

/**
 * A GET is how some clients probe for a server-sent event stream.
 *
 * This server is stateless and pushes nothing, so it says so plainly rather
 * than leaving a client waiting on a stream that will never carry anything.
 */
export function GET() {
  return new Response("This MCP endpoint accepts POST only.", {
    status: 405,
    headers: { allow: "POST" },
  });
}

function rpcResult(id: string | number | null, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

/**
 * One answer for no token, a wrong token, a revoked token and an expired one.
 *
 * Distinguishing them would tell an attacker which of their guesses was once a
 * real token, which is exactly the signal worth withholding.
 */
function unauthorized(): Response {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } },
    { status: 401, headers: { "www-authenticate": "Bearer" } },
  );
}

function tooMany(): Response {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32002, message: "Too many requests" } },
    { status: 429, headers: { "retry-after": "60" } },
  );
}
