import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

/**
 * What a thing is called, and where it lives.
 *
 * Every test here came from a QA round. The complaints were: a rename shows in
 * the sidebar but the page still calls itself the old name; renaming a space
 * 404s it and leaves the list of spaces stale; the space appears inside the
 * file tree as though it were a file; and there is nowhere to share a folder.
 */
const RUN = Date.now().toString(36);
const OWNER = `naming-owner-${RUN}@maqsoodlabs.com`;
const GUEST = `naming-guest-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SLUG = `named-${RUN}`;

test.describe.configure({ mode: "serial" });

test.describe("Names, the space's own page, and sharing from the tree", () => {
  let ctx: BrowserContext;
  let guestCtx: BrowserContext;
  let owner: Page;
  let guest: Page;
  let spaceId: string;
  let pageId: string;
  let folderId: string;
  let homeId: string;

  test.beforeAll(async ({ browser }) => {
    guestCtx = await browser.newContext();
    guest = await guestCtx.newPage();
    await registerAndConfirm(guest, GUEST, PASSWORD);

    ctx = await browser.newContext();
    owner = await ctx.newPage();
    await registerAndConfirm(owner, OWNER, PASSWORD);
    await createSpace(owner, "First Name", SLUG);

    spaceId = (await owner
      .locator(".space-shell")
      .getAttribute("data-space-id")) as string;

    const folder = await owner.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "folder", name: "Reference" },
    });
    expect(folder.status(), await folder.text()).toBe(201);
    folderId = (await folder.json()).node.id;

    const created = await owner.request.post("/api/v1/nodes", {
      data: {
        space_id: spaceId,
        parent_id: folderId,
        kind: "file",
        name: "Old Title",
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    pageId = (await created.json()).node.id;

    const listed = await owner.request.get(`/api/v1/nodes?space_id=${spaceId}`);
    const { nodes } = await listed.json();
    homeId = nodes.find(
      (n: { path: string }) => n.path === "index",
    ).id;
  });

  test.afterAll(async () => {
    await ctx.close();
    await guestCtx.close();
  });

  test("a page is titled by its name, not by whatever its body says", async () => {
    await owner.goto(`/s/${SLUG}/reference/old-title`);
    await expect(
      owner.getByRole("heading", { level: 1, name: "Old Title" }),
    ).toBeVisible();
  });

  test("renaming it renames what the page calls itself", async () => {
    const renamed = await owner.request.patch(`/api/v1/nodes/${pageId}`, {
      data: { name: "New Title" },
    });
    expect(renamed.status(), await renamed.text()).toBe(200);

    await owner.goto(`/s/${SLUG}/reference/new-title`);
    await expect(
      owner.getByRole("heading", { level: 1, name: "New Title" }),
    ).toBeVisible();
    // The bug this came from: the sidebar moved on and the page did not.
    await expect(owner.getByText("Old Title")).toHaveCount(0);
  });

  test("a heading written into the body is not a second title", async () => {
    const before = await owner.request.get(`/api/v1/nodes?space_id=${spaceId}`);
    const version = (await before.json()).nodes.find(
      (n: { id: string }) => n.id === pageId,
    ).content_version as number;

    const saved = await owner.request.patch(`/api/v1/nodes/${pageId}`, {
      data: {
        content: "# New Title\n\nThe body proper.\n",
        content_version: version,
      },
    });
    expect(saved.status(), await saved.text()).toBe(200);

    await owner.goto(`/s/${SLUG}/reference/new-title`);
    await expect(
      owner.getByRole("heading", { level: 1, name: "New Title" }),
    ).toHaveCount(1);
    await expect(owner.locator("article.prose")).toContainText(
      "The body proper.",
    );
  });

  test("the space's own page is not one of the files", async () => {
    await owner.goto(`/s/${SLUG}`);

    // It has its own place above the tree, because it is the space rather
    // than something in it.
    await expect(owner.locator(".space-home")).toHaveText("First Name");
    await expect(
      owner.locator(".tree").getByText("First Name"),
    ).toHaveCount(0);
  });

  test("and cannot be renamed out from under its own address", async () => {
    const refused = await owner.request.patch(`/api/v1/nodes/${homeId}`, {
      data: { name: "Somewhere Else" },
    });
    expect(refused.status()).toBe(400);

    // The space still resolves, which is the whole point of refusing.
    expect((await owner.goto(`/s/${SLUG}`))?.status()).toBe(200);
  });

  test("nor deleted", async () => {
    const refused = await owner.request.delete(`/api/v1/nodes/${homeId}`);
    expect(refused.status()).toBe(400);
    expect((await owner.goto(`/s/${SLUG}`))?.status()).toBe(200);
  });

  test("renaming the space renames it everywhere it is named", async () => {
    await owner.goto(`/s/${SLUG}`);

    owner.once("dialog", (dialog) => void dialog.accept("Second Name"));
    await owner.getByRole("button", { name: "Rename First Name" }).click();

    await expect(owner.locator(".space-title")).toContainText("Second Name");
    // Its front page carries the space's name, so that moves too.
    await expect(
      owner.getByRole("heading", { level: 1, name: "Second Name" }),
    ).toBeVisible();
    // And the address does not move, so nothing anybody has linked breaks.
    expect(owner.url()).toContain(`/s/${SLUG}`);

    await owner.goto("/spaces");
    // Scoped to the list, for the same reason invitations.spec is: the page
    // now opens with what has been shared with you, and a space you own is
    // not that, but a name matched anywhere on the page is not evidence of
    // which of the two it came from.
    await expect(
      owner.locator(".space-list").getByText("Second Name"),
    ).toBeVisible();
    await expect(
      owner.locator(".space-list").getByText("First Name"),
    ).toHaveCount(0);
  });

  test("a folder is somewhere you can go, and it lists what is in it", async () => {
    await owner.goto(`/s/${SLUG}`);
    await owner.locator(".tree").getByRole("link", { name: "Reference" }).click();

    await owner.waitForURL(`**/s/${SLUG}/reference`);
    await expect(
      owner.getByRole("heading", { level: 1, name: "Reference" }),
    ).toBeVisible();
    await expect(
      owner.locator(".folder-contents").getByRole("link", { name: "New Title" }),
    ).toBeVisible();
  });

  test("a folder can be shared from the sidebar", async () => {
    await owner.goto(`/s/${SLUG}`);
    await owner.getByRole("button", { name: "Share Reference" }).click();

    const dialog = owner.getByRole("dialog", { name: "Sharing for Reference" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Email").fill(GUEST);
    await dialog.getByRole("button", { name: "Share", exact: true }).click();
    await expect(dialog.getByText(GUEST)).toBeVisible();
  });

  test("and the person it was shared with can read the folder and its page", async () => {
    expect((await guest.goto(`/s/${SLUG}/reference`))?.status()).toBe(200);

    const page = await guest.goto(`/s/${SLUG}/reference/new-title`);
    expect(page?.status()).toBe(200);
    await expect(
      guest.getByRole("heading", { level: 1, name: "New Title" }),
    ).toBeVisible();
  });

  test("a page and a skill can be shared from the sidebar too", async () => {
    const skill = await owner.request.post("/api/v1/nodes", {
      data: {
        space_id: spaceId,
        kind: "file",
        name: "House Style",
        content_type: "skill",
      },
    });
    expect(skill.status(), await skill.text()).toBe(201);

    await owner.goto(`/s/${SLUG}`);

    for (const name of ["House Style", "Reference"]) {
      await owner.getByRole("button", { name: `Share ${name}` }).click();
      const dialog = owner.getByRole("dialog", { name: `Sharing for ${name}` });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Close" }).click();
      await expect(dialog).toBeHidden();
    }
  });

  test("somebody who cannot administer a page is not offered sharing", async () => {
    await guest.goto(`/s/${SLUG}/reference`);
    await expect(
      guest.getByRole("button", { name: "Share Reference" }),
    ).toHaveCount(0);
    await expect(
      guest.getByRole("button", { name: "Rename First Name" }),
    ).toHaveCount(0);
  });
});
