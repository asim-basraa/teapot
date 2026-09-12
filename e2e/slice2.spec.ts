import {
  test,
  expect,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

const RUN = Date.now().toString(36);
const EMAIL = `tree-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE_SLUG = `tree-${RUN}`;
const SPACE_NAME = "Tree Space";

test.describe.configure({ mode: "serial" });

test.describe("Slice 2: file tree and node CRUD", () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();

    // The tree's actions open the product's own dialogs now, not the browser's,
    // so these are ordinary elements to be filled in and submitted rather than
    // native dialogs needing a page-level handler.
    await registerAndConfirm(page, EMAIL, PASSWORD);
    await createSpace(page, SPACE_NAME, SPACE_SLUG);
  });

  test.afterAll(async () => {
    await context.close();
  });

  /**
   * Fills in whichever dialog the last click opened and submits it.
   *
   * A name means the asking dialog; no name means the confirming one, whose
   * only answer is the button.
   */
  async function answer(value?: string) {
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    if (value === undefined) {
      await dialog.getByRole("button", { name: /^(Delete|Confirm)/ }).click();
      return;
    }

    await dialog.getByRole("textbox").fill(value);
    await dialog.getByRole("button", { name: /^(Create|Save)$/ }).click();
  }

  /**
   * Clicks a tree action and returns the API response it triggered.
   *
   * Asserting on the response rather than only on the resulting DOM means a
   * server-side failure reports its own status and message, instead of the
   * test timing out on an element that was never going to appear.
   */
  async function actAndAwait(
    buttonName: string,
    method: "POST" | "PATCH" | "DELETE",
    promptValue?: string,
  ) {
    const waitForApi = page.waitForResponse(
      (r) =>
        r.url().includes("/api/v1/nodes") && r.request().method() === method,
    );
    // Exact, because the tree header offers "New page at the top level" and a
    // folder's own page offers "New page", and the two mean different places.
    await page
      .getByRole("button", { name: buttonName, exact: true })
      .click();
    await answer(promptValue);
    return waitForApi;
  }

  test("creates a top-level folder", async () => {
    await page.goto(`/s/${SPACE_SLUG}`);

    const response = await actAndAwait("New folder at the top level", "POST", "Projects");
    expect(
      response.status(),
      await response.text().catch(() => ""),
    ).toBe(201);

    await expect(page.locator(".tree-folder-name")).toContainText("Projects");
  });

  test("creates a page inside that folder, from the folder", async () => {
    // Not from the sidebar row. Creating things inside a folder lives on the
    // folder's own page, where there is room for it and where you can see
    // what is already there.
    await page.getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL(`/s/${SPACE_SLUG}/projects`);

    const response = await actAndAwait("New page", "POST", "Road Map");
    expect(
      response.status(),
      await response.text().catch(() => ""),
    ).toBe(201);

    // Making a page takes you into it, rather than leaving you on the folder
    // waiting for the sidebar to catch up.
    await expect(page).toHaveURL(`/s/${SPACE_SLUG}/projects/road-map`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Road Map" }),
    ).toBeVisible();

    const link = page.locator(".tree").getByRole("link", { name: "Road Map" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      "href",
      `/s/${SPACE_SLUG}/projects/road-map`,
    );
  });

  test("navigates to the page through the sidebar", async () => {
    await page.goto(`/s/${SPACE_SLUG}/projects`);
    await page.locator(".tree").getByRole("link", { name: "Road Map" }).click();

    await expect(page).toHaveURL(`/s/${SPACE_SLUG}/projects/road-map`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Road Map" }),
    ).toBeVisible();
  });

  test("renaming a folder moves its descendants and breaks the old URL", async () => {
    const response = await actAndAwait(
      "Rename Projects",
      "PATCH",
      "Active Projects",
    );
    expect(
      response.status(),
      await response.text().catch(() => ""),
    ).toBe(200);

    // This test renames the folder while reading a page inside it, which is
    // the case that strands the reader: the URL they are on ceases to exist.
    // The app must carry them to the node's new path.
    await expect(page).toHaveURL(
      `/s/${SPACE_SLUG}/active-projects/road-map`,
    );

    // The child's href must follow the parent's new path, which only holds if
    // the rename rewrote descendant paths rather than just the folder's own.
    await expect(page.getByRole("link", { name: "Road Map" })).toHaveAttribute(
      "href",
      `/s/${SPACE_SLUG}/active-projects/road-map`,
    );

    const stale = await page.goto(`/s/${SPACE_SLUG}/projects/road-map`);
    expect(stale?.status()).toBe(404);

    const moved = await page.goto(
      `/s/${SPACE_SLUG}/active-projects/road-map`,
    );
    expect(moved?.status()).toBe(200);
  });

  test("refuses a duplicate name in the same folder", async () => {
    await page.goto(`/s/${SPACE_SLUG}`);

    answer("Active Projects");
    await page.getByRole("button", { name: "New folder at the top level" }).click();

    await expect(page.locator(".tree-error")).toContainText(/already exists/i);
  });

  test("deleting a folder removes its subtree", async () => {
    await page.goto(`/s/${SPACE_SLUG}`);

    answer(); // accept the confirm
    await page
      .getByRole("button", { name: "Delete Active Projects" })
      .click();

    await expect(page.getByRole("link", { name: "Road Map" })).toHaveCount(0);
    await expect(page.locator(".tree-folder-name")).toHaveCount(0);

    const gone = await page.goto(
      `/s/${SPACE_SLUG}/active-projects/road-map`,
    );
    expect(gone?.status()).toBe(404);
  });
});

test.describe("Slice 2: node API", () => {
  test("rejects an unauthenticated write", async ({ request }) => {
    const response = await request.post("/api/v1/nodes", {
      data: {
        space_id: "00000000-0000-0000-0000-000000000000",
        kind: "file",
        name: "Sneaky",
      },
    });

    // 404 rather than 401, consistent with reads: the caller learns nothing
    // about whether the space exists.
    expect(response.status()).toBe(404);
  });
});
