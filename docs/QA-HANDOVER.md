# Post-it: QA handover

Everything a tester needs to start, plus the things worth knowing before you
file a bug. Written for the first QA round.

---

## What Post-it is

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

**Read `/docs` first.** It is public, needs no account, and explains what Post-it
is, how to connect it to Claude, and what a connected Claude can and cannot
reach. It is also a thing to test in its own right.

**Then read the Post-it space**, at `/s/postit`, once you are signed in. It is
the same material as living content: what Post-it is, connecting Claude, how
sharing works, and six starter skills you can copy into your own space. It is
shared with everyone who has an account and with nobody who does not, so it
doubles as a check on that: open `/s/postit` in a private window and it must
404.

**Signing up.** Registration is open to anyone with a `@maqsoodlabs.com`
address. Everyone else is refused unless they have been invited.

**Being invited.** Somebody sharing a page or folder with an address that has
no account now invites it. The invitation email arrives from Post-it; following
the link asks you to set a password and then puts you straight on the thing you
were shared. That is the route in for a tester whose address is not on
`maqsoodlabs.com`: ask somebody to share something with you.

**Confirming your email.** You get a real confirmation email; the link signs you
in and lands you on your spaces. If it does not arrive, check spam before
reporting it, then report it.

**Registering an address that already has an account sends nothing.** The form
still says a link is on its way, because Supabase deliberately refuses to
confirm or deny whether an address is registered: doing so would turn the
signup form into a way of discovering who has an account. So if you are waiting
on an email that never comes, try signing in before reporting it. This is not a
bug, and it is the single most common way to lose ten minutes here.

**Forgot your password** works from the sign-in page and sends a real email too.

---

## What to test, and what "correct" looks like

### Your account

The header of every signed-in page shows the address you are signed in as, and
that is a link to `/account`. Worth checking with two accounts open in two
browsers: each header must name its own.

The account page gathers what is about you rather than about a space: which
account this is, your spaces, connecting Claude, and changing your password.
Changing it there should tell you it worked and leave you where you are; the
old password must then be refused at sign-in and the new one accepted.

### Spaces and pages

Create a space, and it comes with a welcome page. Inside, build folders and
pages, rename them, drag them about, delete them.

The space's own front page is not one of the files: it has its own link above
the tree, and it is renamed by renaming the space. Renaming the space changes
its name in the header, on its front page, and in the list of spaces, and
leaves the address alone.

New pages and folders are made from the tree header for the top level, and from
a folder's own page for anything inside it. Click a folder to open it.

Things worth trying to break:

- Rename a page, then open it. The heading at the top must be the new name.
  A page is titled by its name, never by whatever the body says.
- Rename a folder while you are reading a page inside it. You should be carried
  to the page's new address, not stranded on a dead URL.
- Rename a space, then reload /spaces and the space itself. Both must say the
  new name, and every link you had must still work.
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

- Share is offered in two places for every page, folder and skill: beside it in
  the sidebar, and at the top of whatever you are reading.
- Share with a person by email, as viewer, editor or admin.
- Share with a team, if the space has any.
- Sharing a folder reaches everything inside it, at any depth.
- The dialog lists who has access and, for inherited access, names the folder it
  came from. "Why can this person see this" should always have an answer.
- Revoking takes effect on the next request.

Try: share a folder, then check a page three levels down. Try: share one page
and confirm its siblings still 404. Try: raise somebody from viewer to editor
and confirm the Edit link appears for them.

**What the person on the other end sees.** This was reported as missing twice,
so it is worth stating exactly. There are two cases and they behave
differently on purpose:

