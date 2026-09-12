import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { registerAndConfirm, createSpace, rowAction } from "./auth";

/**
 * Being in a space, as distinct from being shared something in it.
 *
 * These were the same mechanism and should not have been. Sharing answers
 * "this page, this person". Membership answers "you work here": the whole
 * space to read and to change, and the top of it to add to, which inheritance
 * could never reach because a top-level item has no parent to inherit from.
 *
 * The rule that does not follow from membership is deleting. That belongs to
 * whoever wrote the thing and to nobody else — not an administrator of it, and
 * not the owner of the space it is sitting in. Owning a space is owning the
 * room rather than the things people brought into it.
 */
const RUN = Date.now().toString(36);
const OWNER = `sm-owner-${RUN}@maqsoodlabs.com`;
const MEMBER = `sm-member-${RUN}@maqsoodlabs.com`;
const GUEST = `sm-guest-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `handbook-${RUN}`;

test.describe.configure({ mode: "serial" });

test.describe("Being in a space", () => {
  let ownerCtx: BrowserContext;
  let memberCtx: BrowserContext;
  let guestCtx: BrowserContext;
  let owner: Page;
  let member: Page;
  let guest: Page;
  let spaceId: string;
  let folderId: string;

  test.beforeAll(async ({ browser }) => {
    memberCtx = await browser.newContext();
    member = await memberCtx.newPage();
    await registerAndConfirm(member, MEMBER, PASSWORD);

    guestCtx = await browser.newContext();
    guest = await guestCtx.newPage();
    await registerAndConfirm(guest, GUEST, PASSWORD);

    ownerCtx = await browser.newContext();
    owner = await ownerCtx.newPage();
    await registerAndConfirm(owner, OWNER, PASSWORD);
    await createSpace(owner, "Handbook", SPACE);

    spaceId = (await owner
      .locator(".space-shell")
      .getAttribute("data-space-id")) as string;

    const folder = await owner.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "folder", name: "Team Notes" },
    });
    expect(folder.status(), await folder.text()).toBe(201);
    folderId = (await folder.json()).node.id;

    // Shared with nobody, so reaching it can only be membership.
    const theirs = await owner.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "file", name: "Owner Only" },
    });
    expect(theirs.status(), await theirs.text()).toBe(201);

    // The guest is shared one folder and is not in the space.
    const shared = await owner.request.post(
      `/api/v1/nodes/${folderId}/grants`,
      { data: { email: GUEST, role: "viewer" } },
    );
    expect(shared.status(), await shared.text()).toBe(201);
  });

  test.afterAll(async () => {
    await ownerCtx.close();
    await memberCtx.close();
    await guestCtx.close();
  });

  test("somebody outside the space sees nothing of it", async () => {
    expect((await member.goto(`/s/${SPACE}`))?.status()).toBe(404);
  });

  test("the owner puts them in it", async () => {
    await owner.goto(`/s/${SPACE}`);
    await owner.getByRole("link", { name: "Members" }).click();
    await expect(owner).toHaveURL(`/spaces/${SPACE}/members`);

    await owner.getByLabel("Add a person").fill(MEMBER);
    await owner.getByRole("button", { name: "Add" }).first().click();

    await expect(owner.locator(".member-list")).toContainText("Sm Member");
  });

  test("and they can now read everything in it, shared or not", async () => {
    await member.goto(`/s/${SPACE}/owner-only`);
    await expect(
      member.getByRole("heading", { level: 1, name: "Owner Only" }),
    ).toBeVisible();
  });

  test("and change it, which is what a shared space is for", async () => {
    await member.goto(`/s/${SPACE}/owner-only`);
    await expect(member.getByRole("link", { name: "Edit" })).toBeVisible();
  });

  test("and start something at the top, which inheritance never reached", async () => {
    await member.goto(`/s/${SPACE}`);
    await member
      .getByRole("button", { name: "New page at the top level" })
      .click();

    const asking = member.getByRole("dialog", { name: "New page" });
    await asking.getByRole("textbox").fill("Member Started This");
    await asking.getByRole("button", { name: "Create" }).click();

    // Creating from the tree header refreshes the tree rather than opening the
    // page; making one from inside a folder is the path that carries you in.
    const made = member
      .locator(".tree")
      .getByRole("link", { name: "Member Started This" });
    await expect(made).toBeVisible();

    await made.click();
    await expect(member).toHaveURL(
      new RegExp(`/s/${SPACE}/member-started-this`),
    );
    await expect(
      member.getByRole("heading", { level: 1, name: "Member Started This" }),
    ).toBeVisible();
  });

  test("but deleting belongs to whoever wrote it", async () => {
    // Theirs, so it is theirs to remove.
    await member.goto(`/s/${SPACE}`);
    const mine = member.locator(".tree-row", { hasText: "Member Started This" });
    await mine
      .getByRole("button", { name: "More for Member Started This" })
      .click();
    await expect(
      mine.getByRole("menuitem", { name: "Delete Member Started This" }),
    ).toBeVisible();
    await member.keyboard.press("Escape");

    // The owner's, so it is not — even though they may edit it.
    const theirs = member.locator(".tree-row", { hasText: "Owner Only" });
    await theirs.getByRole("button", { name: "More for Owner Only" }).click();
    await expect(
      theirs.getByRole("menuitem", { name: "Rename Owner Only" }),
    ).toBeVisible();
    await expect(
      theirs.getByRole("menuitem", { name: "Delete Owner Only" }),
    ).toHaveCount(0);
    await member.keyboard.press("Escape");
  });

  test("and not to the owner of the space either", async () => {
    // The reversal this whole model turns on. Owning the space is owning the
    // room, not the things people brought into it.
    await owner.goto(`/s/${SPACE}`);
    const theirs = owner.locator(".tree-row", {
      hasText: "Member Started This",
    });
    await theirs
      .getByRole("button", { name: "More for Member Started This" })
      .click();
    await expect(
      theirs.getByRole("menuitem", { name: "Delete Member Started This" }),
    ).toHaveCount(0);
    await owner.keyboard.press("Escape");

    // And the refusal is the database's rather than the screen's.
    const nodes = await owner.request.get(`/api/v1/nodes?space_id=${spaceId}`);
    const id = (await nodes.json()).nodes.find(
      (n: { name: string }) => n.name === "Member Started This",
    ).id;

    const refused = await owner.request.delete(`/api/v1/nodes/${id}`);
    expect(refused.status()).toBe(404);

    expect(
      (await member.goto(`/s/${SPACE}/member-started-this`))?.status(),
    ).toBe(200);
  });

  test("being shared one folder is not being in the space", async () => {
    await guest.goto(`/s/${SPACE}/team-notes`);
    await expect(
      guest.getByRole("heading", { level: 1, name: "Team Notes" }),
    ).toBeVisible();

    // The rest of the space is not theirs, and neither is the top of it.
    expect((await guest.goto(`/s/${SPACE}/owner-only`))?.status()).toBe(404);

    await guest.goto(`/s/${SPACE}/team-notes`);
    await expect(
      guest.getByRole("button", { name: "New page at the top level" }),
    ).toHaveCount(0);

    const refused = await guest.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "file", name: "Guest Should Not" },
    });
    expect(refused.status()).toBe(404);
  });

  test("and the roster is the owner's to change", async () => {
    expect(
      (await member.goto(`/spaces/${SPACE}/members`))?.status(),
    ).toBe(404);

    const refused = await member.request.post(
      `/api/v1/spaces/${spaceId}/members`,
      { data: { email: GUEST } },
    );
    expect(refused.status()).toBe(404);
  });

  test("taking somebody out takes the space with them", async () => {
    await owner.goto(`/spaces/${SPACE}/members`);
    await owner.getByRole("button", { name: `Remove ${MEMBER}` }).click();

    const confirming = owner.getByRole("dialog", {
      name: "Take them out of this space?",
    });
    // Said plainly, because it is the question somebody hesitates over.
    await expect(confirming).toContainText("Nothing they wrote is deleted");
    await confirming.getByRole("button", { name: "Remove" }).click();

    await expect(owner.locator(".member-list")).toHaveCount(0);

    expect((await member.goto(`/s/${SPACE}/owner-only`))?.status()).toBe(404);
  });

  test("but never what they wrote, which is the base rule", async () => {
    // The hole this closes. Access came from grants, from membership and from
    // owning a space, none of which is authorship, so somebody taken out of a
    // space lost the pages they had written in it: work only they could delete
    // and none of them could open.
    await member.goto(`/s/${SPACE}/member-started-this`);
    await expect(
      member.getByRole("heading", { level: 1, name: "Member Started This" }),
    ).toBeVisible();

    // And to change, since it is theirs.
    await expect(member.getByRole("link", { name: "Edit" })).toBeVisible();

    // It is still in the owner's space, and still visible to them too.
    await owner.goto(`/s/${SPACE}`);
    await expect(
      owner.locator(".tree").getByRole("link", { name: "Member Started This" }),
    ).toBeVisible();
  });

  test("and the owner can send their work home rather than destroy it", async () => {
    // The other half of deleting belonging to the author. The owner could not
    // remove a member's page from their own space at all, which is the gap this
    // closes: not by letting them delete it, but by sending it back.
    await owner.goto(`/s/${SPACE}`);

    const theirs = owner.locator(".tree-row", {
      hasText: "Member Started This",
    });
    await theirs
      .getByRole("button", { name: "More for Member Started This" })
      .click();
    await theirs
      .getByRole("menuitem", {
        name: "Remove Member Started This from this space",
      })
      .click();

    const confirming = owner.getByRole("dialog", {
      name: "Remove Member Started This from this space?",
    });
    // The word reads like deleting, so the dialog says plainly that it is not.
    await expect(confirming).toContainText("Nothing is deleted");
    await confirming.getByRole("button", { name: "Remove from space" }).click();

    await expect(
      owner.locator(".tree").getByRole("link", { name: "Member Started This" }),
    ).toHaveCount(0);
    expect(
      (await owner.goto(`/s/${SPACE}/member-started-this`))?.status(),
    ).toBe(404);
  });

  test("and the author has it back, in a space of their own", async () => {
    // They owned no space, so one was made for them. Being sent home is only
    // meaningful if there is a home.
    await member.goto("/spaces");
    await expect(
      member.getByRole("link", { name: "Member Started This" }),
    ).toHaveCount(0);

    // Named rather than positional: the list is ordered by name, so "first"
    // was whichever space sorted earliest rather than the one made for them.
    const mine = member
      .locator(`.space-list a:not([href="/s/${SPACE}"])`)
      .first();
    await expect(mine).toBeVisible();
    await mine.click();

    await expect(
      member.locator(".tree").getByRole("link", { name: "Member Started This" }),
    ).toBeVisible();
  });
});