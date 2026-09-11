import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

/**
 * Moving a page or folder somewhere else.
 *
 * QA found this missing, and they were right: the endpoint, the database
 * function that rewrites every descendant's path, and the refusal to make a
 * folder its own ancestor were all already built and tested through the API.
 * What was never built was any way to ask for it. The tree offered Rename and
 * Delete, the handover document claimed you could "drag them about", and nobody
 * could.
 *
 * So these tests drive the two ways a person actually has: the drag, and the
 * Move button that exists because a drag cannot be done from a keyboard.
 */
const RUN = Date.now().toString(36);
const EMAIL = `moving-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `moving-${RUN}`;

test.describe.configure({ mode: "serial" });

test.describe("Moving things about", () => {
  let context: BrowserContext;
  let page: Page;
  let spaceId: string;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await registerAndConfirm(page, EMAIL, PASSWORD);
    await createSpace(page, "Moving Space", SPACE);

    spaceId = (await page
      .locator(".space-shell")
      .getAttribute("data-space-id")) as string;

    // Two top-level folders and a page, built through the API: what is being
    // tested is the moving, not the making.
    for (const [kind, name] of [
      ["folder", "Archive"],
      ["folder", "Drafts"],
      ["file", "Stray Note"],
    ] as const) {
      const res = await page.request.post("/api/v1/nodes", {
        data: { space_id: spaceId, kind, name },
      });
      expect(res.status(), await res.text()).toBe(201);
    }
    await page.goto(`/s/${SPACE}`);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("a page can be dragged into a folder", async () => {
    const tree = page.locator(".tree");
    const note = tree.locator(".tree-row", { hasText: "Stray Note" });
    const archive = tree.locator(".tree-row", { hasText: "Archive" });

    await expect(note).toHaveClass(/is-draggable/);

    const moved = page.waitForResponse(
      (r) => r.request().method() === "PATCH" && r.url().includes("/api/v1/nodes/"),
    );
    await note.dragTo(archive);
    expect((await moved).status()).toBe(200);

    // The address is what actually changed, so that is what to check.
    await tree.getByRole("link", { name: "Stray Note" }).click();
    await expect(page).toHaveURL(`/s/${SPACE}/archive/stray-note`);
  });

  test("and dragged back out to the top level", async () => {
    const tree = page.locator(".tree");

    const moved = page.waitForResponse(
      (r) => r.request().method() === "PATCH" && r.url().includes("/api/v1/nodes/"),
    );
    await tree
      .locator(".tree-row", { hasText: "Stray Note" })
      .dragTo(tree.locator(".tree-header"));
    expect((await moved).status()).toBe(200);

    await tree.getByRole("link", { name: "Stray Note" }).click();
    await expect(page).toHaveURL(`/s/${SPACE}/stray-note`);
  });

  test("the Move button does the same thing without a mouse", async () => {
    await page.goto(`/s/${SPACE}`);
    const tree = page.locator(".tree");

    await tree
      .locator(".tree-row", { hasText: "Stray Note" })
      .getByRole("button", { name: "Move Stray Note" })
      .click();

    const dialog = page.getByRole("dialog", { name: "Move Stray Note" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Everything inside it goes too");

    // Where it already is must be offered but refused, rather than being a
    // move that quietly does nothing.
    await expect(
      dialog.getByRole("button", { name: /The top level/ }),
    ).toBeDisabled();

    await dialog.getByRole("button", { name: "drafts", exact: true }).click();

    await tree.getByRole("link", { name: "Stray Note" }).click();
    await expect(page).toHaveURL(`/s/${SPACE}/drafts/stray-note`);
  });

  test("a folder cannot be moved inside itself", async () => {
    await page.goto(`/s/${SPACE}`);

    // Drafts now holds the note. Offering Drafts as a destination for Drafts, or
    // anything beneath it, would be offering a move the database refuses.
    await page
      .locator(".tree")
      .locator(".tree-row", { hasText: "Drafts" })
      .getByRole("button", { name: "Move Drafts" })
      .click();

    const dialog = page.getByRole("dialog", { name: "Move Drafts" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "drafts", exact: true }),
    ).toHaveCount(0);
    // Archive is a legal destination, so the list is not simply empty.
    await expect(
      dialog.getByRole("button", { name: "archive", exact: true }),
    ).toBeVisible();
  });

  test("somebody who cannot edit is offered no way to move anything", async ({
    browser,
  }) => {
    const viewerCtx = await browser.newContext();
    const viewer = await viewerCtx.newPage();
    await registerAndConfirm(viewer, `moving-viewer-${RUN}@maqsoodlabs.com`, PASSWORD);

    const shared = await page.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "file", name: "Read Only" },
    });
    const nodeId = (await shared.json()).node.id;
    await page.request.post(`/api/v1/nodes/${nodeId}/grants`, {
      data: { email: `moving-viewer-${RUN}@maqsoodlabs.com`, role: "viewer" },
    });

    await viewer.goto(`/s/${SPACE}/read-only`);
    await expect(
      viewer.getByRole("button", { name: /^Move / }),
    ).toHaveCount(0);
    await expect(viewer.locator(".tree-row.is-draggable")).toHaveCount(0);

    // And the refusal is the endpoint's, not the screen's.
    const refused = await viewer.request.patch(`/api/v1/nodes/${nodeId}`, {
      data: { parent_id: null },
    });
    expect(refused.status()).toBe(404);

    await viewerCtx.close();
  });
});