| You share with | What reaches them |
| --- | --- |
| An address with **no account** | An invitation **email**, because that is the only way they can get in at all. See [Inviting somebody who has no account](#inviting-somebody-who-has-no-account). |
| Somebody who **already has an account** | An entry at the top of **Your spaces**, marked new, naming you. See [Shared with you](#shared-with-you). **No email.** |

There is deliberately no email in the second case, and that is a gap rather
than a decision: see the note at the end of [Shared with you](#shared-with-you).

### Teams

From a space you own, the **Teams** button in the header. Create a team, add
people by email, share a folder with the team.

- Removing somebody from a team removes their access immediately.
- Deleting a team removes every grant made to it.
- A member of a team cannot manage that team. Only the space owner can.

**What the new member sees.** Being added to a team appears at the top of their
**Your spaces**, marked new, naming whoever added them. So does anything shared
with that team, including things shared with it before they joined, which count
as news on the day they join rather than the day they were shared. Again there
is no email. See [Shared with you](#shared-with-you).

Worth checking, because it reads oddly the first time: a new member is told they
joined the team even though **team membership by itself grants no access to
anything**. That is correct. The team is how access arrives later.

### People, for a platform administrator

A **People** link appears in the header for administrators and for nobody else.
Everyone else gets a plain 404 on `/admin`, the same answer a typo gives, and
no link anywhere hinting the screen exists.

It lists every account with **how much they hold and never what it says**: how
many spaces, articles and skills they own, how many bytes that comes to,
whether they are disabled, and when they last signed in. Content is attributed
to whoever owns the space it sits in.

The property worth attacking hardest: **being an administrator is not access.**
Make somebody an administrator, then have them open a space they were never
shared. It must still 404. If an administrator can read somebody's writing
anywhere in this product, that is the highest-priority bug on this page.

- **Make admin / Stand down.** An administrator can appoint and remove others.
  The last one cannot stand themselves down, because a platform nobody can
  administer has no way back through the interface.
- **Disable.** Stops somebody signing in and touches nothing they hold. Their
  spaces, pages and grants are exactly as they were; enabling puts them back
  with nothing to restore. Check that a disabled person is refused at sign-in
  and that their shared pages still work for everybody else.
- **Hand over.** One space at a time, to a named person. The new owner
  administers everything in it; the old owner keeps only what they were
  separately granted.
- **Delete.** Refused while they still own a space, and the message says how
  many. Hand the spaces over first, then delete. The database refuses it too,
  so there is no route, including through the API, where deleting an account
  quietly takes a team's writing with it. Worth trying to find one.
- You cannot disable or delete **yourself**, and the buttons are not offered.

### Who can see this

One control at the top of the Share dialog, with four settings:

| Setting | Who that is |
| --- | --- |
| Private | Only the people and teams listed below, and the space's owner. |
| Everyone signed in to Post-it can read | Every person who can sign in. |
| Everyone signed in to Post-it can edit | The same people, with writing. |
| Public | The open internet. No account at all. |

The distinction between the middle two and the last matters more than anything
else on this screen, and it is what the whole control exists to keep apart.
Share a folder with everyone signed in, then open it in a private window: it
must still 404.

- **They are exclusive.** Publish something that was shared with everyone, and
  the grant to everyone is withdrawn; go back, and the public one is. Check the
  "Who has access" list after each change: there should never be two answers.
- Everyone can never be given admin, and the public can never be given editing.
  Neither is a decision anybody makes on purpose.
- A published folder publishes everything inside it. Open a published page in a
  private window: it should render, with a Sign in link and no editing.
- On a page that is public or shared *because a folder above it is*, the
  control shows this page's own setting and a line underneath naming the folder
  it comes from. Setting this page to Private there will not make it private —
  the message says so rather than letting you believe otherwise.

### Shared with you

**Your spaces** carries a **Shared with you** list at the top: pages, folders
and skills somebody granted you by name, things granted to a team you are on,
and being put on a team in the first place. Newest first, with who did it, and
the recent ones marked **new** until you have seen the list once.

This is what closes the gap where sharing with somebody who already had an
account did nothing they could see.

- Share a page with a colleague who has an account. It must appear at the top
  of their spaces list, marked new, naming you.
- Reload. The new marks go, and the entries stay.
- Add somebody to a team. That appears too, even though team membership by
  itself grants no access to anything.
- Nothing in anybody else's list, and nothing in the sharer's own: they did it,
  so it is not news to them.
- Owning a space is not being shared it, and must not appear.

**Where to find it:** the top of `/spaces`, which is where signing in lands
you. Nowhere else. There is no badge elsewhere in the product, no email, and
nothing inside a space.

> **Known gap, do not file it.** There is no **email** to somebody who already
> has an account, only this list. The only mail this product sends is sent by
> the auth service on its own account when it invites a new address; there is
> no mail sender configured for anything else, and adding one is a decision
> about infrastructure rather than a bug. Ask Asim before filing anything about
> it.

### Inviting somebody who has no account

Share with an email address that has never signed up. Post-it invites it: the
person appears in the list, and an invitation email goes out.

- Follow the link in that email. It should land on a page asking for a
  password, and after setting one you should be signed in and able to read the
  thing you were shared — not an empty list of spaces.
- Only an administrator of the item can invite. An editor sharing with a new
  address gets a 404, the same answer as for an item that does not exist.

### History

Every page has a **History** button next to Share. It is offered to anyone who
can read the page, not only to editors: "what did this say last week" is a
reader's question at least as often as a writer's.

- Pick a version on the left and the diff on the right compares it with the
  page as it stands. Unchanged lines show as unchanged, so a small edit reads
  as a small edit rather than a wholesale rewrite.
- **Only the last three versions are kept.** The newest entry is the page as it
  stands, so you can go back two saves and no further. Save a page four times
  and the first of those four is gone for good. That is deliberate, not a bug.
- **Restore** puts the old text back by writing it forward as a new version, so
  the restore is itself in the history and can itself be undone. It also
  pushes the oldest entry off the end, so the list stays at three.
- A viewer sees the history and gets no Restore button. Somebody who cannot
  read the page gets an empty history, which is what a page with no history and
  a page that does not exist both give.
- Pages that existed before this shipped have one baseline revision each,
  attributed to nobody, because nobody wrote it: it is a record of where we
  came in.
- A version is stored as the difference from the version after it, not as a
  copy of the page, which is why three versions cost a fraction of what one
  used to. Nothing about that should be visible: if a restored page comes back
  even slightly wrong, that is the highest-priority bug on this page after a
  permission leak.

Renaming is recorded and shown, but restoring only puts back content and type.
A name is part of the address, and moving a page is the tree's job.

### Search

The search box is in the sidebar. It searches the space you are in.

The important case: a word that appears **only** in a page you cannot read must
return nothing at all. Not a result with the content hidden. Nothing.

Anonymous visitors searching a space get exactly its published pages.

### Comments

At the bottom of every page, below the article and below the backlinks — never
attached to a paragraph. Reading a page is enough to comment on it; you do not
need edit rights.

- Post from one browser, reload in another: the second must see it. The panel
  re-reads on arrival, so a stale page should not be possible.

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
to Claude's conventions, so Post-it can double as a skills repository.

- **+ Skill** in the tree header, and **New skill** on a folder's page, create
  one with its frontmatter already filled in.
- The Type dropdown in the editor reclassifies a page.
- A skill with no `name` or `description` still saves, and shows a warning. It
  is never rejected: losing your writing over a formatting detail would be the
  worse outcome.
- Frontmatter must not appear as body text on the rendered page.
- The sidebar marks skills with a badge.

### Connecting to Claude (MCP)

**Your account → Connect Post-it to Claude**, or `/settings/mcp`.

Create a token and name it. A token can reach everything you can read, or be
pinned to a single space; pin it where you can, so a leak costs one space
rather than the account.

The token is shown **once**, with the configuration for each client already
built around it: the `claude mcp add` command line, an `.mcp.json` block, a
connector URL, and a curl for the Anthropic API. Each carries this token and
this Post-it's address, so connecting is copy and paste rather than transcribing
a secret by hand. There is no way to see it again; if you lose it, revoke it
and make another. Reload the page and the token must be gone while the entry
in the list stays.

**The Claude apps take a URL and nothing else.** Their Add custom connector
dialog has no field for a header, so the connector URL carries the token in the
path. This is weaker than a header on purpose, and the page says so in red: a
token in a URL is in every HTTP log that records the path, in whatever Claude
stores for the connection, and anywhere the URL is pasted. It is a stopgap
until Post-it speaks OAuth. Both routes reach the same endpoint and the same
content; if one works and the other does not, that is a bug.

What a connected Claude can do: list spaces, walk a space's tree, search, read
pages, list and fetch skills, create folders, create pages, update pages. What
it cannot do: delete anything, move anything, or change who can see anything.

Worth trying, because this is where the last round of bugs was:

- Ask Claude to file a folder of documents into a space. It should build the
  structure rather than a flat list.
- Ask for a folder by passing `content_type: "folder"` to a page, or by putting
  a slash in a page's name. Both must be **refused, and say what to do
  instead**. Quietly making something other than what was asked for is the bug
  that was fixed here.
- Make a folder in the browser, then ask Claude to find it. It should, through
  the tree, even though a folder has no text to search.

**A tool list is fetched once, when the connector is added.** A session
connected before a tool shipped will not see it, and that is the client's cache
rather than a missing feature. Reconnect before reporting a tool as absent.

The property to test: **a token reaches exactly what its owner reaches, and
never more.** Make a token, then have somebody share something new with you and
confirm it appears; have them revoke it and confirm it disappears. Revoking the
token itself must stop it on the very next request.

---

## Where to look when something goes wrong

**Status page:** `/status` on either environment. It shows which environment you
are on, the commit that is deployed, and whether each piece of configuration is
present. Include what it says in any bug report about something being broken
rather than merely wrong.

**Health check:** `/api/health`.

---

## Fixed since the last round

Worth a second look, because these are where the bugs were.

- **Renaming.** A page's title is now its name. Renaming shows through
  immediately on the page, not only in the sidebar.
- **Renaming a space.** There is a real one now, next to the space's name in
  the header. It changes the name in the header, on the front page and in the
  list of spaces, and leaves the address alone. The space's front page is no
  longer a file in the tree, and the database refuses to move or delete it —
  renaming it was what 404ed whole spaces.
- **Sharing a folder.** Folders are links now; click one to see what is inside.
  Share is offered beside every item in the sidebar as well as at the top of
  whatever you are reading.
- **Sharing with an address that has no account.** It invites them instead of
  refusing.
- **Who can see this.** The two separate controls, "everyone here" and "on the
  web", are one setting with four values, and choosing one withdraws the others.
- **Your account.** There is a page for it now, and the header of every
  signed-in page names the address you are signed in as and links to it.
- **History.** Every page keeps its versions, with a diff and a restore.
- **Connecting Claude.** A token now arrives with each client's configuration
  already around it, including a URL for the Claude apps, which take nothing
  else. Claude can create folders and walk a space's tree, and is refused
  rather than obliged when it asks for a folder the wrong way.
- **A refused sign-in keeps your address.** It used to empty both fields, so a
  mistyped password cost two. A sign-in refused because you have tried too
  often now says so, rather than telling you your password is wrong.
- **The MCP endpoint stopped throttling clients that were doing nothing
  wrong.** Its failure budget counted every request rather than every refusal,
  so a Claude filing a folder of documents ran into a 429 after twenty calls.
- **The product is Post-it**, and the rename reached everything a person
  reads. Identifiers deliberately did not move: the documentation space is
  still at `/s/postit`, the MCP server is still named `postit` in the
  configuration you paste into a client, and tokens begin `post_`. Any token
  issued before the rename still works.

---

## Known gaps, so you do not spend time on them

These are known and either scheduled or deliberate. Report them only if the
behaviour differs from what is written here.

| Gap | Status |
| --- | --- |
| No standalone invite screen; you are invited by being shared something | Deliberate for now. Sharing with an unknown address invites it |
| The Claude apps need the token in the URL | Stopgap. OAuth on the MCP endpoint is the replacement and is not built |
| A restore puts back content and type, never the name or the position | Deliberate. A name is part of the address; moving is the tree's job |
| Production has no content and is behind staging | Deliberate. Staging is where this round is tested |
| Google Drive image links do not render | #10, not built |
| No email when you share with somebody who already has an account | Known. They are told in **Shared with you**; email needs a mail sender this product does not have |
| An administrator cannot read anybody's content, only count it | Deliberate. It is the one exception this product does not make |
| Landing page at `/` is still a placeholder | Deliberate for now |
| Staging is hosted in San Francisco, its database in Singapore | Known; staging is slower than production for this reason alone |
| Attachments and uploads | Will not be built. Images are referenced from elsewhere; diagrams are Mermaid |

---

## What is already tested automatically

So you know where the thin ice is, and where it is not.

- **150-odd database-level assertions** covering every access rule:
  inheritance, teams, publishing, sharing with everyone, the exclusivity of the
  visibility setting, invitations and what accepting one delivers, revocation,
  search filtering, comment visibility, the protection on a space's front page,
  who may read and restore a page's history and the refusal to let anybody
  write it by hand, and the specific three-valued-logic trap that once let any signed-in user
  grant themselves administrator on any page.
- **145-odd browser tests** across eighteen suites, driving real sign-ups with
  real confirmation emails and real invitation emails, and using two or three
  separate browsers wherever the question is what a *different* person can see.
- **69 unit tests** on the renderer, the diff, the MCP throttle and the pure
  logic.

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
