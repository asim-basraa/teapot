import {
  test,
  expect,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { waitForConfirmationLink, clearMail } from "./mail";

// Each run needs addresses and slugs nobody has used, since both are unique
// and the database persists across tests within a run.
const RUN = Date.now().toString(36);
const OWNER_EMAIL = `owner-${RUN}@maqsoodlabs.com`;
const OUTSIDER_EMAIL = `outsider-${RUN}@gmail.com`;
const PASSWORD = "correct-horse-battery";
const SPACE_SLUG = `garden-${RUN}`;
const SPACE_NAME = "Engineering Notes";

// Next.js renders its own <div role="alert"> route announcer on every page, so
// an unscoped getByRole("alert") is ambiguous. Scope to the form, which is
// where our own messages live.
const formAlert = (p: Page) => p.locator("form.auth-form").getByRole("alert");
const formStatus = (p: Page) => p.locator("form.auth-form").getByRole("status");

test.describe.configure({ mode: "serial" });

test.describe("Slice 1: signup, confirmation and first rendered page", () => {
  // One context for the whole flow, deliberately.
  //
  // Playwright isolates every test in a fresh context, which would throw away
  // cookies between steps. That breaks PKCE: signup stores a code verifier in
  // the browser, and the confirmation link cannot be exchanged without it.
  // These steps are one user's journey, so they share one browser.
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
  });

  async function signUp(email: string, password: string) {
    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
  }

  async function signIn(email: string, password: string) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }

  test("rejects an address outside the allowed domain", async () => {
    await signUp(OUTSIDER_EMAIL, PASSWORD);

    // The before-user-created hook's own message, surfaced to the reader.
    await expect(formAlert(page)).toContainText(/invitation only/i);
    await expect(page).toHaveURL(/\/signup/);
  });

  test("accepts an allowed address and requires email confirmation", async () => {
    await clearMail();
    await signUp(OWNER_EMAIL, PASSWORD);

    await expect(formStatus(page)).toContainText(OWNER_EMAIL);
    await expect(formStatus(page)).toContainText(/confirmation link/i);
  });

  test("refuses sign-in before the email is confirmed", async () => {
    await signIn(OWNER_EMAIL, PASSWORD);

    await expect(formAlert(page)).toContainText(/not valid/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test("confirming the emailed link signs the user in", async () => {
    const link = await waitForConfirmationLink(OWNER_EMAIL);
    await page.goto(link);

    await expect(page).toHaveURL(/\/spaces/);
    await expect(
      page.getByRole("heading", { name: "Your spaces" }),
    ).toBeVisible();
  });

  test("a confirmed user can create a space and read its index page", async () => {
    await page.goto("/spaces");

    await page.getByLabel("Name").fill(SPACE_NAME);
    await page.getByLabel("Address").fill(SPACE_SLUG);
    await page.getByRole("button", { name: "Create space" }).click();

    await expect(page).toHaveURL(new RegExp(`/s/${SPACE_SLUG}`));
    await expect(
      page.getByRole("heading", { level: 1, name: SPACE_NAME }),
    ).toBeVisible();
  });

  test("the index page renders callouts, highlighting and LaTeX", async () => {
    await page.goto(`/s/${SPACE_SLUG}`);

    await expect(page.locator(".callout.callout-tip")).toBeVisible();
    await expect(page.locator(".callout-title")).toContainText("Sharing");

    // Shiki colours each token inline, so a styled span proves it ran rather
    // than the block merely existing.
    await expect(page.locator("pre span[style*='color']").first()).toBeVisible();

    await expect(page.locator(".katex").first()).toBeVisible();
    await expect(page.locator("mark")).toContainText("highlight");
  });

  test("an unresolvable wikilink is inert, not a link", async () => {
    await page.goto(`/s/${SPACE_SLUG}`);

    await expect(page.locator("span.wikilink-unresolved")).toContainText(
      "another-page",
    );
    // It must not be clickable: a working link would confirm the target exists.
    await expect(page.locator("a", { hasText: "another-page" })).toHaveCount(0);
  });

  test("an anonymous visitor gets a 404, never a 403", async ({ browser }) => {
    // A genuinely separate context: this assertion is meaningless if it
    // inherits the signed-in session.
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();

    const response = await anonPage.goto(`/s/${SPACE_SLUG}`);
    expect(response?.status()).toBe(404);

    await anon.close();
  });

  test("signing out ends the session", async () => {
    await page.goto("/spaces");
    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL(/\/login/);
  });

  test("a confirmed user can sign back in", async () => {
    await signIn(OWNER_EMAIL, PASSWORD);

    await expect(page).toHaveURL(/\/spaces/);
    await expect(page.getByText(SPACE_NAME)).toBeVisible();
  });
});
