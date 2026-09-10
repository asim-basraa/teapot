-- The Postit space: the product's own documentation, as content.
--
-- Written as a data migration rather than seeded by hand so staging and
-- production carry the same words, and so re-running it is a no-op. The skills
-- are the same text the documentation page serves, from content/skills.ts.
--
-- This seeds a database that has never had the space. One that has it under
-- the name the product shipped with is renamed instead, by the migration that
-- follows this one.

do $$
declare
  v_owner uuid;
  v_space uuid;
  v_folder uuid;
  v_node uuid;
begin
  select id into v_owner from auth.users where email = 'asim@maqsoodlabs.com';
  if v_owner is null then
    raise notice 'no owner for the Postit space here; skipping';
    return;
  end if;

  select id into v_space from public.spaces where slug in ('postit', 'teapot');
  if v_space is not null then
    raise notice 'the Postit space already exists; skipping';
    return;
  end if;

  v_space := gen_random_uuid();
  insert into public.spaces (id, slug, name, owner_id)
  values (v_space, 'postit', 'Postit', v_owner);

  v_node := gen_random_uuid();
  insert into public.nodes (id, space_id, parent_id, kind, name, slug, content, content_type)
  values (v_node, v_space, null, 'file', 'Postit', 'index', 'Postit is a knowledge garden with real access control. Ordinary
Markdown, rendered on the server, with permissions that are decided per page
rather than per site.

> [!important] The one idea
> A page you are not allowed to read is indistinguishable from a page that does
> not exist. Not a "you don''t have access" screen: the same 404 as a typo. So a
> restricted page cannot be confirmed to exist by anybody who cannot read it,
> and neither can its title, its address, or the fact that somebody linked to it.

## What is here

- [[Connecting Claude]] — point Claude Code, the desktop app or the API at this space.
- [[Sharing and access]] — who can see what, and how to change it.
- The **Skills** folder — six skills you can copy into your own space and use today.

## Writing

Everything is Markdown. Link to another page with double brackets, like
[[Sharing and access]]. You can ==highlight== text, write `inline code`, fence a
block, and draw a diagram:

```mermaid
graph LR;
  Draft-->Review;
  Review-->Published;
```

A link to something you cannot read looks exactly like a link to something that
does not exist. That is the same rule as above, applied to navigation.
', 'article');
  insert into public.grants (node_id, grantee_type, grantee_id, role)
  values (v_node, 'authenticated', null, 'viewer');

  v_node := gen_random_uuid();
  insert into public.nodes (id, space_id, parent_id, kind, name, slug, content, content_type)
  values (v_node, v_space, null, 'file', 'Connecting Claude', 'connecting-claude', 'Postit speaks MCP, so Claude can read and write the pages you
can, and nothing else. It acts as you: the same 404s, the same grants.

## Get a token

Go to **Connect Postit to Claude** from your list of spaces. The token is shown
once and never again — Postit stores only a hash of it, so a leaked database
yields hashes the endpoint refuses. If you lose it, revoke it and make another.

## Claude Code

```
claude mcp add --transport http postit https://<your-postit>/api/mcp \
  --header "Authorization: Bearer <your-token>"
```

Or in `.mcp.json`, so the whole team gets it:

```json
{
  "mcpServers": {
    "postit": {
      "type": "http",
      "url": "https://<your-postit>/api/mcp",
      "headers": { "Authorization": "Bearer <your-token>" }
    }
  }
}
```

## The desktop app

Settings → Connectors → Add custom connector. The URL is
`https://<your-postit>/api/mcp`, and the token goes in an `Authorization`
header as `Bearer <your-token>`.

## The API

Pass it in the `mcp_servers` block of a Messages request, with the same URL and
the same header.

## What a connected Claude can reach

It sees **exactly what you see and never more**. It can search, read, create and
update pages and skills.

It cannot **delete or move anything**, and it cannot **change who can see
anything**. Those are decisions with consequences that outlive a conversation,
so they stay with a person.
', 'article');
  insert into public.grants (node_id, grantee_type, grantee_id, role)
  values (v_node, 'authenticated', null, 'viewer');

  v_node := gen_random_uuid();
  insert into public.nodes (id, space_id, parent_id, kind, name, slug, content, content_type)
  values (v_node, v_space, null, 'file', 'Sharing and access', 'sharing-and-access', 'Access is decided per item and inherited downwards. Set it on a
folder and it reaches everything inside, and every page says where its access
came from, so "why can they see this" always has an answer.

## Who can see this

One setting on every page, folder and skill, with three answers:

| | What it means |
| --- | --- |
| **Private** | Only the people and teams you have shared it with. |
| **Everyone signed in to Postit** | Your whole organisation. Read, or read and write. |
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
', 'article');
  insert into public.grants (node_id, grantee_type, grantee_id, role)
  values (v_node, 'authenticated', null, 'viewer');

  v_folder := gen_random_uuid();
  insert into public.nodes (id, space_id, parent_id, kind, name, slug)
  values (v_folder, v_space, null, 'folder', 'Skills', 'skills');
  insert into public.grants (node_id, grantee_type, grantee_id, role)
  values (v_folder, 'authenticated', null, 'viewer');

  insert into public.nodes (space_id, parent_id, kind, name, slug, content, content_type)
  values (v_space, v_folder, 'file', 'Chat Context', 'chat-context', '---
name: Chat Context
description: Record what a conversation established in Postit, and retrieve it at the start of a later one
---

# Chat Context

What people lose between conversations is rarely *what* was decided. It is
*why*, and what was ruled out. This skill files that, and reads it back.

## At the start of a conversation

Search Postit for context before assuming there is none:

1. `search` the space for the project or topic by name.
2. `read_page` anything that looks relevant.
3. Say what you found in one sentence, so the reader knows what you are
   working from and can correct it.

If nothing matches, say so rather than inventing background.

## At the end of a conversation, or when asked to file it

Write a page under `context/<topic>` containing:

- **What we settled**, one line each.
- **Why**, including the alternative that was rejected and the reason.
- **Still open**, questions that were raised and not answered.
- **Where things are**, links or paths to anything produced.

Keep it short enough that somebody will actually read it in six months. If a
page already exists for the topic, `read_page` it first and `update_page` with
the version number it gave you, so you extend the record rather than replacing
somebody else''s account of it.

## Worked example

> **Reader:** We have been going back and forth on the export format. File this.

You write `context/export-format`:

```markdown
# Export format

## What we settled
- Exports are NDJSON, one record per line.

## Why
- CSV was rejected: the nested attachment metadata does not flatten without
  losing the association between a file and its page.
- A single JSON array was rejected: exports are expected to reach a few
  hundred megabytes, and a consumer should be able to stream them.

## Still open
- Whether deleted records appear with a tombstone or are simply absent.

## Where things are
- Prototype writer at [[Export Writer]].
```

Three months later somebody asks why the export is not CSV. The answer is on
the page, in the words of the people who made the decision.
', 'skill');
  insert into public.nodes (space_id, parent_id, kind, name, slug, content, content_type)
  values (v_space, v_folder, 'file', 'Todo List', 'todo-list', '---
name: Todo List
description: Read and update the reader''s todo list, kept as a Markdown checklist in Postit
---

# Todo List

Todos live in a normal page as GitHub-flavoured task lists. That format is the
point: it renders as checkboxes in Postit, stays readable as plain text
anywhere else, and a person editing it by hand and Claude editing it through
the API produce exactly the same thing.

## The format

```markdown
## Open

- [ ] Book the venue @sam #launch
- [ ] Draft the announcement ~2026-10-01

## Done

- [x] Pick a date ~2026-09-04
```

- `- [ ]` is open, `- [x]` is done. Nothing else counts as a todo.
- `@name` is who it is for. `#tag` groups related items. `~YYYY-MM-DD` is a
  date: when it is due while open, when it was finished once done.
- Completed items move to the **Done** heading rather than being deleted, so the
  page answers "what happened last month" as well as "what is left".

## Reading

`read_page` the todo page and report only the open items unless asked
otherwise. Group by `#tag` when there are more than a handful. If the reader
asks what is overdue, compare `~` dates against today and say so plainly.

## Writing

Adding an item or ticking one off is an `update_page`, and `update_page`
requires the version number that `read_page` returned.

**Always read immediately before you write.** If the write is refused because
somebody else saved in between, do not retry blindly with the same text: read
the page again, apply your change to the version that is now there, and write
that. Retrying without re-reading is how one person''s todo quietly disappears.

Never rewrite items you were not asked to touch. Preserve their wording,
including the parts you would have phrased differently.

## Worked example

> **Reader:** Add "chase the printer quote" for me, and mark the venue booked.

You `read_page` `todos`, which comes back at version 7. You write back at
version 7 with the venue line moved under **Done** with today''s date, and the
new item appended under **Open**. You reply:

> Done. Two open: chase the printer quote, draft the announcement (due 1 Oct).

If the save had been refused, you would read again, find that somebody had
added "confirm catering" in the meantime, and write a version that keeps both.
', 'skill');
  insert into public.nodes (space_id, parent_id, kind, name, slug, content, content_type)
  values (v_space, v_folder, 'file', 'Decision Log', 'decision-log', '---
name: Decision Log
description: Record and retrieve decisions, with the reasoning and the conditions that would reopen them
---

# Decision Log

A decision without its reasoning is a rule nobody can safely change. This keeps
the reasoning attached.

## Recording one

One page per decision, under `decisions/`, named for the decision rather than
the date. Include:

- **Decision.** One sentence, in the present tense: "We use X."
- **Date** and **who was in the room.**
- **Context.** What made this need deciding at all.
- **Alternatives.** What else was considered, and the specific reason each was
  not chosen. An alternative with no stated reason is not an alternative, it is
  a gesture.
- **Consequences.** What this makes easy, and what it makes hard. Both.
- **Revisit if.** The concrete thing that would make this the wrong call. This
  is the most valuable line on the page and the one most often left out.

## Answering from it

When somebody asks why something is the way it is, `search` `decisions/`
before answering from your own reasoning. Quote the decision and its date. If
the "revisit if" condition now looks true, say so: that is the whole reason it
was written down.

If there is no record, say there is no record. Do not reconstruct a
justification, however plausible; a reconstructed reason is indistinguishable
from a real one to the next reader, and it is not the same thing.

## Worked example

`decisions/postgres-over-search-service`:

```markdown
# We search in Postgres rather than running a search service

**Date:** 2026-09-04
**Present:** Asim, Noreen

## Context
Search has to be filtered by permissions, and every result must already be
readable by the person searching.

## Alternatives
- A dedicated search service. Rejected: the index would be a second copy of
  the permission model, and the two would drift. A stale index is a leak.
- Client-side search. Rejected: it requires shipping the corpus to the browser.

## Consequences
Easy: results are filtered by the same rules as everything else, for free.
Hard: no fuzzy matching or typo tolerance beyond what Postgres offers.

## Revisit if
The corpus outgrows what a single Postgres instance ranks quickly, or people
start complaining about typo tolerance more than about relevance.
```

A year later, somebody proposes adding a search service. The page says exactly
what would have to be true first.
', 'skill');
  insert into public.nodes (space_id, parent_id, kind, name, slug, content, content_type)
  values (v_space, v_folder, 'file', 'House Style', 'house-style', '---
name: House Style
description: How we write, so drafts come back sounding like us
---

# House Style

Edit this page until it describes how *you* actually write. The example rules
below are a starting point, not a prescription: the value is in the specificity,
so replace anything that is not true of you.

## Rules

- Say the thing. Put the point in the first sentence, not after a paragraph of
  throat-clearing.
- Prefer short words. "Use", not "utilise". "Help", not "facilitate".
- No filler openers. Never begin with "In today''s fast-paced world" or "It is
  worth noting that".
- Concrete over abstract. Name the customer, the number, the date.
- Admit uncertainty in plain words: "I think", "we do not know yet". Do not
  hedge with "may potentially".
- One idea per paragraph. If a paragraph needs a "furthermore", it is two
  paragraphs.
- Active voice, except where the actor genuinely does not matter.
- No exclamation marks. No emoji.

## Words we avoid

leverage, synergy, robust, seamless, delve, journey, unlock, empower,
best-in-class, game-changing, at the end of the day.

## How to use this

When asked to draft anything that other people will read, `get_skill` this
first and follow it. When editing something the reader wrote, respect their
voice: fix what is wrong, do not rewrite what is merely different from how you
would have put it.

## Worked example

> **Draft:** "We are excited to announce that we have leveraged our robust new
> platform to unlock a seamless experience for our valued customers!"

> **In house style:** "Billing now runs on the new platform. Invoices arrive
> the morning after a period closes instead of three days later."

The second one says what changed. The first one says nothing.
', 'skill');
  insert into public.nodes (space_id, parent_id, kind, name, slug, content, content_type)
  values (v_space, v_folder, 'file', 'Onboarding a Colleague', 'onboarding-a-colleague', '---
name: Onboarding a Colleague
description: Bring somebody up to speed on a project from what is already written down
---

# Onboarding a Colleague

The useful version of onboarding is not a document written for newcomers and
then left to rot. It is the project''s real notes, made readable by the new
person, and a Claude that can read them on their behalf.

## Bringing somebody in

1. Share the project folder with them, as **viewer** if they are learning and
   **editor** if they will be contributing. Sharing a folder reaches everything
   inside it.
2. Point them at `/settings/mcp` to create their own token.

That is the whole setup. Their token acts as them, so they see the folder you
shared and nothing else in your space. There is no separate copy of the
material to keep in step, and nothing to revoke later except the share itself.

## What their Claude should do first

With this skill loaded, on being asked to get up to speed on a project:

1. `list_spaces`, then `search` the space for the project name.
2. Read, in this order: anything under `decisions/`, anything under
   `context/`, then the project''s own pages.
3. Produce a short brief: what the project is, what has been decided and why,
   what is still open, and who to ask about what.
4. **List what you could not find.** A gap named on day one gets filled. A gap
   papered over becomes a wrong assumption three weeks later.

## Worked example

> **New joiner:** Get me up to speed on Billing.

> **Claude:** Billing moved to the new platform on 4 September. Invoices are
> generated the morning after a period closes. Two decisions worth knowing:
> NDJSON for exports, because the attachment metadata does not flatten to CSV;
> and Postgres for search rather than a separate service, to keep permissions
> in one place. Still open: whether deleted records get a tombstone.
>
> I could not find anything about how refunds are handled, or who owns the
> relationship with the payment provider. Worth asking before you touch either.
', 'skill');
  insert into public.nodes (space_id, parent_id, kind, name, slug, content, content_type)
  values (v_space, v_folder, 'file', 'Runbooks', 'runbooks', '---
name: Runbooks
description: Follow an operational procedure from Postit, reading the current version rather than a remembered one
---

# Runbooks

A runbook is worth having because it is followed the same way every time,
including at three in the morning by somebody who has never done it before.

## Following one

**Always `read_page` the runbook before starting, every time.** Do not work
from a copy you read earlier in the conversation, and do not work from memory
of a previous run. Procedures change, and the whole point is that the current
version is the one that gets followed.

Then:

1. Say which runbook you are following and its last-updated date.
2. Work through the steps in order. Do not skip a step because it looks
   unnecessary; if it looks unnecessary, say so and ask.
3. Stop at anything the runbook marks as needing a human decision. Marked
   steps are marked because somebody was burned.
4. At the end, report what you did, what you observed, and anything that
   differed from what the runbook said would happen.

## Writing one

- One page per procedure, under `runbooks/`.
- Start with **when to use this** and **when not to**.
- Numbered steps, one action each, with the exact command or the exact screen.
- Mark steps that need a human decision with **STOP**.
- End with **how to tell it worked** and **how to undo it**.

## Keeping them true

When a run turns up something the runbook got wrong, fix the runbook while it
is fresh: `read_page`, then `update_page` with the version you were given. A
runbook that is wrong once is worse than no runbook, because it will be
followed anyway.

## Worked example

`runbooks/restore-a-deleted-space`:

```markdown
# Restore a deleted space

**Use when:** somebody deleted a space and wants it back within 7 days.
**Do not use when:** they want a single page back. See [[Restore a Page]].

1. Confirm the request came from the space owner. **STOP** if it did not.
2. Find the deletion in the audit log: \`select * from audit where ...\`
3. **STOP.** Confirm the restore window with whoever is on call.
4. Run the restore: \`select restore_space(''<id>'')\`

**How to tell it worked:** the owner can open /s/<slug> and the tree matches
the node count from step 2.

**How to undo it:** delete the space again. Restoring is additive.
```

At three in the morning, the two **STOP** lines are the entire value of the
page.
', 'skill');
  raise notice 'Postit space created';
end $$;

