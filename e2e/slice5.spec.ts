import {
  test,
  expect,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

const RUN = Date.now().toString(36);
const OWNER = `team-owner-${RUN}@maqsoodlabs.com`;
const MEMBER = `team-member-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `teamed-${RUN}`;

const FOLDER = `/s/${SPACE}/handbook`;
const DEEP = `/s/${SPACE}/handbook/onboarding`;
const OUTSIDE = `/s/${SPACE}/private-note`;

test.describe.configure({ mode: "serial" });

test.describe("Slice 5: teams and team grants", () => {
  // Two people again: the whole question is what somebody else's membership
  // gets them, which cannot be shown from one session.
  let ownerCtx: BrowserContext;
  let memberCtx: BrowserContext;
  let owner: Page;
  let member: Page;
  let spaceId: string;
  let folderId: string;
  let teamId: string;

  test.beforeAll(async ({ browser }) => {
    memberCtx = await browser.newContext();
    member = await memberCtx.newPage();
    // The member must exist before they can be added: add_team_member resolves
    // an address to an account and refuses if there is none.
    await registerAndConfirm(member, MEMBER, PASSWORD);

    ownerCtx = await browser.newContext();
    owner = await ownerCtx.newPage();
    await registerAndConfirm(owner, OWNER, PASSWORD);
    await createSpace(owner, "Teamed Space", SPACE);

    spaceId = (await owner
      .locator(".space-shell")
      .getAttribute("data-space-id")) as string;

    const folder = await owner.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "folder", name: "Handbook" },
    });
    expect(folder.status(), await folder.text()).toBe(201);
    folderId = (await folder.json()).node.id;

    // A page inside the folder, to show a team grant reaching down, and one
    // outside it, to show that it does not reach sideways.
    for (const [name, parent] of [
      ["Onboarding", folderId],
      ["Private Note", null],
    ] as const) {
      const res = await owner.request.post("/api/v1/nodes", {
        data: { space_id: spaceId, parent_id: parent, kind: "file", name },
      });
      expect(res.status(), await res.text()).toBe(201);
    }
  });

  test.afterAll(async () => {
    await ownerCtx.close();
    await memberCtx.close();
  });

  test("the owner creates a team", async () => {
    await owner.goto(`/spaces/${SPACE}/teams`);
    await owner.getByLabel("New team").fill("Engineering");
    await owner.getByRole("button", { name: "Create team" }).click();

    await expect(owner.getByText("Engineering")).toBeVisible();

    const listed = await owner.request.get(`/api/v1/spaces/${spaceId}/teams`);
    const { teams } = await listed.json();
    expect(teams).toHaveLength(1);
    teamId = teams[0].id;
  });

  test("adding an address with no account says so", async () => {
    const res = await owner.request.post(`/api/v1/teams/${teamId}/members`, {
      data: { email: `nobody-${RUN}@maqsoodlabs.com` },
    });

    expect(res.status()).toBe(404);
    expect(await res.text()).toMatch(/no teapot account/i);
  });

  test("the owner adds a member", async () => {
    await owner.goto(`/spaces/${SPACE}/teams`);
    await owner.getByText("Engineering").click();
    await owner.getByLabel("Add by email").fill(MEMBER);
    await owner.getByRole("button", { name: "Add", exact: true }).click();

    await expect(owner.getByText(MEMBER)).toBeVisible();
  });

  test("membership alone grants nothing", async () => {
    // The team exists and they are on it, but nothing has been shared with it.
    const response = await member.goto(DEEP);
    expect(response?.status()).toBe(404);
  });

  test("the owner shares a folder with the team", async () => {
    const res = await owner.request.post(`/api/v1/nodes/${folderId}/grants`, {
      data: { team_id: teamId, role: "viewer" },
    });
    expect(res.status(), await res.text()).toBe(201);
  });

  test("every member can now read the folder and what is under it", async () => {
    expect((await member.goto(FOLDER))?.status()).toBe(200);

    const deep = await member.goto(DEEP);
    expect(deep?.status()).toBe(200);
    await expect(
      member.getByRole("heading", { level: 1, name: "Onboarding" }),
    ).toBeVisible();
  });

  test("and still nothing outside it", async () => {
    const response = await member.goto(OUTSIDE);
    expect(response?.status()).toBe(404);
  });

  test("a viewer grant to a team confers no editing", async () => {
    await member.goto(DEEP);
    await expect(
      member.getByRole("link", { name: "Edit", exact: true }),
    ).toHaveCount(0);
  });

  test("the sharing dialog names the team rather than saying 'team'", async () => {
    const res = await owner.request.get(`/api/v1/nodes/${folderId}/grants`);
    const { grants } = await res.json();
    const teamGrant = grants.find(
      (g: { grantee_type: string }) => g.grantee_type === "team",
    );
    expect(teamGrant, "the team grant should be listed").toBeTruthy();
    expect(teamGrant.grantee_name).toBe("Engineering");
  });

  test("a member cannot manage the team they are on", async () => {
    // Teams are administered by the space owner. Being on one is not a way in.
    const res = await member.request.post(`/api/v1/teams/${teamId}/members`, {
      data: { email: MEMBER, role: "manager" },
    });
    expect(res.status()).toBe(404);

    const roster = await member.request.get(`/api/v1/teams/${teamId}/members`);
    expect((await roster.json()).members).toHaveLength(0);

    expect((await member.goto(`/spaces/${SPACE}/teams`))?.status()).toBe(404);
  });

  test("removing the member removes their access", async () => {
    const roster = await owner.request.get(`/api/v1/teams/${teamId}/members`);
    const { members } = await roster.json();
    const theirs = members.find(
      (m: { email: string }) => m.email === MEMBER,
    );
    expect(theirs, "the member should be on the roster").toBeTruthy();

    const removed = await owner.request.delete(
      `/api/v1/teams/${teamId}/members/${theirs.user_id}`,
    );
    expect(removed.status()).toBe(204);

    expect((await member.goto(DEEP))?.status()).toBe(404);
  });

  test("deleting the team takes its grant with it", async () => {
    // Put them back first, so what is being tested is the deletion and not the
    // removal from the previous test.
    const added = await owner.request.post(`/api/v1/teams/${teamId}/members`, {
      data: { email: MEMBER },
    });
    expect(added.status(), await added.text()).toBe(201);
    expect((await member.goto(DEEP))?.status()).toBe(200);

    const deleted = await owner.request.delete(`/api/v1/teams/${teamId}`);
    expect(deleted.status()).toBe(204);

    expect((await member.goto(DEEP))?.status()).toBe(404);

    // The grant row is gone too, not merely inert: grantee_id is polymorphic
    // and carries no foreign key, so nothing cascades without the trigger.
    const grants = await owner.request.get(`/api/v1/nodes/${folderId}/grants`);
    const remaining = (await grants.json()).grants.filter(
      (g: { grantee_type: string }) => g.grantee_type === "team",
    );
    expect(remaining).toHaveLength(0);
  });
});
