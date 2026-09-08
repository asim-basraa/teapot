# Teapot: QA handover

Everything a tester needs to start, plus the things worth knowing before you
file a bug. Written for the first QA round.

---

## What Teapot is

A knowledge garden where **who can see what is the product**, not a setting on
the side of it. People write Markdown in spaces, organise it in folders, and
share individual pages or whole folders with named people, with teams, or with
the public.

The one idea to hold in your head while testing: **content you are not allowed
to read must be indistinguishable from content that does not exist.** Not "you
do not have permission", which admits the page is there. A plain 404, the same
one a typo produces. If you ever find a way to tell the difference, that is a
bug and it is the most valuable bug you can file.

---

## Getting in

**Staging:** https://web-staging-347f.up.railway.app

**Signing up.** Registration is open to anyone with a `@maqsoodlabs.com`
address. Everyone else is refused unless they have been invited.

> **Known gap.** There is no invitation screen yet. If you are testing from an
> address outside `maqsoodlabs.com`, you cannot register on your own and
> somebody has to add an invitation for you directly in the database. Flag this
> at the start of your round rather than at the end of it.

**Confirming your email.** You get a real confirmation email; the link signs you
in and lands you on your spaces. If it does not arrive, check spam before
reporting it, then report it.

**Forgot your password** works from the sign-in page and sends a real email too.

---

## What to test, and what "correct" looks like

### Spaces and pages

Create a space, and it comes with a welcome page. Inside, build folders and
pages, rename them, drag them about, delete them.

Things worth trying to break:

- Rename a folder while you are reading a page inside it. You should be carried
  to the page's new address, not stranded on a dead URL.
- Give two things in the same folder the same name. It should refuse, clearly.
- Move a folder into itself. It should refuse.
- Delete a folder with pages in it. The pages go too, which is intended.

### Editing

Pages are Markdown. The editor is deliberately plain: a text area, a Save, a
Cancel.

**Concurrent edits.** Open the same page in two browsers, edit both, save both.
The second save must be refused and must show you the version that is now
stored, with your own text still in the box. Nobody's writing is ever silently
overwritten. This is worth trying hard to break.

**What renders:** GitHub-flavoured Markdown, callouts, highlights, LaTeX maths,
syntax-highlighted code, and Mermaid diagrams. A malformed diagram shows its
error and its source rather than disappearing.

### Wikilinks and backlinks

Write `[[Some Page]]` to link to another page in the space. At the bottom of
every page, "Linked from" lists the pages that point at it.

The one that matters: a link to a page **you cannot read** and a link to a page
**that does not exist** must look exactly the same, an inert grey span. If a
forbidden link looks different in any way, that difference is a leak.

### Sharing

Every page and folder has a Share dialog for whoever administers it.

- Share with a person by email, as viewer, editor or admin.
- Share with a team, if the space has any.
- Sharing a folder reaches everything inside it, at any depth.
- The dialog lists who has access and, for inherited access, names the folder it
  came from. "Why can this person see this" should always have an answer.
- Revoking takes effect on the next request.

Try: share a folder, then check a page three levels down. Try: share one page
and confirm its siblings still 404. Try: raise somebody from viewer to editor
and confirm the Edit link appears for them.

### Teams

From a space you own, the **Teams** button in the header. Create a team, add
people by email, share a folder with the team.

- Removing somebody from a team removes their access immediately.
- Deleting a team removes every grant made to it.
- A member of a team cannot manage that team. Only the space owner can.

### Publishing

In the Share dialog, "Anyone with the link can read this".

- A published folder publishes everything inside it.
- Open a published page in a private window: it should render, with a Sign in
  link and no editing.
- Everything not published must still 404 for that private window.
- On a page that is public *because a folder above it is*, the toggle is
  disabled and says where the publicness comes from. Turning it off there would
  do nothing, so it does not pretend otherwise.

### Search

The search box is in the sidebar. It searches the space you are in.

The important case: a word that appears **only** in a page you cannot read must
return nothing at all. Not a result with the content hidden. Nothing.

Anonymous visitors searching a space get exactly its published pages.

