import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { registerAndConfirm, createSpace, rowAction } from "./auth";

/**
 * Starting something at the top of a space you do not own.
 *
 * Inheritance runs downwards, so it had nothing to say about the top of a
 * space: a top-level item has no parent to inherit from, and the insert policy
 * fell back to ownership. Somebody with editor on half a space still had to ask
 * the owner to begin anything that was not already inside a folder they had
 * been given. The sidebar made it worse by deciding what to offer from one
 * question — do you own this space — so they saw no controls anywhere, not even
 * on the folder that was theirs to work in.
 *
 * What did not change is who may remove things. That got narrower rather than
 * wider: an editor used to be able to delete anything they could edit.
 */
const RUN = Date.now().toString(36);
const OWNER = `sm-owner-${RUN}@maqsoodlabs.com`;
const MEMBER = `sm-member-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `handbook-${RUN}`;

test.describe.configure({ mode: "serial" });

test.describe("Writing in a space you do not own", () => {
  let ownerCtx: BrowserContext;
  let memberCtx: BrowserContext;
  let owner: Page;
  let member: Page;
  let spaceId: string;
  let folderId: string;

  test.beforeAll(async ({ browser }) => {
    memberCtx = await browser.newContext();
    member = await memberCtx.newPage();
    await registerAndConfirm(member, MEMBER, PASSWORD);

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

    // The owner's own, at the top level, shared with nobody.
    const theirs = await owner.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "file", name: "Owner Only" },
    });
    expect(theirs.status(), await theirs.text()).toBe(201);

    const shared = await owner.request.post(
      `/api/v1/nodes/${folderId}/grants`,
      { data: { email: MEMBER, role: "editor" } },
    );
    expect(shared.status(), await shared.text()).toBe(201);
  });

  test.afterAll(async () => {
    await ownerCtx.close();
    await memberCtx.close();
  });

  test("an editor is offered the controls on the folder that is theirs to work in", async () => {
    await member.goto(`/s/${SPACE}/team-notes`);

    const row = member.locator(".tree-row", { hasText: "Team Notes" });
    await expect(
      row.getByRole("button", { name: "More for Team Notes" }),
    ).toBeVisible();

    // Sharing is the owner's: an editor writes, an administrator decides who
    // else may read.
    await expect(
      row.getByRole("button", { name: "Share Team Notes" }),
    ).toHaveCount(0);
  });

  test("and may start something at the top of the space", async () => {
    await member.goto(`/s/${SPACE}/team-notes`);

    await member
      .getByRole("button", { name: "New page at the top level" })
      .click();

    const asking = member.getByRole("dialog", { name: "New page" });
    await asking.getByRole("textbox").fill("Member Started This");
    await asking.getByRole("button", { name: "Create" }).click();

    await expect(member).toHaveURL(
      new RegExp(`/s/${SPACE}/member-started-this`),
    );
    await expect(
      member.getByRole("heading", { level: 1, name: "Member Started This" }),
    ).toBeVisible();
  });

  test("and it is theirs: they can share it and throw it away", async () => {
    // Without a grant of their own they would have made a page and been unable
    // to open it, since nothing above a top-level node carries one.
    const row = member.locator(".tree-row", { hasText: "Member Started This" });
    await expect(
      row.getByRole("button", { name: "Share Member Started This" }),
    ).toBeVisible();

    await row
      .getByRole("button", { name: "More for Member Started This" })
      .click();
    await expect(
      row.getByRole("menuitem", { name: "Delete Member Started This" }),
    ).toBeVisible();
    await member.keyboard.press("Escape");
  });

  test("but not the owner's work, even in a folder they may edit", async () => {
    const row = member.locator(".tree-row", { hasText: "Team Notes" });
    await row.getByRole("button", { name: "More for Team Notes" }).click();

    // Renaming and moving are writing, which they may do. Deleting is not
    // offered, because it is not theirs to delete.
    await expect(
      row.getByRole("menuitem", { name: "Rename Team Notes" }),
    ).toBeVisible();
    await expect(
      row.getByRole("menuitem", { name: "Delete Team Notes" }),
    ).toHaveCount(0);
    await member.keyboard.press("Escape");

    // And the refusal is the database's, not the screen's. This is the case
    // that used to report success for a delete that never happened.
    const refused = await member.request.delete(`/api/v1/nodes/${folderId}`);
    expect(refused.status()).toBe(404);

    await owner.goto(`/s/${SPACE}/team-notes`);
    await expect(
      owner.getByRole("heading", { level: 1, name: "Team Notes" }),
    ).toBeVisible();
  });

  test("and sharing is still the owner's alone", async () => {
    const refused = await member.request.post(
      `/api/v1/nodes/${folderId}/grants`,
      { data: { email: OWNER, role: "editor" } },
    );
    expect(refused.status()).toBe(404);
  });

  test("what is still per item is what they can see", async () => {
    // The honest limit of this. Writing in a space lets you start things in it;
    // it does not hand you what is already there. The owner's own top-level
    // page was shared with nobody and stays that way.
    await member.goto(`/s/${SPACE}`);
    await expect(
      member.locator(".tree").getByRole("link", { name: "Owner Only" }),
    ).toHaveCount(0);

    expect((await member.goto(`/s/${SPACE}/owner-only`))?.status()).toBe(404);
  });

  test("and somebody who only reads there cannot start anything", async ({
    browser,
  }) => {
    const readerCtx = await browser.newContext();
    const reader = await readerCtx.newPage();
    const READER = `sm-reader-${RUN}@maqsoodlabs.com`;
    await registerAndConfirm(reader, READER, PASSWORD);

    const shared = await owner.request.post(
      `/api/v1/nodes/${folderId}/grants`,
      { data: { email: READER, role: "viewer" } },
    );
    expect(shared.status(), await shared.text()).toBe(201);

    await reader.goto(`/s/${SPACE}/team-notes`);
    await expect(
      reader.getByRole("button", { name: "New page at the top level" }),
    ).toHaveCount(0);

    const refused = await reader.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "file", name: "Reader Should Not" },
    });
    expect(refused.status()).toBe(404);

    await readerCtx.close();
  });
});
