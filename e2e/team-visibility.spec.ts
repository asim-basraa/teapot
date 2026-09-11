import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

/**
 * Seeing the team you are on.
 *
 * QA asked two questions of the teams feature and both were fair. If somebody
 * is added to a team and nothing is shared with it, what did adding them do?
 * And if a member cannot see inside the team, how is it meant to work at all?
 *
 * The first answer is "nothing, on purpose" — a team is a name to share with,
 * not a bundle of access — and the product never said so. The second was a real
 * gap: the owner could see the team, its roster and what it reached, and the
 * people on it could see none of the three. So a folder appeared in their list
 * with no account of where it came from.
 *
 * These tests hold the member's side of it to account, and check that widening
 * what a member can see did not widen what they can do.
 */
const RUN = Date.now().toString(36);
const OWNER = `tv-owner-${RUN}@maqsoodlabs.com`;
const MEMBER = `tv-member-${RUN}@maqsoodlabs.com`;
const OTHER = `tv-other-${RUN}@maqsoodlabs.com`;
const STRANGER = `tv-stranger-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `runbooks-${RUN}`;

test.describe.configure({ mode: "serial" });

test.describe("Seeing the team you are on", () => {
  let ownerCtx: BrowserContext;
  let memberCtx: BrowserContext;
  let strangerCtx: BrowserContext;
  let owner: Page;
  let member: Page;
  let stranger: Page;
  let spaceId: string;
  let teamId: string;
  let folderId: string;

  test.beforeAll(async ({ browser }) => {
    memberCtx = await browser.newContext();
    member = await memberCtx.newPage();
    await registerAndConfirm(member, MEMBER, PASSWORD);

    strangerCtx = await browser.newContext();
    stranger = await strangerCtx.newPage();
    await registerAndConfirm(stranger, STRANGER, PASSWORD);

    // A second person on the team, so "who else is on it" has somebody in it
    // who is neither the reader nor the owner.
    const otherCtx = await browser.newContext();
    const other = await otherCtx.newPage();
    await registerAndConfirm(other, OTHER, PASSWORD);
    await otherCtx.close();

    ownerCtx = await browser.newContext();
    owner = await ownerCtx.newPage();
    await registerAndConfirm(owner, OWNER, PASSWORD);
    await createSpace(owner, "Runbooks", SPACE);

    spaceId = (await owner
      .locator(".space-shell")
      .getAttribute("data-space-id")) as string;

    const folder = await owner.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "folder", name: "On Call" },
    });
    expect(folder.status(), await folder.text()).toBe(201);
    folderId = (await folder.json()).node.id;

    const team = await owner.request.post(`/api/v1/spaces/${spaceId}/teams`, {
      data: { name: "Duty Engineers" },
    });
    expect(team.status(), await team.text()).toBe(201);
    teamId = (await team.json()).team.id;

    for (const email of [MEMBER, OTHER]) {
      const added = await owner.request.post(
        `/api/v1/teams/${teamId}/members`,
        { data: { email } },
      );
      expect(added.status(), await added.text()).toBe(201);
    }
  });

  test.afterAll(async () => {
    await ownerCtx.close();
    await memberCtx.close();
    await strangerCtx.close();
  });

  test("a team that reaches nothing says so, rather than looking broken", async () => {
    await member.goto("/teams");

    const card = member.locator(".my-team", { hasText: "Duty Engineers" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Runbooks");
    await expect(card).toContainText("Nothing has been shared with this team");
    // The claim QA could not check: it is not a fault, and it says which.
    await expect(card).toContainText("ordinary state of a new team");
  });

  test("and the member can see who else is on it", async () => {
    await member.goto("/teams");

    const card = member.locator(".my-team", { hasText: "Duty Engineers" });
    await card.locator("summary").click();

    await expect(card.locator(".team-members")).toContainText(OTHER);
    await expect(card.locator(".team-members")).toContainText(MEMBER);
  });

  test("sharing a folder with the team tells the member that is why", async () => {
    const shared = await owner.request.post(
      `/api/v1/nodes/${folderId}/grants`,
      { data: { team_id: teamId, role: "viewer" } },
    );
    expect(shared.status(), await shared.text()).toBe(201);

    await member.goto("/teams");

    const card = member.locator(".my-team", { hasText: "Duty Engineers" });
    await expect(card).toContainText("Being on this team is why you can read");

    const row = card.locator(".team-reach-list li", { hasText: "On Call" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("viewer");

    // And it is a way in, not only an explanation.
    await row.getByRole("link", { name: "On Call" }).click();
    await expect(member).toHaveURL(new RegExp(`/s/${SPACE}/on-call`));
  });

  test("the owner sees the same list on their own teams screen", async () => {
    await owner.goto(`/spaces/${SPACE}/teams`);

    const card = owner.locator(".team-card", { hasText: "Duty Engineers" });
    await card.locator("summary").click();

    await expect(card).toContainText("What this team can reach");
    await expect(
      card.locator(".team-reach-list li", { hasText: "On Call" }),
    ).toBeVisible();
  });

  test("seeing the team is not administering it", async () => {
    // Unreadable and nonexistent are the same answer everywhere else in this
    // product, and widening the roster must not have made teams the exception.
    expect((await member.goto(`/spaces/${SPACE}/teams`))?.status()).toBe(404);

    const refused = await member.request.post(
      `/api/v1/teams/${teamId}/members`,
      { data: { email: STRANGER } },
    );
    expect(refused.status()).toBe(404);
  });

  test("and somebody on no team is told nothing about anybody's", async () => {
    await stranger.goto("/spaces");
    await expect(stranger.locator(".teams-link")).toHaveCount(0);

    await stranger.goto("/teams");
    await expect(stranger.locator("main")).toContainText(
      "You are not on any teams",
    );
    await expect(stranger.locator(".my-team")).toHaveCount(0);

    const roster = await stranger.request.get(
      `/api/v1/teams/${teamId}/members`,
    );
    expect(roster.status()).toBe(200);
    const body = await roster.json();
    expect(body.members).toEqual([]);
    expect(body.reach).toEqual([]);
  });

  test("the member's own spaces page offers the way in", async () => {
    await member.goto("/spaces");

    const link = member.locator(".teams-link").getByRole("link");
    await expect(link).toContainText("You are on one team");
    await link.click();
    await expect(member).toHaveURL(/\/teams$/);
  });
});
