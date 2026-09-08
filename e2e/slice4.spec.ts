import {
  test,
  expect,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

const RUN = Date.now().toString(36);
const OWNER = `share-owner-${RUN}@maqsoodlabs.com`;
const GUEST = `share-guest-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `shared-${RUN}`;

const SHARED = `/s/${SPACE}/shared-page`;
const SECRET = `/s/${SPACE}/secret-page`;

test.describe.configure({ mode: "serial" });

test.describe("Slice 4: sharing a node with another person", () => {
  // Two people, so two browsers. Sharing cannot be demonstrated in one
  // session: the entire question is what a *different* account can see.
  let ownerCtx: BrowserContext;
  let guestCtx: BrowserContext;
  let owner: Page;
  let guest: Page;
  let sharedNodeId: string;

  test.beforeAll(async ({ browser }) => {
    guestCtx = await browser.newContext();
    guest = await guestCtx.newPage();
    // The guest must exist before they can be granted anything: grant_to_email
    // resolves an address to an account, and refuses if there is none.
    await registerAndConfirm(guest, GUEST, PASSWORD);

    ownerCtx = await browser.newContext();
    owner = await ownerCtx.newPage();
    await registerAndConfirm(owner, OWNER, PASSWORD);
    await createSpace(owner, "Shared Space", SPACE);

    const spaceId = await owner
      .locator(".space-shell")
      .getAttribute("data-space-id");

    for (const name of ["Shared Page", "Secret Page"]) {
      const res = await owner.request.post("/api/v1/nodes", {
        data: { space_id: spaceId, kind: "file", name },
      });
      expect(res.status(), await res.text()).toBe(201);
    }

    const listed = await owner.request.get(
      `/api/v1/nodes?space_id=${spaceId}`,
    );
    const { nodes } = await listed.json();
    sharedNodeId = nodes.find(
      (n: { path: string }) => n.path === "shared-page",
    ).id;
  });

  test.afterAll(async () => {
    await ownerCtx.close();
    await guestCtx.close();
  });

  test("a stranger cannot see the space at all", async () => {
    const response = await guest.goto(SHARED);
    expect(response?.status()).toBe(404);
  });

  test("sharing with an address that has no account says so", async () => {
    const res = await owner.request.post(
      `/api/v1/nodes/${sharedNodeId}/grants`,
      { data: { email: `nobody-${RUN}@maqsoodlabs.com`, role: "viewer" } },
    );

    expect(res.status()).toBe(404);
    expect(await res.text()).toMatch(/no teapot account/i);
  });

  test("the owner shares one page as viewer", async () => {
    const res = await owner.request.post(
      `/api/v1/nodes/${sharedNodeId}/grants`,
      { data: { email: GUEST, role: "viewer" } },
    );
    expect(res.status(), await res.text()).toBe(201);
  });

  test("the grantee can now read exactly that page", async () => {
    const response = await guest.goto(SHARED);
    expect(response?.status()).toBe(200);
    await expect(
      guest.getByRole("heading", { level: 1, name: "Shared Page" }),
    ).toBeVisible();
  });

  test("and still gets a 404 on the sibling they were not given", async () => {
    const response = await guest.goto(SECRET);
    expect(response?.status()).toBe(404);
  });

  test("a viewer sees no edit affordance", async () => {
    await guest.goto(SHARED);
    await expect(
      guest.getByRole("link", { name: "Edit", exact: true }),
    ).toHaveCount(0);
    await expect(guest.getByRole("button", { name: "Share" })).toHaveCount(0);
  });

  test("the grantee's sidebar shows only what they can read", async () => {
    await guest.goto(SHARED);
    await expect(guest.getByRole("link", { name: "Shared Page" })).toBeVisible();
    await expect(guest.getByRole("link", { name: "Secret Page" })).toHaveCount(0);
  });

  test("raising them to editor enables editing", async () => {
    const res = await owner.request.post(
      `/api/v1/nodes/${sharedNodeId}/grants`,
      { data: { email: GUEST, role: "editor" } },
    );
    expect(res.status(), await res.text()).toBe(201);

    await guest.goto(SHARED);
    await expect(
      guest.getByRole("link", { name: "Edit", exact: true }),
    ).toBeVisible();
  });

  test("revoking removes access on the next request", async () => {
    const listed = await owner.request.get(
      `/api/v1/nodes/${sharedNodeId}/grants`,
    );
    const { grants } = await listed.json();
    const theirs = grants.find(
      (g: { grantee_email: string | null }) => g.grantee_email === GUEST,
    );
    expect(theirs, "the guest's grant should be listed").toBeTruthy();

    const revoked = await owner.request.delete(
      `/api/v1/grants/${theirs.grant_id}`,
    );
    expect(revoked.status()).toBe(204);

    const response = await guest.goto(SHARED);
    expect(response?.status()).toBe(404);
  });

  test("a stranger cannot share a node they do not administer", async () => {
    // The guest has no access at all now. This is the three-valued-logic
    // hole: can_admin answered NULL rather than false, so the guard in
    // grant_to_email never fired and this call used to succeed.
    const res = await guest.request.post(
      `/api/v1/nodes/${sharedNodeId}/grants`,
      { data: { email: GUEST, role: "admin" } },
    );
    expect(res.status()).toBe(404);

    const check = await guest.goto(SHARED);
    expect(check?.status()).toBe(404);
  });
});
