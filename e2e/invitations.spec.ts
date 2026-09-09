import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";
import { waitForConfirmationLink } from "./mail";

/**
 * Sharing with somebody who has no account.
 *
 * Sign-up here is invitation-only, so refusing to share with an unknown
 * address was a dead end with no door: the sharer was told the person had no
 * account, and the person had no way to make one. QA reported it as "the
 * invitation email is not sent", which is the same bug seen from the outside.
 */
const RUN = Date.now().toString(36);
const OWNER = `inviter-${RUN}@maqsoodlabs.com`;
const NEWCOMER = `newcomer-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `invited-${RUN}`;

const SHARED = `/s/${SPACE}/handbook`;
const PRIVATE = `/s/${SPACE}/salaries`;

test.describe.configure({ mode: "serial" });

test.describe("Inviting somebody who has no account", () => {
  let ownerCtx: BrowserContext;
  let newcomerCtx: BrowserContext;
  let owner: Page;
  let newcomer: Page;
  let folderId: string;

  test.beforeAll(async ({ browser }) => {
    ownerCtx = await browser.newContext();
    owner = await ownerCtx.newPage();
    await registerAndConfirm(owner, OWNER, PASSWORD);
    await createSpace(owner, "Invited Space", SPACE);

    const spaceId = await owner
      .locator(".space-shell")
      .getAttribute("data-space-id");

    const folder = await owner.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "folder", name: "Handbook" },
    });
    expect(folder.status(), await folder.text()).toBe(201);
    folderId = (await folder.json()).node.id;

    const secret = await owner.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "file", name: "Salaries" },
    });
    expect(secret.status(), await secret.text()).toBe(201);

    newcomerCtx = await browser.newContext();
    newcomer = await newcomerCtx.newPage();
  });

  test.afterAll(async () => {
    await ownerCtx.close();
    await newcomerCtx.close();
  });

  test("sharing with an unknown address invites them", async () => {
    const res = await owner.request.post(`/api/v1/nodes/${folderId}/grants`, {
      data: { email: NEWCOMER, role: "viewer" },
    });

    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();

    // The distinction the sharer needs: they are on the list, but they cannot
    // read anything until they accept.
    expect(body.invited, "the response should say an invitation went out").toBe(
      true,
    );
    expect(
      body.grants.some(
        (g: { grantee_email: string | null }) => g.grantee_email === NEWCOMER,
      ),
      "the invited person should appear in the sharing list",
    ).toBe(true);
  });

  test("and the invitation actually reaches them", async () => {
    const link = await waitForConfirmationLink(NEWCOMER);
    await newcomer.goto(link);

    // Set a password, which is the one thing an invited account is missing.
    await newcomer.waitForURL(/\/reset-password/);
    await newcomer.getByLabel("New password").fill(PASSWORD);
    await newcomer.getByLabel("Confirm password").fill(PASSWORD);
    await newcomer.getByRole("button", { name: "Save password" }).click();
    await newcomer.waitForURL(/\/spaces/);
  });

  test("they arrive at the thing they were invited to", async () => {
    // Not an empty list of spaces, which is what an invitation with no grant
    // behind it looks like, and is indistinguishable from being told no.
    await newcomer.goto("/spaces");
    await expect(newcomer.getByText("Invited Space")).toBeVisible();

    const page = await newcomer.goto(SHARED);
    expect(page?.status()).toBe(200);
    await expect(
      newcomer.getByRole("heading", { level: 1, name: "Handbook" }),
    ).toBeVisible();
  });

  test("and to nothing else", async () => {
    expect((await newcomer.goto(PRIVATE))?.status()).toBe(404);
  });

  test("inviting somebody who already has an account just shares", async () => {
    const res = await owner.request.post(`/api/v1/nodes/${folderId}/grants`, {
      data: { email: NEWCOMER, role: "editor" },
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    expect(body.invited, "nobody should be invited twice").toBe(false);
  });

  test("only an administrator can invite", async () => {
    const res = await newcomer.request.post(
      `/api/v1/nodes/${folderId}/grants`,
      { data: { email: `stranger-${RUN}@maqsoodlabs.com`, role: "viewer" } },
    );
    // Editor, not admin: the same 404 as a node that does not exist.
    expect(res.status()).toBe(404);
  });
});
