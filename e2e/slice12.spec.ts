import {
  test,
  expect,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

const RUN = Date.now().toString(36);
const OWNER = `talk-owner-${RUN}@maqsoodlabs.com`;
const GUEST = `talk-guest-${RUN}@maqsoodlabs.com`;
const STRANGER = `talk-stranger-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `discussed-${RUN}`;

const PAGE = `/s/${SPACE}/roadmap`;

test.describe.configure({ mode: "serial" });

test.describe("Comments", () => {
  let ownerCtx: BrowserContext;
  let guestCtx: BrowserContext;
  let strangerCtx: BrowserContext;
  let visitorCtx: BrowserContext;
  let owner: Page;
  let guest: Page;
  let stranger: Page;
  let visitor: Page;
  let nodeId: string;

  test.beforeAll(async ({ browser }) => {
    guestCtx = await browser.newContext();
    guest = await guestCtx.newPage();
    await registerAndConfirm(guest, GUEST, PASSWORD);

    strangerCtx = await browser.newContext();
    stranger = await strangerCtx.newPage();
    await registerAndConfirm(stranger, STRANGER, PASSWORD);

    ownerCtx = await browser.newContext();
    owner = await ownerCtx.newPage();
    await registerAndConfirm(owner, OWNER, PASSWORD);
    await createSpace(owner, "Discussed Space", SPACE);

    const spaceId = await owner
      .locator(".space-shell")
      .getAttribute("data-space-id");

    const created = await owner.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "file", name: "Roadmap" },
    });
    expect(created.status(), await created.text()).toBe(201);
    nodeId = (await created.json()).node.id;

    // A viewer, not an editor: reading is enough to join the conversation.
    const shared = await owner.request.post(`/api/v1/nodes/${nodeId}/grants`, {
      data: { email: GUEST, role: "viewer" },
    });
    expect(shared.status(), await shared.text()).toBe(201);

    visitorCtx = await browser.newContext();
    visitor = await visitorCtx.newPage();
  });

  test.afterAll(async () => {
    await ownerCtx.close();
    await guestCtx.close();
    await strangerCtx.close();
    await visitorCtx.close();
  });

  test("the conversation sits under the article, not beside it", async () => {
    await owner.goto(PAGE);

    const comments = owner.getByRole("region", { name: "Comments" });
    await expect(comments).toBeVisible();
    await expect(comments.getByText("Nothing yet")).toBeVisible();

    // Below the document, so a comment cannot end up pointing at a paragraph
    // that has since been rewritten.
    const order = await owner.evaluate(() => {
      const article = document.querySelector("article.prose");
      const section = document.querySelector(".comments");
      if (!article || !section) return "missing";
      return article.compareDocumentPosition(section) &
        Node.DOCUMENT_POSITION_FOLLOWING
        ? "after"
        : "before";
    });
    expect(order).toBe("after");
  });

  test("a viewer can comment without being able to edit", async () => {
    await guest.goto(PAGE);
    await expect(
      guest.getByRole("link", { name: "Edit", exact: true }),
    ).toHaveCount(0);

    await guest.getByLabel("Add a comment").fill("The Q3 date looks wrong.");
    await guest.getByRole("button", { name: "Post" }).click();

    await expect(guest.getByText("The Q3 date looks wrong.")).toBeVisible();
  });

  test("the owner sees it and can reply", async () => {
    await owner.goto(PAGE);

    // Two things have to be true, and a bare assertion on the text cannot say
    // which failed: the panel renders at all, which needs the owner's session
    // to have survived the reload, and it carries what the guest wrote.
    const panel = owner.getByRole("region", { name: "Comments" });
    await expect(panel, "the owner must be signed in to see comments").toBeVisible();

    // Asked of the API as well as of the page, because the two failures look
    // identical and have nothing in common: if this passes and the page below
    // does not, the data reached the request and something between the request
    // and the markup lost it.
    const listed = await owner.request.get(`/api/v1/nodes/${nodeId}/comments`);
    const bodies = ((await listed.json()).comments as { body: string }[]).map(
      (c) => c.body,
    );
    expect(bodies, "the API must show the owner what the guest wrote").toContain(
      "The Q3 date looks wrong.",
    );

    await expect(panel.getByText("The Q3 date looks wrong.")).toBeVisible();
    await expect(owner.getByText(GUEST)).toBeVisible();

    await owner.getByRole("button", { name: `Reply to ${GUEST}` }).click();
    await owner.getByLabel(`Reply to ${GUEST}`).fill("Good catch, fixing it.");
    await owner.getByRole("button", { name: "Reply", exact: true }).click();

    await expect(owner.getByText("Good catch, fixing it.")).toBeVisible();
  });

  test("and the reply reaches the person who raised it", async () => {
    await guest.goto(PAGE);
    await expect(guest.getByText("Good catch, fixing it.")).toBeVisible();
  });

  test("a reply cannot itself be replied to", async () => {
    // One level, so a conversation stays followable. Enforced in the database,
    // which is why there is no affordance for it either.
    await owner.goto(PAGE);
    await expect(
      owner.getByRole("button", { name: `Reply to ${OWNER}` }),
    ).toHaveCount(0);

    const res = await owner.request.post(`/api/v1/nodes/${nodeId}/comments`, {
      data: { body: "Nested too far", parent_id: await replyId(owner, nodeId) },
    });
    expect(res.status()).toBe(400);
  });

  test("you can delete your own and not somebody else's", async () => {
    await guest.goto(PAGE);
    await expect(
      guest.getByRole("button", { name: `Delete the comment by ${GUEST}` }),
    ).toBeVisible();
    await expect(
      guest.getByRole("button", { name: `Delete the comment by ${OWNER}` }),
    ).toHaveCount(0);
  });

  test("withdrawing a comment leaves the answers underneath it standing", async () => {
    await guest.goto(PAGE);
    await guest
      .getByRole("button", { name: `Delete the comment by ${GUEST}` })
      .click();

    await expect(guest.getByText("This comment was withdrawn.")).toBeVisible();
    await expect(guest.getByText("The Q3 date looks wrong.")).toHaveCount(0);
    // The reply is somebody else's and must survive.
    await expect(guest.getByText("Good catch, fixing it.")).toBeVisible();
  });

  test("an administrator can moderate anybody's comment", async () => {
    await guest.goto(PAGE);
    await guest.getByLabel("Add a comment").fill("Something regrettable.");
    await guest.getByRole("button", { name: "Post" }).click();
    await expect(guest.getByText("Something regrettable.")).toBeVisible();

    await owner.goto(PAGE);

    // Three things have to be true before the moderator can act, and this test
    // is worth nothing unless it says which one failed: the panel is rendered
    // for them at all, they can see what the other person wrote, and they hold
    // admin on the page.
    const panel = owner.getByRole("region", { name: "Comments" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Something regrettable.")).toBeVisible();
    await expect(owner.getByRole("button", { name: "Share", exact: true })).toBeVisible();

    await owner
      .getByRole("button", { name: `Delete the comment by ${GUEST}` })
      .click();

    // Nothing hung off it, so it goes entirely rather than leaving a marker.
    await expect(owner.getByText("Something regrettable.")).toHaveCount(0);
  });

  test("somebody without access sees neither page nor conversation", async () => {
    expect((await stranger.goto(PAGE))?.status()).toBe(404);

    const res = await stranger.request.get(
      `/api/v1/nodes/${nodeId}/comments`,
    );
    expect((await res.json()).comments).toHaveLength(0);

    const posted = await stranger.request.post(
      `/api/v1/nodes/${nodeId}/comments`,
      { data: { body: "Intruding" } },
    );
    expect(posted.status()).toBe(404);
  });

  test("publishing the page does not publish the conversation", async () => {
    const published = await owner.request.put(
      `/api/v1/nodes/${nodeId}/public`,
      { data: { public: true } },
    );
    expect(published.status(), await published.text()).toBe(200);

    // The document is public now. The discussion about it is not: comments are
    // candid in a way the document is not, and one toggle should not put them
    // on the internet.
    const page = await visitor.goto(PAGE);
    expect(page?.status()).toBe(200);
    await expect(
      visitor.getByRole("heading", { level: 1, name: "Roadmap" }),
    ).toBeVisible();

    await expect(
      visitor.getByRole("region", { name: "Comments" }),
    ).toHaveCount(0);
    await expect(visitor.getByText("Good catch, fixing it.")).toHaveCount(0);

    const res = await visitor.request.get(`/api/v1/nodes/${nodeId}/comments`);
    expect(res.status()).toBe(404);
  });
});

/** The id of the one reply in the conversation, read back through the API. */
async function replyId(page: Page, nodeId: string): Promise<string> {
  const listed = await page.request.get(`/api/v1/nodes/${nodeId}/comments`);
  const { comments } = await listed.json();
  const reply = comments.find(
    (c: { parent_id: string | null }) => c.parent_id !== null,
  );
  expect(reply, "there should be a reply to nest under").toBeTruthy();
  return reply.id;
}