### Comments

At the bottom of every page. Reading a page is enough to comment on it; you do
not need edit rights.

- One level of replies. You cannot reply to a reply.
- You can delete your own; an administrator of the page can delete anybody's.
- Deleting a comment that has replies leaves "This comment was withdrawn" so the
  answers underneath still make sense. Deleting one with no replies removes it
  entirely.
- There is no editing a comment after posting.
- **Comments require an account, even on a published page.** Publish a page,
  open it logged out: you see the document and no conversation. This is
  deliberate.

### Articles and skills

Every page is an **article** or a **skill**. Skills are Markdown files written
to Claude's conventions, so Teapot can double as a skills repository.

- The **+ Skill** button creates one with its frontmatter already filled in.
- The Type dropdown in the editor reclassifies a page.
- A skill with no `name` or `description` still saves, and shows a warning. It
  is never rejected: losing your writing over a formatting detail would be the
  worse outcome.
- Frontmatter must not appear as body text on the rendered page.
- The sidebar marks skills with a badge.

### Connecting to Claude (MCP)

**Your spaces → Connect Teapot to Claude**, or `/settings/mcp`.

Create a token. It is shown **once**, with a ready-to-paste configuration block.
There is no way to see it again, by design; if you lose it, revoke and make
another.

What a connected Claude can do: list spaces, search, read pages, list and fetch
skills, create pages, update pages. What it cannot do: delete anything, move
anything, or change who can see anything.

The property to test: **a token reaches exactly what its owner reaches, and
never more.** Make a token, then have somebody share something new with you and
confirm it appears; have them revoke it and confirm it disappears. Revoking the
token itself must stop it on the very next request.

> **Known gap.** Until staging's service key is configured, the MCP endpoint
> refuses every token. Check with Asim before filing this.

---

## Where to look when something goes wrong

**Status page:** `/status` on either environment. It shows which environment you
are on, the commit that is deployed, and whether each piece of configuration is
present. Include what it says in any bug report about something being broken
rather than merely wrong.

**Health check:** `/api/health`.

---

## Known gaps, so you do not spend time on them

These are known and either scheduled or deliberate. Report them only if the
behaviour differs from what is written here.

| Gap | Status |
| --- | --- |
| No invitation screen; outside addresses cannot self-register | Not built |
| No documentation page explaining MCP or skills | Next up (#14) |
| Google Drive image links do not render | #10, not built |
| No platform administrator view across spaces | #15, not built |
| Landing page at `/` is still a placeholder | Deliberate for now |
| Staging is hosted in San Francisco, its database in Singapore | Known; staging is slower than production for this reason alone |
| Attachments and uploads | Will not be built. Images are referenced from elsewhere; diagrams are Mermaid |

---

## What is already tested automatically

So you know where the thin ice is, and where it is not.

- **114 database-level assertions** covering every access rule: inheritance,
  teams, publishing, revocation, search filtering, comment visibility, and the
  specific three-valued-logic trap that once let any signed-in user grant
  themselves administrator on any page.
- **84 browser tests** across twelve suites, driving real sign-ups with real
  confirmation emails, and using two or three separate browsers wherever the
  question is what a *different* person can see.
- **57 unit tests** on the renderer and the pure logic.

All of it runs on every push and must be green before anything merges.

What this does **not** cover, and where your attention is worth most:

- Anything visual. Layout, spacing, dark mode, small screens, long names,
  right-to-left text, very long pages.
- Real email in the wild: deliverability, spam folders, what the messages
  actually look like.
- Anything about how it *feels*: whether the affordances are where you expect,
  whether the errors say something useful, whether the flow makes sense to
  somebody who has not read this document.
- Anything with several people acting at once in ways the tests do not imagine.

---

## Filing a bug

Please include:

1. Which environment, and what `/status` says the commit is.
2. Which account you were signed in as, and what that account had been granted.
3. What you expected and what happened.
4. For anything permission-related: **who else could see it, and who could not.**
   That is the part that tells us whether it is a bug or the design.

Anything where somebody sees content they were not granted is the highest
priority, ahead of everything else on this page.
