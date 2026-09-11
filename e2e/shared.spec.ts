import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

/**
 * Telling somebody something has been shared with them.
 *
 * Sharing with an address that has no account has always sent an email, since
 * that is how they get in at all. Sharing with somebody who already has one
 * did nothing they could see: the grant landed, the page became theirs to
 * read, and nothing anywhere told them. So the question here is whether the
 * person on the receiving end ever finds out.
 */
const RUN = Date.now().toString(36);
const OWNER = `shared-owner-${RUN}@maqsoodlabs.com`;
const COLLEAGUE = `shared-colleague-${RUN}@maqsoodlabs.com`;
const STRANGER = `shared-stranger-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `handover-${RUN}`;

test.describe.configure({ mode: "serial" });

test.describe("Shared with you", () => {
  let ownerCtx: BrowserContext;
  let colleagueCtx: BrowserContext;
  let strangerCtx: BrowserContext;
  let owner: Page;
  let colleague: Page;
  let stranger: Page;
  let spaceId: string;
  let nodeId: string;

  test.beforeAll(async ({ browser }) => {
    colleagueCtx = await browser.newContext();
    colleague = await colleagueCtx.newPage();
    await registerAndConfirm(colleague, COLLEAGUE, PASSWORD);

    strangerCtx = await browser.newContext();
    stranger = await strangerCtx.newPage();
    await registerAndConfirm(stranger, STRANGER, PASSWORD);

    ownerCtx = await browser.newContext();
    owner = await ownerCtx.newPage();
    await registerAndConfirm(owner, OWNER, PASSWORD);
    await createSpace(owner, "Handover Space", SPACE);

    spaceId = (await owner
      .locator(".space-shell")
      .getAttribute("data-space-id")) as string;

    const created = await owner.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "file", name: "Runbook" },
    });
    expect(created.status(), await created.text()).toBe(201);
    nodeId = (await created.json()).node.id;
  });

  test.afterAll(async () => {
    await ownerCtx.close();
    await colleagueCtx.close();
    await strangerCtx.close();
  });

  test("nothing is claimed before anything has been shared", async () => {
    await colleague.goto("/spaces");
    await expect(
      colleague.getByRole("heading", { name: "Shared with you" }),
    ).toHaveCount(0);
  });

  test("sharing a page tells the person it was shared with", async () => {
    const shared = await owner.request.post(`/api/v1/nodes/${nodeId}/grants`, {
      data: { email: COLLEAGUE, role: "viewer" },
    });
    expect(shared.status(), await shared.text()).toBe(201);

    // Armed before the page loads: seeing the list is what marks it seen, and
    // the next test asks whether that happened. Waiting for the request itself
    // is the difference between testing that and testing how fast CI is.
    const marked = colleague.waitForResponse(
      (r) => r.url().includes("/api/v1/shares/seen") && r.status() === 200,
    );

    await colleague.goto("/spaces");

    const row = colleague.locator(".shared-list li", { hasText: "Runbook" });
    await expect(row).toBeVisible();
    await expect(row.getByText("new")).toBeVisible();
    // Who did it, which is the part that makes it worth reading.
    await expect(row).toContainText(OWNER);

    await marked;

    // And it is a way in, not just an announcement.
    await row.getByRole("link", { name: "Runbook" }).click();
    await expect(colleague).toHaveURL(new RegExp(`/s/${SPACE}/runbook`));
  });

  test("and stops being new once they have seen it", async () => {
    await colleague.goto("/spaces");

    const row = colleague.locator(".shared-list li", { hasText: "Runbook" });
    await expect(row).toBeVisible();
    await expect(row.getByText("new")).toHaveCount(0);
  });

  test("being put on a team tells them too", async () => {
    const team = await owner.request.post(`/api/v1/spaces/${spaceId}/teams`, {
      data: { name: "On Call" },
    });
    expect(team.status(), await team.text()).toBe(201);
    const teamId = (await team.json()).team.id;

    const added = await owner.request.post(`/api/v1/teams/${teamId}/members`, {
      data: { email: COLLEAGUE },
    });
    expect(added.status(), await added.text()).toBe(201);

    await colleague.goto("/spaces");

    const row = colleague.locator(".shared-list li", { hasText: "On Call" });
    await expect(row).toBeVisible();
    await expect(row.getByText("new")).toBeVisible();
    await expect(row).toContainText("added to this team");
  });

  test("and none of it is anybody else's news", async () => {
    await stranger.goto("/spaces");
    await expect(
      stranger.getByRole("heading", { name: "Shared with you" }),
    ).toHaveCount(0);

    // Nor the sharer's: they already know, they did it.
    await owner.goto("/spaces");
    await expect(
      owner.locator(".shared-list li", { hasText: "Runbook" }),
    ).toHaveCount(0);
  });
});
