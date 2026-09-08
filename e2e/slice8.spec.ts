import {
  test,
  expect,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

const RUN = Date.now().toString(36);
const OWNER = `search-owner-${RUN}@maqsoodlabs.com`;
const GUEST = `search-guest-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `searched-${RUN}`;

// A word in both pages, so the only reason one result is missing is access.
const SHARED_WORD = `kumquat${RUN}`;
// A word only in the restricted page. Finding it at all would confirm that
// page exists, which is the thing search must never do.
const SECRET_WORD = `severance${RUN}`;

test.describe.configure({ mode: "serial" });

test.describe("Slice 8: permission-filtered search", () => {
  let ownerCtx: BrowserContext;
  let guestCtx: BrowserContext;
  let visitorCtx: BrowserContext;
  let owner: Page;
  let guest: Page;
  let visitor: Page;
  let spaceId: string;
  const id: Record<string, string> = {};

  test.beforeAll(async ({ browser }) => {
    guestCtx = await browser.newContext();
    guest = await guestCtx.newPage();
    await registerAndConfirm(guest, GUEST, PASSWORD);

    ownerCtx = await browser.newContext();
    owner = await ownerCtx.newPage();
    await registerAndConfirm(owner, OWNER, PASSWORD);
    await createSpace(owner, "Searched Space", SPACE);

    spaceId = (await owner
      .locator(".space-shell")
      .getAttribute("data-space-id")) as string;

    const pages: [string, string][] = [
      ["Open Page", `The open page mentions ${SHARED_WORD} once.`],
      [
        "Closed Page",
        `The closed page mentions ${SHARED_WORD} and also ${SECRET_WORD}.`,
      ],
    ];

    for (const [name, body] of pages) {
      const created = await owner.request.post("/api/v1/nodes", {
        data: { space_id: spaceId, kind: "file", name },
      });
      expect(created.status(), await created.text()).toBe(201);
      id[name] = (await created.json()).node.id;

      const saved = await owner.request.patch(`/api/v1/nodes/${id[name]}`, {
        data: { content: `# ${name}\n\n${body}\n`, content_version: 1 },
      });
      expect(saved.status(), await saved.text()).toBe(200);
    }

    const shared = await owner.request.post(
      `/api/v1/nodes/${id["Open Page"]}/grants`,
      { data: { email: GUEST, role: "viewer" } },
    );
    expect(shared.status(), await shared.text()).toBe(201);

    visitorCtx = await browser.newContext();
    visitor = await visitorCtx.newPage();
  });

  test.afterAll(async () => {
    await ownerCtx.close();
    await guestCtx.close();
    await visitorCtx.close();
  });

  test("the owner finds both pages, with a snippet", async () => {
    await owner.goto(`/s/${SPACE}/open-page`);
    await owner.getByLabel("Search").fill(SHARED_WORD);

    const results = owner.locator(".search-results");
    await expect(results.getByRole("link", { name: "Open Page" })).toBeVisible();
    await expect(
      results.getByRole("link", { name: "Closed Page" }),
    ).toBeVisible();
    await expect(results.locator("mark").first()).toHaveText(SHARED_WORD);
  });

  test("a grantee finds only the page they can read", async () => {
    await guest.goto(`/s/${SPACE}/open-page`);
    await guest.getByLabel("Search").fill(SHARED_WORD);

    const results = guest.locator(".search-results");
    await expect(results.getByRole("link", { name: "Open Page" })).toBeVisible();
    await expect(
      results.getByRole("link", { name: "Closed Page" }),
    ).toHaveCount(0);
  });

  test("a word unique to a restricted page finds nothing", async () => {
    await guest.goto(`/s/${SPACE}/open-page`);
    await guest.getByLabel("Search").fill(SECRET_WORD);

    await expect(guest.getByText("Nothing matched.")).toBeVisible();

    // And not merely hidden in the UI: the endpoint returns nothing either.
    const res = await guest.request.get(
      `/api/v1/search?space_id=${spaceId}&q=${SECRET_WORD}`,
    );
    expect((await res.json()).hits).toHaveLength(0);
  });

  test("a stranger's search over the whole space returns nothing", async () => {
    const res = await visitor.request.get(
      `/api/v1/search?space_id=${spaceId}&q=${SHARED_WORD}`,
    );
    expect(res.status()).toBe(200);
    expect((await res.json()).hits).toHaveLength(0);
  });

  test("publishing a page puts it in an anonymous visitor's results", async () => {
    const published = await owner.request.put(
      `/api/v1/nodes/${id["Open Page"]}/public`,
      { data: { public: true } },
    );
    expect(published.status(), await published.text()).toBe(200);

    await visitor.goto(`/s/${SPACE}/open-page`);
    await visitor.getByLabel("Search").fill(SHARED_WORD);

    const results = visitor.locator(".search-results");
    await expect(results.getByRole("link", { name: "Open Page" })).toBeVisible();
    await expect(
      results.getByRole("link", { name: "Closed Page" }),
    ).toHaveCount(0);

    const res = await visitor.request.get(
      `/api/v1/search?space_id=${spaceId}&q=${SECRET_WORD}`,
    );
    expect((await res.json()).hits).toHaveLength(0);
  });
});
