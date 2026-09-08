import { test, expect, type Page } from "@playwright/test";
import { waitForConfirmationLink, clearMail } from "./mail";

// Each run needs addresses and slugs nobody has used, since both are unique
// and the database persists across tests within a run.
const RUN = Date.now().toString(36);
const OWNER_EMAIL = `owner-${RUN}@maqsoodlabs.com`;
const OUTSIDER_EMAIL = `outsider-${RUN}@gmail.com`;
const PASSWORD = "correct-horse-battery";
const SPACE_SLUG = `garden-${RUN}`;
const SPACE_NAME = "Engineering Notes";

async function signUp(page: Page, email: string, password: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
}

test.describe.configure({ mode: "serial" });

test.describe("Slice 1: signup, confirmation and first rendered page", () => {
  test("rejects an address outside the allowed domain", async ({ page }) => {
    await signUp(page, OUTSIDER_EMAIL, PASSWORD);

    // The before-user-created hook's own message, surfaced to the reader.
    await expect(page.getByRole("alert")).toContainText(/invitation only/i);
    await expect(page).toHaveURL(/\/signup/);
  });

  test("accepts an allowed address and requires email confirmation", async ({
    page,
  }) => {
    await clearMail();
    await signUp(page, OWNER_EMAIL, PASSWORD);

    await expect(page.getByRole("status")).toContainText(OWNER_EMAIL);
    await expect(page.getByRole("status")).toContainText(/confirmation link/i);
  });

  test("refuses sign-in before the email is confirmed", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toContainText(/not valid/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test("confirming the emailed link signs the user in", async ({ page }) => {
    const link = await waitForConfirmationLink(OWNER_EMAIL);
    await page.goto(link);

    await expect(page).toHaveURL(/\/spaces/);
    await expect(
      page.getByRole("heading", { name: "Your spaces" }),
    ).toBeVisible();
  });

  test("a confirmed user can create a space and read its index page", async ({
    page,
  }) => {
    await page.goto("/spaces");
    await expect(page).toHaveURL(/\/spaces/);

    await page.getByLabel("Name").fill(SPACE_NAME);
    await page.getByLabel("Address").fill(SPACE_SLUG);
    await page.getByRole("button", { name: "Create space" }).click();

    await expect(page).toHaveURL(new RegExp(`/s/${SPACE_SLUG}`));
    await expect(
      page.getByRole("heading", { level: 1, name: SPACE_NAME }),
    ).toBeVisible();
  });

  test("the index page renders callouts, highlighting and LaTeX", async ({
    page,
  }) => {
    await page.goto(`/s/${SPACE_SLUG}`);

    await expect(page.locator(".callout.callout-tip")).toBeVisible();
    await expect(page.locator(".callout-title")).toContainText("Sharing");

    // Shiki colours each token inline, so a styled span proves it ran rather
    // than the block merely existing.
    await expect(page.locator("pre span[style*='color']").first()).toBeVisible();

    await expect(page.locator(".katex").first()).toBeVisible();
    await expect(page.locator("mark")).toContainText("highlight");
  });

  test("an unresolvable wikilink is inert, not a link", async ({ page }) => {
    await page.goto(`/s/${SPACE_SLUG}`);

    const unresolved = page.locator("span.wikilink-unresolved");
    await expect(unresolved).toContainText("another-page");
    // It must not be clickable: a working link would confirm the target exists.
    await expect(page.locator("a", { hasText: "another-page" })).toHaveCount(0);
  });

  test("signing out ends the session", async ({ page }) => {
    await page.goto("/spaces");
    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL(/\/login/);
  });

  test("an anonymous visitor gets a 404, never a 403", async ({ page }) => {
    const response = await page.goto(`/s/${SPACE_SLUG}`);
    expect(response?.status()).toBe(404);
  });

  test("a confirmed user can sign back in", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/spaces/);
    await expect(page.getByText(SPACE_NAME)).toBeVisible();
  });
});
