import {
  test,
  expect,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

const RUN = Date.now().toString(36);
const EMAIL = `editor-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE_SLUG = `notes-${RUN}`;
const SPACE_NAME = "Editing Space";
const INDEX = `/s/${SPACE_SLUG}/index`;

test.describe.configure({ mode: "serial" });

test.describe("Slice 3: editing with optimistic locking", () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await registerAndConfirm(page, EMAIL, PASSWORD);
    await createSpace(page, SPACE_NAME, SPACE_SLUG);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("edits a page and sees the rendered result", async () => {
    await page.goto(INDEX);
    await page.getByRole("link", { name: "Edit", exact: true }).click();

    await expect(page).toHaveURL(/\?edit=1/);

    const area = page.getByRole("textbox");
    await area.fill(
      "A ==fresh== body.\n\n> [!warning] Careful\n> Mind the step.\n",
    );
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL(INDEX);
    // The title is the page's name and stays put: rewriting the body is not a
    // rename, and a document does not get to disagree with what it is called.
    await expect(
      page.getByRole("heading", { level: 1, name: SPACE_NAME }),
    ).toBeVisible();
    await expect(page.locator("mark")).toContainText("fresh");
    await expect(page.locator(".callout-warning")).toBeVisible();
  });

  test("surfaces a conflict without losing the author's text", async () => {
    await page.goto(`${INDEX}?edit=1`);

    // Find the node so the out-of-band write can target it.
    const listed = await page.request.get(
      `/api/v1/nodes?space_id=${await spaceId(page)}`,
    );
    const { nodes } = await listed.json();
    const index = nodes.find((n: { path: string }) => n.path === "index");

    // Somebody else saves while this editor sits open. Same session for
    // convenience; what matters is that the stored version moves on.
    const theirSave = await page.request.patch(`/api/v1/nodes/${index.id}`, {
      data: {
        content: "# Their version\n",
        content_version: index.content_version,
      },
    });
    expect(theirSave.ok()).toBe(true);

    const mine = "# My version, which must survive\n";
    await page.getByRole("textbox").fill(mine);
    await page.getByRole("button", { name: "Save" }).click();

    // The conflict is surfaced rather than silently resolved.
    await expect(
      page.locator(".editor").getByRole("alert"),
    ).toContainText(/someone else saved/i);

    // The author's text is still in the box, unmodified.
    await expect(page.getByRole("textbox")).toHaveValue(mine);

    // And the stored version is shown so nothing has to be guessed at.
    await expect(page.locator(".editor-theirs pre")).toContainText(
      "Their version",
    );

    // Still on the editor, not navigated away.
    await expect(page).toHaveURL(/\?edit=1/);
  });

  test("hides the editor from a viewer without edit rights", async ({
    browser,
  }) => {
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();

    // Anonymous cannot even see the space yet, so the 404 stands in for the
    // absent Edit affordance until sharing exists.
    const response = await anonPage.goto(INDEX);
    expect(response?.status()).toBe(404);

    await anon.close();
  });
});

/** The space id, published on the shell so it never has to be guessed at. */
async function spaceId(page: Page): Promise<string> {
  const id = await page.locator(".space-shell").getAttribute("data-space-id");
  if (!id) throw new Error("space shell did not carry a space id");
  return id;
}
