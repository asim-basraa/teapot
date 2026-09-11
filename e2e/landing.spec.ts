import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

/**
 * The front page, and the note box on it.
 *
 * The box asks for nothing: no account, no address. So the property worth
 * testing is not that it works, which is easy, but where what it collects ends
 * up. A note from a stranger lands on a page with no grant of its own, which
 * means the person who owns the space and nobody else.
 */
const RUN = Date.now().toString(36);
const OWNER = `inbox-owner-${RUN}@maqsoodlabs.com`;
const NOSY = `inbox-nosy-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const JOKE = `Two antennas got married, ${RUN}. The reception was excellent.`;

test.describe.configure({ mode: "serial" });

test.describe("The front page", () => {
  let ownerCtx: BrowserContext;
  let nosyCtx: BrowserContext;
  let visitorCtx: BrowserContext;
  let owner: Page;
  let nosy: Page;
  let visitor: Page;

  test.beforeAll(async ({ browser }) => {
    nosyCtx = await browser.newContext();
    nosy = await nosyCtx.newPage();
    await registerAndConfirm(nosy, NOSY, PASSWORD);

    ownerCtx = await browser.newContext();
    owner = await ownerCtx.newPage();
    await registerAndConfirm(owner, OWNER, PASSWORD);

    // The inbox belongs to whoever owns this space, so there has to be one.
    await createSpace(owner, "Post-it", "postit");

    visitorCtx = await browser.newContext();
    visitor = await visitorCtx.newPage();
  });

  test.afterAll(async () => {
    await ownerCtx.close();
    await nosyCtx.close();
    await visitorCtx.close();
  });

  test("says what the product is rather than that it is coming", async () => {
    await visitor.goto("/");
    await expect(
      visitor.getByRole("heading", { level: 1, name: "Post-it" }),
    ).toBeVisible();
    await expect(visitor.getByText("Coming soon")).toHaveCount(0);
    await expect(visitor.getByText("Built with love")).toBeVisible();
    await expect(visitor.locator(".site-footer")).toContainText("by Awsim");
  });

  test("a stranger can send a note without an account", async () => {
    await visitor.getByRole("button", { name: "Tell me something" }).click();

    const dialog = visitor.getByRole("dialog", { name: "Tell me something" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("A joke, a thought, anything").fill(JOKE);
    await dialog.getByRole("button", { name: "Send" }).click();

    await expect(dialog.getByText("Got it. Thank you.")).toBeVisible();
  });

  test("and it lands where only the owner can read it", async () => {
    await owner.goto("/s/postit/inbox");
    await expect(owner.locator("article.prose")).toContainText(JOKE);
  });

  test("not even for somebody else with an account", async () => {
    // The page carries no grant of its own, so it is not a question of the
    // space being private: it is the same 404 a page that does not exist gives.
    expect((await nosy.goto("/s/postit/inbox"))?.status()).toBe(404);
  });

  test("and an empty note is refused", async () => {
    const res = await visitor.request.post("/api/v1/inbox", {
      data: { message: "   " },
    });
    expect(res.status()).toBe(400);
  });
});
