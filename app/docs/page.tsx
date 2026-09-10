import Link from "next/link";
import type { Metadata } from "next";
import { STARTER_SKILLS } from "@/content/skills";
import { Copyable } from "@/components/Copyable";

export const metadata: Metadata = {
  title: "Teapot documentation",
  description:
    "How to connect Teapot to Claude, and a handful of skills worth copying.",
};

/**
 * The one documentation page.
 *
 * Public, and deliberately so: somebody deciding whether to connect Teapot to
 * Claude needs to read what it will and will not reach before they have an
 * account. Requiring a login to read that would be asking for trust before
 * offering any.
 */
export default function DocsPage() {
  const mcpUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://your-teapot"}/api/mcp`;

  return (
    <main className="shell docs">
      <header className="shell-header">
        <Link href="/" className="shell-brand">
          Teapot
        </Link>
        <Link href="/login" className="btn btn-secondary btn-small">
          Sign in
        </Link>
      </header>

      <article className="prose">
        <h1>Teapot</h1>

        <p className="lede">
          Teapot is a place to write things down, where who can read what is the
          product rather than a setting on the side of it. You write Markdown in
          spaces, organise it in folders, and share a page or a whole folder
          with a person, with a team, or with anyone at all. A page you have not
          been given is not merely hidden from you: it is indistinguishable from
          a page that does not exist.
        </p>

        <p>
          The other half is that you can connect it to Claude, so the things you
          have written are available in conversation without copying them
          anywhere. That is what the rest of this page is about.
        </p>

        <h2 id="connecting">Connecting Teapot to Claude</h2>

        <h3>1. Make a token</h3>

        <p>
          Sign in, then go to <strong>Your spaces</strong> and follow{" "}
          <strong>Connect Teapot to Claude</strong>, or go straight to{" "}
          <code>/settings/mcp</code>. Give the token a name you will recognise
          in six months, like the machine it is going on.
        </p>

        <p>
          <strong>The token is shown once and never again.</strong> Only a hash
          of it is stored, so nobody, including us, can recover it. If you lose
          it, revoke it and make another; that takes ten seconds and is the
          right instinct. Revoking takes effect on the very next request.
        </p>

        <p>
          By default a token reaches everything you can reach. You can pin one
          to a single space at creation, which is worth doing for a machine you
          trust less than your own.
        </p>

        <h3>2. Point Claude at it</h3>

        <p>Your endpoint is:</p>

        <Copyable label="MCP endpoint" text={mcpUrl} />

        <p>
          <strong>Claude Code.</strong> Run this in a terminal, or put the JSON
          in <code>.mcp.json</code> at the root of a project.
        </p>

        <Copyable
          label="Claude Code, command line"
          text={`claude mcp add --transport http teapot ${mcpUrl} \\\n  --header "Authorization: Bearer tea_your_token_here"`}
        />

        <Copyable
          label="Claude Code, .mcp.json"
          text={JSON.stringify(
            {
              mcpServers: {
                teapot: {
                  type: "http",
                  url: mcpUrl,
                  headers: { Authorization: "Bearer tea_your_token_here" },
                },
              },
            },
            null,
            2,
          )}
        />

        <p>
          <strong>The Claude apps</strong>, desktop and web. Settings, then
          Connectors, then Add custom connector. That dialog takes a URL and
          nothing else, so for these the token goes in the URL itself:{" "}
          <code>{mcpUrl}/your-token</code>, which the token screen gives you
          ready to paste.
        </p>

        <p>
          That form is deliberately the weaker one. A token in a URL is in every
          HTTP log that records the path, in whatever the client stores for the
          connection, and anywhere the URL is pasted; a token in a header is in
          none of those. Use it only where a header is not on offer, and prefer
          a token pinned to a single space so that a leak costs one space rather
          than an account.
        </p>

        <p>
          <strong>The API.</strong> Three things are needed and it is easy to
          give two: the beta header, the server in <code>mcp_servers</code>, and
          a matching <code>mcp_toolset</code> entry in <code>tools</code>.
          Leaving the toolset out does not quietly ignore the server, it makes
          the request invalid.
        </p>

        <Copyable
          label="Anthropic API"
          text={[
            "curl https://api.anthropic.com/v1/messages \\",
            '  -H "content-type: application/json" \\',
            '  -H "x-api-key: $ANTHROPIC_API_KEY" \\',
            '  -H "anthropic-version: 2023-06-01" \\',
            '  -H "anthropic-beta: mcp-client-2025-11-20" \\',
            `  -d '${JSON.stringify(
              {
                model: "claude-opus-5",
                max_tokens: 2048,
                messages: [
                  { role: "user", content: "What is on my todo list?" },
                ],
                mcp_servers: [
                  {
                    type: "url",
                    url: mcpUrl,
                    name: "teapot",
                    authorization_token: "tea_your_token_here",
                  },
                ],
                tools: [{ type: "mcp_toolset", mcp_server_name: "teapot" }],
              },
              null,
              2,
            )}'`,
          ].join("\n")}
        />

        <h2 id="reach">What a connected Claude can and cannot reach</h2>

        <p>
          A token acts as you. Every request it makes is answered by the same
          rules that answer your requests in the browser, so a connected Claude
          sees <strong>exactly what you see and never more</strong>. Share a
          folder with yourself tomorrow and it appears; have it revoked and it
          disappears, with no cache to go stale in between.
        </p>

        <p>It can:</p>

        <ul>
          <li>
            <code>list_spaces</code>, <code>list_tree</code> to see what is in
            one, <code>search</code> within it, and <code>read_page</code> by
            path or id
          </li>
          <li>
            <code>list_skills</code> and <code>get_skill</code>, so it can find
            and follow the skills you have written
          </li>
          <li>
            <code>create_folder</code> and <code>create_page</code>, so it can
            build structure and not just a flat list, and{" "}
            <code>update_page</code> guarded by a version number, so it cannot
            overwrite an edit you made while it was thinking
          </li>
          <li>
            <code>list_backlinks</code>, to see what points at a page
          </li>
        </ul>

        <p>It cannot:</p>

        <ul>
          <li>delete or move anything</li>
          <li>change who can see anything</li>
          <li>
            reach a page nobody has given you, whatever it is asked to do
          </li>
        </ul>

        <p>
          That list is short on purpose. A token is a long-lived credential
          sitting on the internet, and one that can only add is a far smaller
          problem to have leaked than one that can remove. The dangerous things
          are still available, deliberately, in the browser.
        </p>

        <h2 id="skills">Articles and skills</h2>

        <p>
          Every page in Teapot is an <strong>article</strong> or a{" "}
          <strong>skill</strong>. An article is prose: notes, a decision, a
          write-up. A skill is a Markdown file written as instructions for
          Claude to follow, in the same shape Claude uses elsewhere, which means
          Teapot doubles as a place to keep them.
        </p>

        <p>The distinction earns its keep the moment you ask for your skills:</p>

        <ul>
          <li>
            <code>list_skills</code> returns your skills and nothing else, so
            "what can you do for me here" does not also return every meeting
            note.
          </li>
          <li>
            <code>get_skill</code> returns the instructions with the metadata
            stripped, ready to follow.
          </li>
        </ul>

        <p>A skill worth having:</p>

        <ul>
          <li>
            <strong>Has a name and a description in its frontmatter.</strong>{" "}
            The description is what a client reads to decide whether the skill
            is relevant, so it should say when to use it, not what it is called.
          </li>
          <li>
            <strong>Says what to do, not what the topic is.</strong> "Read the
            runbook before starting, every time" beats "runbooks are important".
          </li>
          <li>
            <strong>Includes a worked example.</strong> A skill nobody can
            picture using does not get used.
          </li>
          <li>
            <strong>Names the failure it exists to prevent.</strong> That is
            usually the reason somebody wrote it, and it is the part that makes
            the instruction stick.
          </li>
        </ul>

        <p>
          Teapot will not stop you saving a skill with no description. It will
          say so and save it anyway: losing what you wrote over a formatting
          detail is a much worse outcome than an incomplete skill.
        </p>

        <h2 id="starter-skills">Six skills to start with</h2>

        <p>
          Copy any of these into a space, mark it as a skill, and it is
          available to your Claude immediately. They are meant to be edited: the
          house style one in particular is worth nothing until it describes how
          you actually write.
        </p>

        {STARTER_SKILLS.map((skill) => (
          <section key={skill.title} className="skill-card">
            <h3 id={slugify(skill.title)}>{skill.title}</h3>
            <p>{skill.summary}</p>
            <Copyable label={skill.title} text={skill.body} collapsed />
          </section>
        ))}

        <h2 id="questions">Two questions people ask</h2>

        <p>
          <strong>If I publish a page, does Claude see the comments on it?</strong>{" "}
          No. Publishing a page puts the document on the internet; the
          conversation about it stays behind a login. Comments tend to be candid
          in a way the document is not, and one toggle should not put them in
          public.
        </p>

        <p>
          <strong>
            Can somebody work out that a page exists by searching for a word in
            it?
          </strong>{" "}
          No. Search runs under your permissions, so a word that appears only in
          a page you cannot read returns nothing at all, rather than a result
          with the content hidden. The same is true of links: a link to a page
          you may not read renders identically to a link to a page that does not
          exist.
        </p>
      </article>
    </main>
  );
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
