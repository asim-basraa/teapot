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

    // window.prompt and window.confirm drive the tree's actions. Playwright
    // dismisses dialogs by default, so every action would silently no-op
    // without a handler. Each test sets the answer it needs.
    await registerAndConfirm(page, EMAIL, PASSWORD);
    await createSpace(page, SPACE_NAME, SPACE_SLUG);
  });

  test.afterAll(async () => {
    await context.close();
  });

  /** Answers the next prompt with `value`, or accepts a confirm. */
  function answer(value?: string) {
    page.once("dialog", (dialog) => {
      void dialog.accept(value);
    });
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
    answer(promptValue);
    await page.getByRole("button", { name: buttonName }).click();
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

  test("creates a page inside that folder", async () => {
    const response = await actAndAwait(
      "New page in Projects",
      "POST",
      "Road Map",
    );
    expect(
      response.status(),
      await response.text().catch(() => ""),
    ).toBe(201);

    const link = page.getByRole("link", { name: "Road Map" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      "href",
      `/s/${SPACE_SLUG}/projects/road-map`,
    );
  });

  test("navigates to the page through the sidebar", async () => {
    await page.getByRole("link", { name: "Road Map" }).click();

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
