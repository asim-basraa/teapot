import {
  test,
  expect,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

const RUN = Date.now().toString(36);
const OWNER = `publish-owner-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `published-${RUN}`;

const FOLDER = `/s/${SPACE}/open-notes`;
const OPEN = `/s/${SPACE}/open-notes/first-page`;
const CLOSED = `/s/${SPACE}/closed-page`;

test.describe.configure({ mode: "serial" });

test.describe("Slice 6: public sharing", () => {
  let ownerCtx: BrowserContext;
  // A context of its own, with no session cookie at all: the whole point is
  // what somebody who has never signed in can see.
  let visitorCtx: BrowserContext;
  let owner: Page;
  let visitor: Page;
  let folderId: string;

  test.beforeAll(async ({ browser }) => {
    ownerCtx = await browser.newContext();
    owner = await ownerCtx.newPage();
    await registerAndConfirm(owner, OWNER, PASSWORD);
    await createSpace(owner, "Published Space", SPACE);

    const spaceId = await owner
      .locator(".space-shell")
      .getAttribute("data-space-id");

    const folder = await owner.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "folder", name: "Open Notes" },
    });
    expect(folder.status(), await folder.text()).toBe(201);
    folderId = (await folder.json()).node.id;

    for (const [name, parent] of [
      ["First Page", folderId],
      ["Closed Page", null],
    ] as const) {
      const res = await owner.request.post("/api/v1/nodes", {
        data: { space_id: spaceId, parent_id: parent, kind: "file", name },
      });
      expect(res.status(), await res.text()).toBe(201);
    }

    visitorCtx = await browser.newContext();
    visitor = await visitorCtx.newPage();
  });

  test.afterAll(async () => {
    await ownerCtx.close();
    await visitorCtx.close();
  });

  test("a logged-out visitor sees nothing before anything is published", async () => {
    expect((await visitor.goto(OPEN))?.status()).toBe(404);
    expect((await visitor.goto(`/s/${SPACE}`))?.status()).toBe(404);
  });

  test("the owner publishes a folder from the share dialog", async () => {
    await owner.goto(FOLDER);
    await owner.getByRole("button", { name: "Share", exact: true }).click();

    const reach = owner.getByRole("combobox", { name: "Visibility" });
    await expect(reach).toHaveValue("private");

    // Waiting on the response, not on the control. The control is optimistic,
    // so it moves before the server has agreed, and asserting on it alone
    // would let the next test race ahead of a write that has not landed.
    const [response] = await Promise.all([
      owner.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/nodes/${folderId}/visibility`) &&
          r.request().method() === "PUT",
      ),
      reach.selectOption("public"),
    ]);
    expect(response.status(), await response.text()).toBe(200);

    await expect(
      owner.getByText("No sign-in, no account", { exact: false }),
    ).toBeVisible();
  });

  test("a logged-out visitor can read it and everything under it", async () => {
    expect((await visitor.goto(FOLDER))?.status()).toBe(200);

    const page = await visitor.goto(OPEN);
    expect(page?.status()).toBe(200);
    await expect(
      visitor.getByRole("heading", { level: 1, name: "First Page" }),
    ).toBeVisible();
  });

  test("and still nothing outside it", async () => {
    expect((await visitor.goto(CLOSED))?.status()).toBe(404);
  });

  test("a public grant confers no writing", async () => {
    await visitor.goto(OPEN);
    await expect(
      visitor.getByRole("link", { name: "Edit", exact: true }),
    ).toHaveCount(0);
    await expect(visitor.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);

    // Not merely hidden: the endpoint refuses too.
    const res = await visitor.request.put(
      `/api/v1/nodes/${folderId}/visibility`,
      { data: { visibility: "private" } },
    );
    expect(res.status()).toBe(404);
  });

  test("the visitor is offered a way in rather than a dead end", async () => {
    await visitor.goto(OPEN);
    await expect(visitor.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("a descendant says where its publicness comes from", async () => {
    await owner.goto(OPEN);
    await owner.getByRole("button", { name: "Share", exact: true }).click();

    // The grant lives on the folder, so this page's own setting is not the
    // whole truth about who can read it. It says so instead of lying.
    await expect(
      owner.getByRole("combobox", { name: "Visibility" }),
    ).toHaveValue("private");
    await expect(
      owner.getByText("readable by anyone with the link, so this is too"),
    ).toBeVisible();
  });

  test("unpublishing hides it again", async () => {
    await owner.goto(FOLDER);
    await owner.getByRole("button", { name: "Share", exact: true }).click();

    const reach = owner.getByRole("combobox", { name: "Visibility" });
    await expect(reach).toHaveValue("public");

    const [response] = await Promise.all([
      owner.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/nodes/${folderId}/visibility`) &&
          r.request().method() === "PUT",
      ),
      reach.selectOption("private"),
    ]);
    expect(response.status(), await response.text()).toBe(200);

    await expect(reach).toHaveValue("private");

    expect((await visitor.goto(OPEN))?.status()).toBe(404);
    expect((await visitor.goto(FOLDER))?.status()).toBe(404);
  });

});
