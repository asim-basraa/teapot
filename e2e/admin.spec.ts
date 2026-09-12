import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";
import { makeAdmin } from "./admin";

/**
 * The people screen.
 *
 * Two properties matter more than the rest of it. An administrator can see how
 * much somebody holds and never what it says, which is the one exception this
 * product does not make. And an account that still owns spaces cannot be
 * deleted, because deleting it would take a team's writing with it.
 */
const RUN = Date.now().toString(36);
const BOSS = `admin-boss-${RUN}@maqsoodlabs.com`;
const STAFF = `admin-staff-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `staffed-${RUN}`;

test.describe.configure({ mode: "serial" });

test.describe("People", () => {
  let bossCtx: BrowserContext;
  let staffCtx: BrowserContext;
  let boss: Page;
  let staff: Page;

  test.beforeAll(async ({ browser }) => {
    staffCtx = await browser.newContext();
    staff = await staffCtx.newPage();
    await registerAndConfirm(staff, STAFF, PASSWORD);
    await createSpace(staff, "Staff Space", SPACE);

    const spaceId = await staff
      .locator(".space-shell")
      .getAttribute("data-space-id");

    const created = await staff.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "file", name: "Salaries" },
    });
    expect(created.status(), await created.text()).toBe(201);
    const node = (await created.json()).node;

    const saved = await staff.request.patch(`/api/v1/nodes/${node.id}`, {
      data: {
        content: "# Salaries\n\nNobody else should ever read this.\n",
        content_version: node.content_version,
      },
    });
    expect(saved.status(), await saved.text()).toBe(200);

    bossCtx = await browser.newContext();
    boss = await bossCtx.newPage();
    await registerAndConfirm(boss, BOSS, PASSWORD);
    await makeAdmin(BOSS);
  });

  test.afterAll(async () => {
    await bossCtx.close();
    await staffCtx.close();
  });

  test("is not there at all for somebody who does not administer it", async () => {
    expect((await staff.goto("/admin"))?.status()).toBe(404);

    // And nothing anywhere says it is there to be refused from.
    await staff.goto("/spaces");
    await expect(staff.getByRole("link", { name: "People" })).toHaveCount(0);
  });

  test("lists everybody with what they hold", async () => {
    await boss.goto("/admin");
    await expect(
      boss.getByRole("heading", { level: 1, name: "People" }),
    ).toBeVisible();

    const row = boss.locator("tr", { hasText: STAFF });
    await expect(row).toBeVisible();
    // One space, and a size. Two articles rather than one: a space comes with
    // its own front page, which is a page like any other and counts like one.
    await expect(row.locator("td").nth(1), "spaces").toHaveText("1");
    await expect(row.locator("td").nth(2), "articles").toHaveText("2");
    await expect(row.locator("td").nth(3), "skills").toHaveText("0");
    await expect(row.locator("td").nth(4), "storage").not.toHaveText("0 B");
  });

  test("an administrator can appoint another, and stand them down", async () => {
    const row = boss.locator("tr", { hasText: STAFF });

    await row.getByRole("button", { name: "Make admin" }).click();
    await expect(row.getByText("admin", { exact: true })).toBeVisible();

    await row.getByRole("button", { name: "Stand down" }).click();
    await expect(row.getByText("admin", { exact: true })).toHaveCount(0);

    // That the last one cannot stand themselves down is asserted in the
    // database suite instead. This database is shared by every spec in the
    // suite and a retry stands up an administrator of its own, so "the last
    // one" is not something a browser test can establish here, and a test that
    // asserts it anyway is asserting whatever else happened to be running.
  });

  test("and not one word of what any of it says", async () => {
    // The whole justification for the screen's shape. Counting somebody's
    // pages is not reading them, and the page itself must be exactly as absent
    // as it was before anybody was made an administrator.
    await expect(boss.getByText("Nobody else should ever read this")).toHaveCount(0);

    expect((await boss.goto(`/s/${SPACE}/salaries`))?.status()).toBe(404);
    expect((await boss.goto(`/s/${SPACE}`))?.status()).toBe(404);
  });

  test("an account that still owns spaces cannot be deleted", async () => {
    await boss.goto("/admin");
    await boss
      .locator("tr", { hasText: STAFF })
      .getByRole("button", { name: "Delete" })
      .click();
    await boss
      .getByRole("dialog", { name: `Delete ${STAFF}?` })
      .getByRole("button", { name: "Delete account" })
      .click();

    await expect(boss.locator(".msg-error")).toContainText("still owns");
    await expect(boss.locator("tr", { hasText: STAFF })).toBeVisible();
  });

  test("so the spaces are handed over first", async () => {
    await boss.locator("tr", { hasText: STAFF })
      .getByRole("button", { name: "Hand over" })
      .click();

    const dialog = boss.getByRole("dialog", { name: `Spaces owned by ${STAFF}` });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Hand to").selectOption({ label: BOSS });
    await dialog.getByRole("button", { name: "Hand over" }).click();

    await expect(dialog.getByText("Nothing left to hand over")).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();

    // Ownership is where a space's administration comes from, so the page that
    // was a 404 a moment ago is now theirs to read.
    expect((await boss.goto(`/s/${SPACE}/salaries`))?.status()).toBe(200);
    await expect(boss.locator("article.prose")).toContainText(
      "Nobody else should ever read this",
    );
  });

  test("disabling somebody stops them signing in", async () => {
    await boss.goto("/admin");
    await boss
      .locator("tr", { hasText: STAFF })
      .getByRole("button", { name: "Disable" })
      .click();

    await expect(
      boss.locator("tr", { hasText: STAFF }).getByText("disabled"),
    ).toBeVisible();

    const shut = await staffCtx.browser()?.newContext();
    const locked = await shut!.newPage();
    await locked.goto("/login");
    await locked.getByLabel("Email").fill(STAFF);
    await locked.getByLabel("Password").fill(PASSWORD);
    await locked.getByRole("button", { name: "Sign in" }).click();

    await expect(
      locked.locator("form.auth-form").getByRole("alert"),
    ).toBeVisible();
    await expect(locked).toHaveURL(/\/login/);
    await shut!.close();
  });

  test("and then the account can go", async () => {
    await boss
      .locator("tr", { hasText: STAFF })
      .getByRole("button", { name: "Delete" })
      .click();
    await boss
      .getByRole("dialog", { name: `Delete ${STAFF}?` })
      .getByRole("button", { name: "Delete account" })
      .click();

    await expect(boss.locator("tr", { hasText: STAFF })).toHaveCount(0);
  });
});
