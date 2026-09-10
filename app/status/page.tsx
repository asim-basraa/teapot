import { collectDiagnostics, type Check } from "@/lib/diagnostics";

// Diagnostics must reflect the live runtime, never a value baked in at build.
export const dynamic = "force-dynamic";

function Panel({ title, checks }: { title: string; checks: Check[] }) {
  return (
    <section>
      <h2>{title}</h2>
      <div className="panel">
        {checks.map((c) => (
          <div className="row" key={c.key}>
            <span className="key">{c.key}</span>
            <span className={`val ${c.ok ? "ok" : "bad"}`}>{c.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function Home() {
  const { environment, supabase, build, allOk } = await collectDiagnostics();

  return (
    <main>
      <h1>Post-it</h1>
      <p className="lede">
        {allOk
          ? "Deployment tracer: every check below passed."
          : "Deployment tracer: something below needs attention."}
      </p>

      <Panel title="Environment" checks={environment} />
      <Panel title="Supabase" checks={supabase} />
      <Panel title="Build" checks={build} />

      <footer>
        This page exists to prove the pipeline end to end: build, deploy,
        environment variables, and database connectivity. It is replaced by the
        real application in Slice 1.
      </footer>
    </main>
  );
}
