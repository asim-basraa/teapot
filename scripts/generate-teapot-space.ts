// Excluded from the typecheck: this is run directly by node with
// --experimental-strip-types, which needs the .ts extension on the import that
// the bundler resolution used by the app forbids.
//
// Regenerate the Teapot space migration:
//   node --experimental-strip-types scripts/generate-teapot-space.ts \
//     > supabase/migrations/20260909150000_teapot_space.sql
//
// The skills come from content/skills.ts, so the copy in the space and the copy
// on the documentation page are the same text and cannot drift apart.

import { STARTER_SKILLS } from "../content/skills.ts";

const q = (s: string) => "'" + s.replace(/'/g, "''") + "'";

const HOME = `Teapot is a knowledge garden with real access control. Ordinary
Markdown, rendered on the server, with permissions that are decided per page
rather than per site.

> [!important] The one idea
> A page you are not allowed to read is indistinguishable from a page that does
> not exist. Not a "you don't have access" screen: the same 404 as a typo. So a
> restricted page cannot be confirmed to exist by anybody who cannot read it,
> and neither can its title, its address, or the fact that somebody linked to it.

## What is here

- [[Connecting Claude]] — point Claude Code, the desktop app or the API at this space.
- [[Sharing and access]] — who can see what, and how to change it.
- The **Skills** folder — six skills you can copy into your own space and use today.

## Writing

Everything is Markdown. Link to another page with double brackets, like
[[Sharing and access]]. You can ==highlight== text, write \`inline code\`, fence a
block, and draw a diagram:

\`\`\`mermaid
graph LR;
  Draft-->Review;
  Review-->Published;
\`\`\`

A link to something you cannot read looks exactly like a link to something that
does not exist. That is the same rule as above, applied to navigation.
`;

const CONNECT = `Teapot speaks MCP, so Claude can read and write the pages you
can, and nothing else. It acts as you: the same 404s, the same grants.

## Get a token

Go to **Connect Teapot to Claude** from your list of spaces. The token is shown
once and never again — Teapot stores only a hash of it, so a leaked database
yields hashes the endpoint refuses. If you lose it, revoke it and make another.

## Claude Code

\`\`\`
claude mcp add --transport http teapot https://<your-teapot>/api/mcp \\
  --header "Authorization: Bearer <your-token>"
\`\`\`

Or in \`.mcp.json\`, so the whole team gets it:

\`\`\`json
{
  "mcpServers": {
    "teapot": {
      "type": "http",
      "url": "https://<your-teapot>/api/mcp",
      "headers": { "Authorization": "Bearer <your-token>" }
    }
  }
}
\`\`\`

## The desktop app

Settings → Connectors → Add custom connector. The URL is
\`https://<your-teapot>/api/mcp\`, and the token goes in an \`Authorization\`
header as \`Bearer <your-token>\`.

## The API

Pass it in the \`mcp_servers\` block of a Messages request, with the same URL and
the same header.

## What a connected Claude can reach

It sees **exactly what you see and never more**. It can search, read, create and
update pages and skills.

It cannot **delete or move anything**, and it cannot **change who can see
anything**. Those are decisions with consequences that outlive a conversation,
so they stay with a person.
`;

const SHARING = `Access is decided per item and inherited downwards. Set it on a
folder and it reaches everything inside, and every page says where its access
came from, so "why can they see this" always has an answer.

## Who can see this

One setting on every page, folder and skill, with three answers:

| | What it means |
| --- | --- |
| **Private** | Only the people and teams you have shared it with. |
| **Everyone signed in to Teapot** | Your whole organisation. Read, or read and write. |
| **Public** | Anybody with the link. No account, no sign-in. |

They are exclusive: choosing one withdraws the others, so there is never a
second answer quietly in force underneath the one you can see.

The distinction that matters is between the second and the third. Everybody at
your organisation is not everybody on the internet, and when only the second is
on offer people publish things they meant to circulate.

## And then, individually

Underneath, share with a named person or a team, at one of three roles:

- **Viewer** reads.
- **Editor** reads and writes.
- **Admin** also decides who else can.

"Everyone signed in" can read or write, never administer: handing the power to
reshare to everybody is not a decision anybody makes on purpose. Neither can
the public — a published page is read-only to the world however it is set.

## Where the controls are

**Share** sits next to every page, folder and skill in the sidebar, and at the
top of whatever you are reading. Folders are the thing most worth setting: one
decision covers everything inside.

> [!note] Comments are not published
> Publishing a page does not publish its conversation. Comments require an
> account even on a public page, because discussion about a document is candid
> in a way the document is not.
`;

const lines: string[] = [];
lines.push(`-- The Teapot space: the product's own documentation, as content.
--
-- Written as a data migration rather than seeded by hand so staging and
-- production carry the same words, and so re-running it is a no-op. The skills
-- are the same text the documentation page serves, from content/skills.ts.

do $$
declare
  v_owner uuid;
  v_space uuid;
  v_folder uuid;
  v_node uuid;
begin
  select id into v_owner from auth.users where email = 'asim@maqsoodlabs.com';
  if v_owner is null then
    raise notice 'no owner for the Teapot space here; skipping';
    return;
  end if;

  select id into v_space from public.spaces where slug = 'teapot';
  if v_space is not null then
    raise notice 'the Teapot space already exists; skipping';
    return;
  end if;

  v_space := gen_random_uuid();
  insert into public.spaces (id, slug, name, owner_id)
  values (v_space, 'teapot', 'Teapot', v_owner);
`);

function page(name: string, slug: string, content: string, type: string | null) {
  return `
  v_node := gen_random_uuid();
  insert into public.nodes (id, space_id, parent_id, kind, name, slug, content, content_type)
  values (v_node, v_space, null, 'file', ${q(name)}, ${q(slug)}, ${q(content)}, ${type ? q(type) : "'article'"});
  insert into public.grants (node_id, grantee_type, grantee_id, role)
  values (v_node, 'authenticated', null, 'viewer');
`;
}

lines.push(page("Teapot", "index", HOME, null));
lines.push(page("Connecting Claude", "connecting-claude", CONNECT, null));
lines.push(page("Sharing and access", "sharing-and-access", SHARING, null));

lines.push(`
  v_folder := gen_random_uuid();
  insert into public.nodes (id, space_id, parent_id, kind, name, slug)
  values (v_folder, v_space, null, 'folder', 'Skills', 'skills');
  insert into public.grants (node_id, grantee_type, grantee_id, role)
  values (v_folder, 'authenticated', null, 'viewer');
`);

for (const skill of STARTER_SKILLS) {
  const slug = skill.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  lines.push(`
  insert into public.nodes (space_id, parent_id, kind, name, slug, content, content_type)
  values (v_space, v_folder, 'file', ${q(skill.title)}, ${q(slug)}, ${q(skill.body)}, 'skill');`);
}

lines.push(`
  raise notice 'Teapot space created';
end $$;
`);

console.log(lines.join(""));
