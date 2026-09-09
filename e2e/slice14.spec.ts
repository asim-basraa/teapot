import {
  test,
  expect,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

const RUN = Date.now().toString(36);
const OWNER = `all-owner-${RUN}@maqsoodlabs.com`;
const COLLEAGUE = `all-colleague-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `handbook-${RUN}`;

const FOLDER = `/s/${SPACE}/handbook`;
const INSIDE = `/s/${SPACE}/handbook/leave`;
const PRIVATE = `/s/${SPACE}/salaries`;

test.describe.configure({ mode: "serial" });

test.describe("Sharing with everyone who has an account", () => {
  let ownerCtx: BrowserContext;
  let colleagueCtx: BrowserContext;
  let visitorCtx: BrowserContext;
  let owner: Page;
  let colleague: Page;
  let visitor: Page;
  let folderId: string;

  test.beforeAll(async ({ browser }) => {
    colleagueCtx = await browser.newContext();
    colleague = await colleagueCtx.newPage();
    await registerAndConfirm(colleague, COLLEAGUE, PASSWORD);

    ownerCtx = await browser.newContext();
    owner = await ownerCtx.newPage();
    await registerAndConfirm(owner, OWNER, PASSWORD);
    await createSpace(owner, "Handbook Space", SPACE);

    const spaceId = await owner
      .locator(".space-shell")
      .getAttribute("data-space-id");

    const folder = await owner.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "folder", name: "Handbook" },
    });
    expect(folder.status(), await folder.text()).toBe(201);
    folderId = (await folder.json()).node.id;

    for (const [name, parent] of [
      ["Leave", folderId],
      ["Salaries", null],
    ] as const) {
      const res = await owner.request.post("/api/v1/nodes", {
        data: { space_id: spaceId, parent_id: parent, kind: "file", name },
      });
      expect(res.status(), await res.text()).toBe(201);
    }

    // Never signs in. The whole point is that this person is not included.
    visitorCtx = await browser.newContext();
    visitor = await visitorCtx.newPage();
  });

  test.afterAll(async () => {
    await ownerCtx.close();
    await colleagueCtx.close();
    await visitorCtx.close();
  });

  test("a colleague with an account starts with nothing", async () => {
    expect((await colleague.goto(INSIDE))?.status()).toBe(404);
  });

  test("the owner shares a folder with everyone here", async () => {
    await owner.goto(FOLDER);
    await owner.getByRole("button", { name: "Share", exact: true }).click();

    const reach = owner.getByRole("combobox", { name: "Visibility" });
    await expect(reach).toHaveValue("private");

    const [response] = await Promise.all([
      owner.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/nodes/${folderId}/visibility`) &&
          r.request().method() === "PUT",
      ),
      reach.selectOption("everyone:viewer"),
    ]);
    expect(response.status(), await response.text()).toBe(200);
  });

  test("every colleague can now read it, and everything under it", async () => {
    expect((await colleague.goto(FOLDER))?.status()).toBe(200);

    const page = await colleague.goto(INSIDE);
    expect(page?.status()).toBe(200);
    await expect(
      colleague.getByRole("heading", { level: 1, name: "Leave" }),
    ).toBeVisible();
  });

  test("and still nothing that was not shared", async () => {
    expect((await colleague.goto(PRIVATE))?.status()).toBe(404);
  });

  test("this is not publishing: a logged-out visitor sees nothing", async () => {
    // The distinction the whole feature exists for. "Everyone here" and "the
    // open internet" are different answers, and confusing them is the mistake
    // people make when only the second one is on offer.
    expect((await visitor.goto(FOLDER))?.status()).toBe(404);
    expect((await visitor.goto(INSIDE))?.status()).toBe(404);
  });

  test("reading is not writing", async () => {
    await colleague.goto(INSIDE);
    await expect(
      colleague.getByRole("link", { name: "Edit", exact: true }),
    ).toHaveCount(0);
  });

  test("raising it to editor lets everyone write", async () => {
    await owner.goto(FOLDER);
    await owner.getByRole("button", { name: "Share", exact: true }).click();

    const reach = owner.getByRole("combobox", { name: "Visibility" });
    await Promise.all([
      owner.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/nodes/${folderId}/visibility`) &&
          r.request().method() === "PUT",
      ),
      reach.selectOption("everyone:editor"),
    ]);

    await colleague.goto(INSIDE);
    await expect(
      colleague.getByRole("link", { name: "Edit", exact: true }),
    ).toBeVisible();
    // Editing is not administering. Nobody hands the power to reshare to
    // everyone on purpose, so it is not offered.
    await expect(
      colleague.getByRole("button", { name: "Share", exact: true }),
    ).toHaveCount(0);
  });

  test("the sharing list names it in words", async () => {
    const res = await owner.request.get(`/api/v1/nodes/${folderId}/grants`);
    const { grants } = await res.json();
    const everyone = grants.find(
      (g: { grantee_type: string }) => g.grantee_type === "authenticated",
    );
    expect(everyone, "the grant to everyone should be listed").toBeTruthy();
    expect(everyone.role).toBe("editor");
  });

  test("a page inside says where its access comes from", async () => {
    await owner.goto(INSIDE);
    await owner.getByRole("button", { name: "Share", exact: true }).click();

    // The grant lives on the folder, so this page's own setting is not the
    // whole truth about who can read it, and it says so.
    await expect(
      owner.getByRole("combobox", { name: "Visibility" }),
    ).toHaveValue("private");
    await expect(
      owner.getByText(
        "readable by everyone signed in to Teapot, so this is too",
      ),
    ).toBeVisible();
  });

  test("choosing one answer withdraws the other", async () => {
    // The reason the two controls became one. They could both be set, so a
    // node could be published *and* shared with everyone, where the second
    // says nothing the first does not, and "who can see this" had to be
    // assembled by the reader from two places that could disagree.
    await owner.goto(FOLDER);
    await owner.getByRole("button", { name: "Share", exact: true }).click();

    const reach = owner.getByRole("combobox", { name: "Visibility" });
    await Promise.all([
      owner.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/nodes/${folderId}/visibility`) &&
          r.request().method() === "PUT",
      ),
      reach.selectOption("public"),
    ]);

    const listed = await owner.request.get(
      `/api/v1/nodes/${folderId}/grants`,
    );
    const { grants } = await listed.json();
    const kinds = grants.map((g: { grantee_type: string }) => g.grantee_type);
    expect(kinds, "publishing withdraws the grant to everyone").not.toContain(
      "authenticated",
    );
    expect(kinds).toContain("public");

    // And it means what it says: no account at all.
    expect((await visitor.goto(INSIDE))?.status()).toBe(200);

    // Back the other way, which must withdraw the public grant.
    await owner.goto(FOLDER);
    await owner.getByRole("button", { name: "Share", exact: true }).click();
    await Promise.all([
      owner.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/nodes/${folderId}/visibility`) &&
          r.request().method() === "PUT",
      ),
      owner
        .getByRole("combobox", { name: "Visibility" })
        .selectOption("everyone:editor"),
    ]);

    expect(
      (await visitor.goto(INSIDE))?.status(),
      "everyone here is not the internet",
    ).toBe(404);
    expect((await colleague.goto(INSIDE))?.status()).toBe(200);
  });

  test("withdrawing it takes the access with it", async () => {
    await owner.goto(FOLDER);
    await owner.getByRole("button", { name: "Share", exact: true }).click();

    const reach = owner.getByRole("combobox", { name: "Visibility" });
    await Promise.all([
      owner.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/nodes/${folderId}/visibility`) &&
          r.request().method() === "PUT",
      ),
      reach.selectOption("private"),
    ]);

    expect((await colleague.goto(INSIDE))?.status()).toBe(404);
  });
});
