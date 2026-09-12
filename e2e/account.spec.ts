import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

/**
 * The account area.
 *
 * There was nowhere to stand and see your own account. Connection settings
 * were reachable from one link buried in the space list, and nothing anywhere
 * said which account you were signed in as, which is the question this product
 * invites most often.
 */
const RUN = Date.now().toString(36);
const OWNER = `account-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const NEW_PASSWORD = "staple-battery-horse";
const SPACE = `account-space-${RUN}`;

test.describe.configure({ mode: "serial" });

test.describe("Your account", () => {
  let ctx: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext();
    page = await ctx.newPage();
    await registerAndConfirm(page, OWNER, PASSWORD);
    await createSpace(page, "Account Space", SPACE);
  });

  test.afterAll(async () => {
    await ctx.close();
  });

  test("the header says who you are, everywhere", async () => {
    // Including inside a space, which is where somebody with two accounts is
    // most likely to be wondering.
    //
    // By the part before the @, since everybody here shares a domain and it was
    // taking the room the half that distinguishes you needs. The whole address
    // is still there, on the link, because the question this answers is which
    // account you are signed in as and half an answer is not one.
    const handle = OWNER.split("@")[0];

    for (const url of [`/s/${SPACE}`, "/spaces", "/settings/mcp"]) {
      await page.goto(url);

      const account = page.locator(".shell-account");
      await expect(account, `${url} should name the account`).toBeVisible();
      await expect(account, `${url} should name the account`).toContainText(
        handle,
      );
      await expect(account).not.toContainText("@");
      await expect(account).toHaveAttribute("title", new RegExp(OWNER));
    }
  });

  test("and it leads to the account page", async () => {
    await page.goto("/spaces");
    // By class rather than by name: the header shows the part before the @ now.
    await page.locator(".shell-account").click();

    await expect(page).toHaveURL(/\/account/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Your account" }),
    ).toBeVisible();
    await expect(page.locator(".account-identity")).toHaveText(OWNER);
  });

  test("the settings are gathered there", async () => {
    await page.goto("/account");

    await page.getByRole("link", { name: "Connect Post-it to Claude" }).click();
    await expect(page).toHaveURL(/\/settings\/mcp/);

    // And back, so it is a place rather than a one-way door.
    await page.getByRole("link", { name: "Your account" }).click();
    await expect(page).toHaveURL(/\/account/);
  });

  test("you can change your password from it", async () => {
    await page.goto("/account");

    await page.getByLabel("New password").fill(NEW_PASSWORD);
    await page.getByLabel("Confirm password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();

    // Told it worked, and left where you were rather than thrown elsewhere.
    await expect(page.getByText("Your password has been changed")).toBeVisible();
    await expect(page).toHaveURL(/\/account/);
  });

  test("and the new one is the one that works", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);

    await page.getByLabel("Email").fill(OWNER);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    // Scoped to the form, as slice1 already had to: Next's route announcer is
    // an alert too, and it carries the page title. And asked for its text
    // rather than merely that something went red, because a throttled sign-in
    // shows an alert as well, and a test that cannot tell those apart reports
    // the wrong thing when the next line fails.
    await expect(
      page.locator("form.auth-form").getByRole("alert"),
    ).toHaveText(/not valid/);

    // A refused sign-in keeps the address. Retyping it is the cost of a typo
    // in the other field, and nothing is given away by showing back what was
    // just typed in the clear.
    await expect(page.getByLabel("Email")).toHaveValue(OWNER);

    await page.getByLabel("Password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/spaces/);
  });

  test("a signed-out visitor is offered a way in, not an account", async () => {
    const visitor = await ctx.browser()?.newContext();
    const anon = await visitor!.newPage();

    await anon.goto("/docs");
    await expect(anon.getByRole("link", { name: OWNER })).toHaveCount(0);

    // And the account page is not somewhere you can wander into.
    await anon.goto("/account");
    await expect(anon).toHaveURL(/\/login/);

    await visitor!.close();
  });
});
