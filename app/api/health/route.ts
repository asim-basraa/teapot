import { collectDiagnostics } from "@/lib/diagnostics";

export const dynamic = "force-dynamic";

/** Machine-readable twin of the tracer page, for Railway healthchecks and CI. */
export async function GET() {
  const { environment, supabase, build, allOk } = await collectDiagnostics();

  return Response.json(
    { status: allOk ? "ok" : "degraded", environment, supabase, build },
    { status: allOk ? 200 : 503 },
  );
}
