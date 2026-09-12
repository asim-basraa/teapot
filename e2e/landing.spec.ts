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
const SIGNED_JOKE = `A signed-in joke, ${RUN}. This one can be answered.`;
const REPLY = `That one I liked, ${RUN}.`;
const OUTSIDER = `inbox-outsider-${RUN}@maqsoodlabs.com`;

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

  test("and the footer is on every page, not only the front one", async () => {
    // It began on the front page alone, which meant anybody already signed in
    // and reading their own notes never saw the credit or the box. Checked on a
    // signed-in page and inside a space, because those are the two shells and
    // the footer lives outside both of them now.
    for (const url of ["/spaces", "/s/postit"]) {
      await owner.goto(url);
      const footer = owner.locator(".site-footer");
      await expect(footer).toContainText("by Awsim");
      await expect(
        footer.getByRole("button", { name: "Tell me a joke" }),
      ).toBeVisible();
    }
  });

  test("a stranger can send a note without an account", async () => {
    await visitor.getByRole("button", { name: "Tell me a joke" }).click();

    const dialog = visitor.getByRole("dialog", { name: "Tell me a joke" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("A joke, a thought, anything").fill(JOKE);
    await dialog.getByRole("button", { name: "Send" }).click();

    await expect(dialog.getByText("Got it. Thank you.")).toBeVisible();
  });

  test("and it lands where only the owner can read it", async () => {
    await owner.goto("/inbox");
    await expect(owner.locator(".threads")).toContainText(JOKE);
    // Sent signed out, so there is nobody attached to it.
    await expect(owner.locator(".threads")).toContainText("no account");
  });

  test("not even for somebody else with an account", async () => {
    // Not a question of the space being private: a conversation belongs to the
    // two people in it, and somebody who is in none sees none.
    await nosy.goto("/inbox");
    await expect(nosy.locator(".threads li")).toHaveCount(0);
    await expect(nosy.locator("main")).toContainText("Nothing here yet");
  });

  test("an anonymous note cannot be replied to, and says why", async () => {
    // The honest limit of a box that asks for nothing: with no account behind
    // it there is nobody to answer, and a reply box that quietly failed would
    // be worse than not offering one.
    await owner.goto("/inbox");
    await owner.locator(".threads a", { hasText: JOKE }).click();

    await expect(owner.locator(".conversation")).toContainText(JOKE);
    await expect(owner.locator(".conversation-closed")).toContainText(
      "there is nobody to reply to",
    );
    await expect(owner.getByRole("button", { name: "Send reply" })).toHaveCount(0);
  });

  test("and an empty note is refused", async () => {
    const res = await visitor.request.post("/api/v1/inbox", {
      data: { message: "   " },
    });
    expect(res.status()).toBe(400);
  });

  /**
   * The other half: a note sent while signed in belongs to somebody, so it can
   * be answered. These drive both sides of one conversation and then check that
   * a third person with a perfectly good account sees neither.
   */
  test("a signed-in note becomes a conversation the owner can answer", async () => {
    await nosy.goto("/spaces");
    await nosy.getByRole("button", { name: "Tell me a joke" }).click();

    const dialog = nosy.getByRole("dialog", { name: "Tell me a joke" });
    await dialog.getByLabel("A joke, a thought, anything").fill(SIGNED_JOKE);
    await dialog.getByRole("button", { name: "Send" }).click();

    // The confirmation tells them which of the two things they just did.
    await expect(dialog.getByText("Got it. Thank you.")).toBeVisible();
    await expect(dialog).toContainText("you will find it in your");
    await dialog.getByRole("button", { name: "Close" }).click();

    // The owner sees it, named rather than anonymous, and replies.
    await owner.goto("/inbox");
    const row = owner.locator(".threads a", { hasText: SIGNED_JOKE });
    await expect(row).toContainText(NOSY);
    await row.click();

    await owner.getByLabel("Reply").fill(REPLY);
    await owner.getByRole("button", { name: "Send reply" }).click();
    await expect(owner.locator(".messages")).toContainText(REPLY);
  });

  test("and the person who sent it reads the reply", async () => {
    await nosy.goto("/inbox");
    await nosy.locator(".threads a", { hasText: REPLY }).click();

    const messages = nosy.locator(".messages");
    await expect(messages).toContainText(SIGNED_JOKE);
    await expect(messages).toContainText(REPLY);

    // Their own words are theirs; the answer is not.
    await expect(messages.locator(".message.is-mine")).toContainText(SIGNED_JOKE);
    await expect(messages.locator(".message.is-mine")).not.toContainText(REPLY);
  });

  test("and a third person with an account sees none of it", async () => {
    const outsiderCtx = await visitor.context().browser()!.newContext();
    const outsider = await outsiderCtx.newPage();
    await registerAndConfirm(outsider, OUTSIDER, PASSWORD);

    await outsider.goto("/inbox");
    await expect(outsider.locator(".threads li")).toHaveCount(0);

    // The id of a real conversation, taken from the owner's own list, so this
    // is not a test that a made-up id fails.
    await owner.goto("/inbox");
    const href = await owner
      .locator(".threads a", { hasText: REPLY })
      .getAttribute("href");
    const noteId = new URL(href!, "http://localhost").searchParams.get("note");
    expect(noteId).toBeTruthy();

    // Not merely hidden from the list: asking for the conversation directly
    // returns nothing, which is what a conversation that does not exist returns.
    const read = await outsider.request.get(`/api/v1/notes/${noteId}`);
    expect(read.status()).toBe(200);
    expect((await read.json()).messages).toEqual([]);

    // And they cannot put words into somebody else's conversation.
    const butt = await outsider.request.post(`/api/v1/notes/${noteId}/replies`, {
      data: { message: "Butting in" },
    });
    expect(butt.status()).toBe(404);

    // Which the two people in it can confirm.
    await owner.goto(`/inbox?note=${noteId}`);
    await expect(owner.locator(".messages")).not.toContainText("Butting in");

    await outsiderCtx.close();
  });
});
