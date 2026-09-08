import type { Page } from "@playwright/test";
import { waitForConfirmationLink } from "./mail";

/**
 * Registers and confirms a user, leaving the page signed in.
 *
 * The confirmation goes through the real emailed link rather than the admin
 * API, so every spec that needs a signed-in user also exercises the flow a
 * real person takes. The whole journey must share one browser context: PKCE
 * stores a code verifier cookie at signup that the confirmation needs.
 */
export async function registerAndConfirm(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await page
    .locator("form.auth-form")
    .getByRole("status")
    .waitFor({ state: "visible" });

  const link = await waitForConfirmationLink(email);
  await page.goto(link);
  await page.waitForURL(/\/spaces/);
}

/** Creates a space and lands on its index page. */
export async function createSpace(
  page: Page,
  name: string,
  slug: string,
): Promise<void> {
  await page.goto("/spaces");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Address").fill(slug);
  await page.getByRole("button", { name: "Create space" }).click();
  await page.waitForURL(new RegExp(`/s/${slug}`));
}
