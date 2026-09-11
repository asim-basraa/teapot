# Taking Post-it to production

> **Progress, 11 September.** Phase 3 is done: the production database carries
> every migration but one, and `main` is promoted and deployed. What is left is
> in phases 1, 2 and 4, and all of it needs a dashboard. The three blocking
> items are the signup hook, the staged Railway patch, and the Cloudflare SSL
> mode. Each is marked **TODO** below.

Written after checking the production environment rather than from memory.
Everything here was true at the time of writing; the parts I could not read
for myself are marked **verify**.

Production today serves the code from `main` as of 9 September, against a
database with no accounts and no content, and is missing fourteen of the
thirty migrations. It is reachable at `post.maqsoodlabs.com`, so it is not a
private staging area: it is a live site showing an old build.

The order below matters. Configuration first, then the database, then the
code, then the first account, because each step needs the one before it.

---

## Phase 0: two decisions

**Email when you share with somebody who already has an account.** There is
none. The only mail this product sends is sent by the auth service on its own
account when it invites a new address; there is no sender for anything else.
Adding one means choosing a provider (Resend, Postmark, or plain SMTP),
storing a key, and writing templates. Launching without it is reasonable:
people are told in **Shared with you** when they next open their spaces.

**The landing page at `/` still says "Coming soon."** If the site is public at
launch, that is the first thing a stranger reads.

---

## Phase 1: the production Supabase project

Project `postit`, `https://supabase.com/dashboard/project/ylqtvfghqfwotfhjmtgl`.
None of this can be done from code, and none of it is visible to me.

1. **TODO. Enable the signup hook. Do this first.**
   Authentication → Hooks → Before User Created →
   `public.hook_restrict_signup_by_email_domain`.
   The function is already in the database; whether the auth service calls it
   is a dashboard setting. **Until it is on, anybody on the internet can
   create an account**, because the restriction lives entirely in that hook.

2. **TODO. URL configuration.** Site URL `https://post.maqsoodlabs.com`. Redirect
   allow list must include `https://post.maqsoodlabs.com/**`. Without it,
   confirmation and invitation links bounce to the site root instead of
   landing where they should.

3. **TODO. SMTP.** Authentication → Emails. Without a real sender, no confirmation
   email goes out and **you cannot create even the first account**.

4. **TODO. Rate limits.** The default is thirty sign-ins and sign-ups per five
   minutes per IP address. If several people will be signing in from one
   office network, raise it: an exhausted limit refuses a *correct* password
   with the same message a wrong one gets.

5. Done. The key is already in Railway's staged patch.

---

## Phase 2: the Railway production environment

Project `postit`, service `web`,
`https://railway.com/project/3a3f54d9-0797-4a21-8c34-2c5a6918ea47`.

6. **TODO, and this is the one blocking item here. Press Deploy on the
   production environment.** The key is entered but sits in a staged patch
   that has never been committed, so the running service does not have it.
   `list-variables`, which reads the live service, does not show it; the
   dashboard does, because that view applies staged changes. Until it is
   deployed the MCP endpoint refuses every token and no invitation can be
   sent.

   I tried to commit it from here and the call timed out at the tooling layer,
   twice on different days, applying nothing both times. It is one click in the
   dashboard.

7. **Verify the other variables.** Railway hides values from me, so these are
   yours to check: `NEXT_PUBLIC_SITE_URL` must be
   `https://post.maqsoodlabs.com`, since every emailed link is built from it;
   `NEXT_PUBLIC_SUPABASE_URL` must be the `postit` project, not
   `postit-staging`; `NEXT_PUBLIC_APP_ENV` should say `production`.

8. **The staged patch was pointing production at the wrong branch, and is
   now fixed.** It had been edited to build from
   `claude/teapot-setup-requirements-ddy3n1`, a working branch stuck at an
   early September commit, so deploying it would have rolled production back
   by thirty commits. Its source is now `main` again. What remains in it is
   the service role key and the move from `sfo` to `sin`, which puts the
   application in the same region as its database.

9. **The DNS for `post.maqsoodlabs.com` needs one check.** The `CNAME` to
   `bu7v20tg.up.railway.app` is in Cloudflare, confirmed. Railway still reads
   its current value as empty and marks the record as requiring an update,
   while reporting the domain verified and the certificate valid.

   The usual cause of exactly that pair of readings is **Cloudflare's proxy
   being on**: an orange-clouded record answers public lookups with
   Cloudflare's own addresses rather than the CNAME target, so Railway's check
   sees no match even though traffic reaches the service. Either turn the
   proxy off for this record, which makes Railway's check agree and is the
   simpler arrangement; or keep it on and make sure Cloudflare's SSL/TLS mode
   is **Full (strict)**, because Flexible in front of Railway produces a
   redirect loop.

   The settling test takes ten seconds: open `https://post.maqsoodlabs.com`.
   If the old "Coming soon" page appears, it resolves and terminates TLS
   correctly and Railway's status line is merely pedantic. I cannot run that
   test myself: this container has no DNS tooling and its egress proxy refuses
   the host.

10. **Turn on "Wait for CI"** (check suites) for the production environment.
    It is off, so `main` deploys whether or not the tests passed. Staging is
    the same, and is the reason a red commit has reached it more than once.

---

## Phase 3: promoting, which is mine to do on your word

11. **Done, 11 September.** Thirteen of the fourteen are applied and the
    schema was verified afterwards by probing it: twelve functions, five
    triggers, the delta columns present and the old content column gone, and
    the `authenticated` grantee type. The fourteenth is the documentation
    space seed, deliberately held for phase 4.

    The fourteen were: comments,
    authenticated grants, sharing with everyone, the space home protection,
    the documentation space, invitations, visibility, node capabilities,
    revisions, the two rename steps, revision deltas, platform administrators,
    and shared-with-you. Migrations before the code, because every one of them
    is additive and old code ignores what it does not know about, while new
    code against an old database breaks immediately.

12. **Done, 11 September.** `main` is at `6bbd0b0`, thirty commits promoted,
    and Railway built and deployed it successfully.

---

## Phase 4: the first account

This cannot happen before phase 3, and two seeds cannot happen before it.

13. **You sign up** at `post.maqsoodlabs.com` as `asim@maqsoodlabs.com` and
    follow the confirmation email. Blocked until phase 1 is done: without
    SMTP there is no confirmation email to follow.

14. **I run two things that were written to wait for you.**

    The documentation space seed has deliberately **not** been applied to
    production. It looks for that address and returns quietly when it is
    absent, and a migration that has skipped never runs again, so applying it
    to an empty database would have burned it. It goes in after you sign up,
    where it does its job in one pass.

    The first-administrator step did run, as part of the platform
    administrators migration, and found nobody to promote. Once your account
    exists I set the flag. Until then production has nobody who can reach
    `/admin`.

---

## Phase 5: proving it

15. `/status` names the environment and the deployed commit, and says whether
    each piece of configuration is present. `/api/health` answers plainly.
16. Sign up a second account from a different address and confirm the domain
    gate refuses one outside `maqsoodlabs.com`.
17. Share a page with that second account and confirm it appears in their
    **Shared with you**.
18. Create an MCP token and connect a client, which is the check that the
    service role key landed.
19. Open a page you have not shared, from the second account, and confirm it
    is a 404 rather than a refusal.

---

## What will still be true on launch day

- No email when you share with somebody who already has an account.
- The Claude apps need the token in the connector URL, because their dialog
  takes a URL and nothing else. OAuth is the replacement and is not built.
- Externally hosted images do not render (#10).
- Only the last three versions of a page are kept.
- An administrator can count what people hold and never read it, which is
  deliberate.
