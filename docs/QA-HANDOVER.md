# Post-it: QA handover

Everything a tester needs to start, plus the things worth knowing before you
file a bug.

**Start here.** The next section replays the two questions QA asked last round
and answers both, with the steps to verify each. One of them describes correct
behaviour the product failed to explain; the other was a genuine bug and is fixed.
Reading it first will save you filing the first one again.

Also this round: the front page is real rather than a holding page, and a link
shows that it has been clicked. Full list under
[Fixed since the last round](#fixed-since-the-last-round).

---

## Answers to last round's questions

QA asked two questions about teams. Both were fair, and they have different
answers: the first describes correct behaviour that the product never explained,
and the second was a real bug. Read both before testing teams, or you will file
the first one again and miss what was actually wrong.

### 1. "If a user is added to a team but the space is not shared with that user, what is the purpose of adding them to the team?"

**Verdict: working as designed. The product was wrong to leave you guessing, not
wrong in what it did.**

A team is **a name you can share with**, not a bundle of access. Adding somebody
to a team grants them nothing at all, and that is the point.

Consider the alternative. If membership carried the team's access, then adding
one person to a team would hand them, in a single click, everything that team had
ever been given — including pages shared with it months ago by somebody who has
since left, which nobody present remembers. Access would arrive silently, in
bulk, as a side effect of an administrative act. In a product whose whole subject
is who can see what, that is the worst possible default.

So the purpose of adding them first is what happens next:

- Share a folder **with the team**, once, and everybody on it can read that
  folder and everything beneath it.
- Add a fourth person later and they get the same thing, without anybody
  revisiting the folder.
- Take somebody off the team and their access goes with them, in every folder
  the team was ever given.

That is the whole value: sharing once instead of five times, and revoking once
instead of five times. Until the first share happens, a team is a list of names
and nothing more — correctly.

**What changed.** Nothing about the behaviour. What changed is that the product
now says so, in three places:

- The owner's **Teams** screen: the description no longer implies membership is
  access, and each team carries a **What this team can reach** list. When that
  list is empty it says "Nothing yet", explains that being on the team grants
  nobody anything on its own, and tells you how to change it.
- The member's **`/teams`** screen: a team with nothing shared says "Nothing has
  been shared with this team yet, so it gives you nothing to read for the
  moment. That is the ordinary state of a new team, not a fault."
- This document.

**How to verify.** Create a team, add somebody, share nothing. They must be able
to see the team exists and must **not** be able to read anything in the space.
Both screens should tell you that is expected. Then share one folder with the
team and watch it appear for them.

This is asserted at the database level too, so it cannot drift: a member of a
team with no grants resolves to no role and no read on every node in the space.

### 2. "If the user can only see a notification on the welcome screen but cannot see what is inside the team or who else has been added to the team, how is the team functionality expected to work?"

**Verdict: a real gap, and it is fixed.**

You were right, and the problem was worse than "a bit opaque" — it was
asymmetric. The question this product exists to answer is *who can see what*, and
until now:

- The **space owner** could see the team, its roster, and what it reached.
- The **people on the team** could see none of those three things.

So somebody added to "QA" would find a folder appear in their list with no
account of where it came from, no way to learn who else could read what they
wrote in it, and a notification on the welcome screen that was not even a link.
The one question they had — *why can I see this, and who else can?* — had an
answer for one party and none for the other.

**What changed.** A member now gets the same answer the owner does:

| Before | Now |
| --- | --- |
| Roster readable by the space owner only | Readable by the owner **or** anybody on the team |
| No screen for a member at all | **`/teams`**, listing every team you are on |
| "Added to this team" notification went nowhere | It links to `/teams` |
| No way to learn why a folder appeared | Each team lists what being on it lets you read |

For each team you are on, `/teams` shows the space it belongs to, how many people
are on it, who added you, **who else is on it**, and **what being on it lets you
read** — each entry a link straight to the page or folder.

**What deliberately did not change: seeing is not administering.** This is the
part most worth trying to break. A member has no write of any kind:

- `/spaces/<slug>/teams` is still a plain 404 for anybody but the space owner.
- A member cannot add anybody, remove anybody, rename the team, delete it, or
  share anything with it. Every one of those is refused with a 404.
- Only the space owner can remove somebody from a team — including themselves.
  A member cannot leave a team on their own. That is a known gap, listed below;
  do not file it as a bug.

**How to find it.** **Your spaces** carries a **You are on N teams** line when
you are on any, which goes to `/teams`. So does the "added to this team" entry in
**Shared with you**.

**How to verify, including the refusals.**

1. As the owner, create a team in your space and add two other people.
2. As one of them, open `/teams`. You should see the team, the space it is in,
   who added you, and both other names under **Who else is on it**.
3. Still as them, try `/spaces/<slug>/teams` directly. You must get a 404 —
   the same answer a typo gives, not a "permission denied".
4. As the owner, share a folder with the team.
5. Back as the member, reload `/teams`. The folder must be listed, with the role
   it carries, and clicking it must open it.
6. As somebody on **no** team: no **You are on N teams** line anywhere, `/teams`
   says you are on no teams, and asking for that team's roster directly returns
   nothing at all — not an error, nothing, which is what a team that does not
   exist also returns.

One thing to know before you file it: `/teams` shows your team-mates' email
addresses. That is deliberate. You are on a named team together, somebody put you
both there, and knowing who else can read what you write is exactly the thing
this product is for. It stops at the team — it reveals nobody in the space who is
not on a team with you.

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
pages, rename them, move them about, delete them.

**Moving, new this round, and QA was right about it.** The last document said you
could drag things about and you could not: moving was fully built underneath —
the endpoint, the rewriting of every descendant's address, the refusal to make a
folder its own ancestor — and nothing in the tree ever asked for it. That was a
documentation bug on my side, not a misreading on yours.

There are now two ways, and they do the same thing:

- **Drag a row** onto a folder. The row you are dragging fades, the destination
  is outlined, and illegal destinations refuse the drop rather than accepting it
  and failing. To take something back out to the top level, drop it on the
  **Files** header, which says "Move to the top level" while you are over it.
- **The Move button** on the row, which opens a list of destinations. This exists
  because a drag cannot be done from a keyboard and does not work **at all** on a
  touchscreen — that is a limitation of drag-and-drop in browsers, not a bug to
  file. On a phone or tablet, Move is the way, and it is not a lesser one.

Worth trying to break: a folder must not be offered as a destination for itself
or for anything inside it; where something already is must be listed but refused
rather than being a move that silently does nothing; and everything inside a
moved folder must come with it, with its address changed to match.

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

Changed this round. The two questions QA asked are answered in full under
[Answers to last round's questions](#answers-to-last-rounds-questions), including
how to verify each one; this section is the mechanics.

**The owner's side.** From a space you own, the **Teams** button in the header.
Create a team, add people by email, share a folder with the team.

- Removing somebody from a team removes their access immediately.
- Deleting a team removes every grant made to it.
- A member of a team cannot manage that team. Only the space owner can.
- Opening a team now shows **What this team can reach** beneath the roster. When
  nothing has been shared with it, it says so, and says how to change that.

**The member's side, new.** `/teams`, reached from **You are on N teams** on
**Your spaces**, and from the "added to this team" line in **Shared with you**,
which used to be the one notification in the product that went nowhere. For each
team you are on it shows the space it belongs to, how many people are on it, who
added you, **who else is on it**, and **what being on it lets you read**.

It is read-only, deliberately and completely. A member cannot add anybody,
rename the team, or share anything with it. `/spaces/<slug>/teams` is still a
plain 404 for anyone but the owner, and so is every write behind it.

Worth checking, because it still reads oddly the first time: a new member is told
they joined the team even though **team membership by itself grants no access to
anything**. That is correct, and `/teams` now says so on the team's own card.

**Worth trying to break.** Somebody on no team should get nothing: no **You are
on N teams** line on **Your spaces**, an empty `/teams` that says as much, and
nothing at all from a roster they ask for directly. Somebody on one team should
see that team and no other, and nobody's addresses but their own team-mates'.

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
  itself grants no access to anything. **New:** that line is now a link, and it
  goes to `/teams`. It used to be the one entry in this list that went nowhere,
  which is exactly the complaint QA filed about teams.
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
- **You can move pages and folders.** The tree offered Rename and Delete and no
  way to move anything, while the last handover claimed you could drag things
  about. Both a drag and a Move button now exist. See
  [Spaces and pages](#spaces-and-pages).
- **A refused move used to report success.** Asking to move something you may
  read but not edit answered 200 with the unmoved page. Nothing was ever moved
  that should not have been — the database refused it correctly — but the reply
  was untrue, and it is now the same 404 as every other refusal.
- **The app works on a phone.** It had no viewport meta tag, so a phone laid the
  page out at about 980px and scaled it down: every screen was a desktop layout
  shrunk to illegibility, and none of the responsive rules ever applied. With
  that fixed, the header wraps instead of running off the side, wide tables and
  code blocks scroll inside themselves rather than dragging the page sideways,
  and the tree's Share, Rename, Move and Delete buttons are visible without a
  hover — a touchscreen has none, so they were unreachable. Worth a real device:
  the automated check only proves no screen scrolls sideways at 360px, which is
  the difference between usable and not, but says nothing about how it looks.
- **A member of a team can see the team.** Who else is on it, and what being on
  it lets them read. Previously the owner could see all of that and the people
  on the team could see none of it. See [Teams](#teams).
- **Clicking a link now shows that you clicked it.** Every page that reads
  content waits on the database, so a slow navigation used to leave the page
  looking exactly as it did before the click, and people clicked again, which
  started the navigation over and made the wait longer. The link you clicked now
  carries a spinner until the next page arrives — the one you clicked, and not
  the others in the list.
- **The front page is the product, not a placeholder.** "Coming soon" is gone,
  and the footer carries the credit and a **Tell me a joke** box that asks for
  nothing: no account, no address, no name. Notes land on a page only the owner
  of the documentation space can read.
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
| A viewer cannot move anything | Correct. Moving needs edit, and the refusal is a 404 like every other |
| Production is behind staging | Deliberate. Staging is where this round is tested, and this round's team changes are not on production |
| A member cannot leave a team themselves | Known. Only the space owner can remove somebody. Report it as a gap, not a bug |
| `/teams` shows team-mates' email addresses | Deliberate. You are on a named team together and knowing who else can read what you write is the point |
| Google Drive image links do not render | #10, not built |
| No email when you share with somebody who already has an account | Known. They are told in **Shared with you**; email needs a mail sender this product does not have |
| An administrator cannot read anybody's content, only count it | Deliberate. It is the one exception this product does not make |
| Staging is hosted in San Francisco, its database in Singapore | Known; staging is slower than production for this reason alone |
| Dragging to move does nothing on a phone or tablet | Correct. Browser drag-and-drop is mouse-only; use the Move button |
| Attachments and uploads | Will not be built. Images are referenced from elsewhere; diagrams are Mermaid |

---

## What is already tested automatically

So you know where the thin ice is, and where it is not.

- **180-odd database-level assertions** covering every access rule:
  inheritance, teams, who may read a team's roster and what a team reaches,
  publishing, sharing with everyone, the exclusivity of the
  visibility setting, invitations and what accepting one delivers, revocation,
  search filtering, comment visibility, the protection on a space's front page,
  who may read and restore a page's history and the refusal to let anybody
  write it by hand, and the specific three-valued-logic trap that once let any signed-in user
  grant themselves administrator on any page.
- **155-odd browser tests** across twenty suites, driving real sign-ups with
  real confirmation emails and real invitation emails, and using two or three
  separate browsers wherever the question is what a *different* person can see.
- **69 unit tests** on the renderer, the diff, the MCP throttle and the pure
  logic.

All of it runs on every push and must be green before anything merges.

What this does **not** cover, and where your attention is worth most:

- Anything visual. Layout, spacing, dark mode, small screens, long names,
  right-to-left text, very long pages. This includes the new spinner on a
  clicked link: nothing automated checks how it looks, only that widening what a
  member can see did not widen what they can do.
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
