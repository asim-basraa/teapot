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
const MEMBER_SPACE = `member-notes-${RUN}`;

test.describe.configure({ mode: "serial" });

test.describe("Seeing the team you are on", () => {
  let ownerCtx: BrowserContext;
  let memberCtx: BrowserContext;
  let otherCtx: BrowserContext;
  let strangerCtx: BrowserContext;
  let owner: Page;
  let member: Page;
  let other: Page;
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
    // who is neither the reader nor the owner. Kept open, because they are also
    // the person a page shared with the team has to actually reach.
    otherCtx = await browser.newContext();
    other = await otherCtx.newPage();
    await registerAndConfirm(other, OTHER, PASSWORD);

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
    await otherCtx.close();
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

  test("a member can share a page of their own with the team", async () => {
    // The gap QA found from the other end. Somebody is put on a team that lives
    // in another space, writes something in their own, and wants the team to
    // read it. Teams used to be grantable only inside the space that defined
    // them, so the picker did not offer this team and naming it was refused.
    await createSpace(member, "Member Notes", MEMBER_SPACE);

    const memberSpaceId = (await member
      .locator(".space-shell")
      .getAttribute("data-space-id")) as string;

    const page = await member.request.post("/api/v1/nodes", {
      data: { space_id: memberSpaceId, kind: "file", name: "Handover" },
    });
    expect(page.status(), await page.text()).toBe(201);

    await member.goto(`/s/${MEMBER_SPACE}/handover`);
    await member.getByRole("button", { name: "Share" }).first().click();

    const dialog = member.getByRole("dialog");
    await dialog.getByLabel("Share with").selectOption("team");

    // Qualified by where it lives, because it does not live here.
    const picker = dialog.getByLabel("Team");
    await expect(picker).toContainText("Duty Engineers (in Runbooks)");

    await picker.selectOption({ label: "Duty Engineers (in Runbooks)" });
    // And it says what sharing with somebody else's team actually commits you
    // to, before you do it rather than after.
    await expect(dialog).toContainText("decides who is on it");

    await dialog.getByRole("button", { name: "Share", exact: true }).click();
    await expect(dialog.locator(".share-list")).toContainText("Duty Engineers");
  });

  test("and it reaches the people on that team, across the space boundary", async () => {
    await other.goto(`/s/${MEMBER_SPACE}/handover`);
    await expect(other.locator("h1")).toContainText("Handover");

    await other.goto("/teams");
    const card = other.locator(".my-team", { hasText: "Duty Engineers" });
    await expect(card.locator(".team-reach-list")).toContainText("Handover");
  });

  test("including whoever made the team, who is on it", async () => {
    // Making a team puts you on it, so a page shared with the team reaches you
    // like anybody else on it. That is the real thing being accepted when you
    // share with somebody else's team: they decide who is on it, and they are
    // one of them. They can take themselves off, and the reading goes too.
    await owner.goto(`/s/${MEMBER_SPACE}/handover`);
    await expect(owner.locator("h1")).toContainText("Handover");
  });

  test("but reaches nobody else at all", async () => {
    expect(
      (await stranger.goto(`/s/${MEMBER_SPACE}/handover`))?.status(),
    ).toBe(404);
  });

  test("and a team you are not on is not yours to share with", async () => {
    // The stranger knows the id, which is the whole point: knowing it is not
    // being on it.
    await createSpace(stranger, "Stranger Space", `stranger-${RUN}`);
    const strangerSpaceId = (await stranger
      .locator(".space-shell")
      .getAttribute("data-space-id")) as string;

    const page = await stranger.request.post("/api/v1/nodes", {
      data: { space_id: strangerSpaceId, kind: "file", name: "Theirs" },
    });
    expect(page.status(), await page.text()).toBe(201);
    const pageId = (await page.json()).node.id;

    const offered = await stranger.request.get(`/api/v1/nodes/${pageId}/teams`);
    expect(offered.status()).toBe(200);
    expect((await offered.json()).teams).toEqual([]);

    const refused = await stranger.request.post(
      `/api/v1/nodes/${pageId}/grants`,
      { data: { team_id: teamId, role: "viewer" } },
    );
    expect(refused.status()).toBe(403);
  });

  test("the member's own spaces page offers the way in", async () => {
    await member.goto("/spaces");

    const link = member.locator(".teams-link").getByRole("link");
    await expect(link).toContainText("You are on one team");
    await link.click();
    await expect(member).toHaveURL(/\/teams$/);
  });
});
