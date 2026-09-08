import {
  test,
  expect,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

const RUN = Date.now().toString(36);
const OWNER = `link-owner-${RUN}@maqsoodlabs.com`;
const GUEST = `link-guest-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `linked-${RUN}`;

const SOURCE = `/s/${SPACE}/source-page`;
const TARGET = `/s/${SPACE}/target-page`;

// Three links: one to a page everyone in the test can read, one to a page the
// guest cannot, and one to a page that does not exist. The second and third
// must be indistinguishable.
const BODY = `# Source Page

Links to [[Target Page]], to [[Secret Page]], and to [[Nowhere At All]].
`;

test.describe.configure({ mode: "serial" });

test.describe("Slice 7: wikilinks and backlinks", () => {
  let ownerCtx: BrowserContext;
  let guestCtx: BrowserContext;
  let owner: Page;
  let guest: Page;
  let spaceId: string;
  const id: Record<string, string> = {};

  test.beforeAll(async ({ browser }) => {
    guestCtx = await browser.newContext();
    guest = await guestCtx.newPage();
    await registerAndConfirm(guest, GUEST, PASSWORD);

    ownerCtx = await browser.newContext();
    owner = await ownerCtx.newPage();
    await registerAndConfirm(owner, OWNER, PASSWORD);
    await createSpace(owner, "Linked Space", SPACE);

    spaceId = (await owner
      .locator(".space-shell")
      .getAttribute("data-space-id")) as string;

    for (const name of ["Source Page", "Target Page", "Secret Page"]) {
      const res = await owner.request.post("/api/v1/nodes", {
        data: { space_id: spaceId, kind: "file", name },
      });
      expect(res.status(), await res.text()).toBe(201);
      id[name] = (await res.json()).node.id;
    }

    const saved = await owner.request.patch(`/api/v1/nodes/${id["Source Page"]}`, {
      data: { content: BODY, content_version: 1 },
    });
    expect(saved.status(), await saved.text()).toBe(200);
  });

  test.afterAll(async () => {
    await ownerCtx.close();
    await guestCtx.close();
  });

  test("a wikilink to a readable page navigates", async () => {
    await owner.goto(SOURCE);
    // Scoped to the article: the sidebar lists the same page by the same name,
    // and it is the rendered link that is under test.
    await owner
      .locator("article.prose")
      .getByRole("link", { name: "Target Page" })
      .click();
    await owner.waitForURL(new RegExp("/s/.*/target-page"));
    await expect(
      owner.getByRole("heading", { level: 1, name: "Target Page" }),
    ).toBeVisible();
  });

  test("a wikilink to a missing page is inert", async () => {
    await owner.goto(SOURCE);
    const dead = owner.locator("article.prose .wikilink-unresolved", {
      hasText: "Nowhere At All",
    });
    await expect(dead).toBeVisible();
    await expect(dead).toHaveAttribute("aria-disabled", "true");
    await expect(
      owner.locator("article.prose a", { hasText: "Nowhere At All" }),
    ).toHaveCount(0);
  });

  test("the target page lists what links to it", async () => {
    await owner.goto(TARGET);
    const panel = owner.getByRole("navigation", {
      name: "Pages that link here",
    });
    await expect(panel.getByRole("link", { name: "Source Page" })).toBeVisible();
  });

  test("moving a page updates where its links point", async () => {
    const folder = await owner.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "folder", name: "Notes" },
    });
    expect(folder.status(), await folder.text()).toBe(201);

    const moved = await owner.request.patch(
      `/api/v1/nodes/${id["Target Page"]}`,
      { data: { parent_id: (await folder.json()).node.id } },
    );
    expect(moved.status(), await moved.text()).toBe(200);

    // The source was not re-saved. Resolution happens at render time against
    // the current tree, so the link follows the page rather than going stale.
    await owner.goto(SOURCE);
    await expect(
      owner.locator("article.prose").getByRole("link", { name: "Target Page" }),
    ).toHaveAttribute("href", `/s/${SPACE}/notes/target-page`);
  });

  test("the backlink survives the move too", async () => {
    // Links are recorded by id, not by path, so nothing needed rewriting.
    await owner.goto(`/s/${SPACE}/notes/target-page`);
    const panel = owner.getByRole("navigation", {
      name: "Pages that link here",
    });
    await expect(panel.getByRole("link", { name: "Source Page" })).toBeVisible();
  });

  test("a restricted link and a broken link look identical", async () => {
    // The guest gets the source page and the target, but never Secret Page.
    for (const name of ["Source Page", "Target Page"]) {
      const res = await owner.request.post(`/api/v1/nodes/${id[name]}/grants`, {
        data: { email: GUEST, role: "viewer" },
      });
      expect(res.status(), await res.text()).toBe(201);
    }

    await guest.goto(SOURCE);

    // Both the forbidden target and the nonexistent one render as the same
    // inert span. If they differed, the difference would itself disclose that
    // Secret Page exists.
    const forbidden = guest.locator("article.prose .wikilink-unresolved", {
      hasText: "Secret Page",
    });
    const missing = guest.locator("article.prose .wikilink-unresolved", {
      hasText: "Nowhere At All",
    });

    await expect(forbidden).toBeVisible();
    await expect(missing).toBeVisible();

    const shape = async (locator: typeof forbidden) =>
      locator.evaluate((el) => ({
        tag: el.tagName,
        className: el.className,
        attributes: [...el.attributes]
          .map((a) => a.name)
          .sort()
          .join(","),
      }));

    expect(await shape(forbidden)).toEqual(await shape(missing));

    // And the readable one is still a real link, so the test is not passing
    // because nothing resolved at all.
    await expect(
      guest.locator("article.prose").getByRole("link", { name: "Target Page" }),
    ).toBeVisible();
  });

  test("backlinks omit sources the viewer cannot read", async () => {
    // A second page linking to Target, which the guest is never given.
    const hidden = await owner.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "file", name: "Hidden Source" },
    });
    expect(hidden.status(), await hidden.text()).toBe(201);
    const hiddenId = (await hidden.json()).node.id;

    const saved = await owner.request.patch(`/api/v1/nodes/${hiddenId}`, {
      data: {
        content: "# Hidden Source\n\nAlso points at [[Target Page]].\n",
        content_version: 1,
      },
    });
    expect(saved.status(), await saved.text()).toBe(200);

    const targetPath = `/s/${SPACE}/notes/target-page`;

    // The owner sees both sources.
    await owner.goto(targetPath);
    const ownerPanel = owner.getByRole("navigation", {
      name: "Pages that link here",
    });
    await expect(
      ownerPanel.getByRole("link", { name: "Hidden Source" }),
    ).toBeVisible();

    // The guest sees only the one they can read. A backlink panel that named
    // Hidden Source would be admitting a page they have no access to exists.
    await guest.goto(targetPath);
    const guestPanel = guest.getByRole("navigation", {
      name: "Pages that link here",
    });
    await expect(
      guestPanel.getByRole("link", { name: "Source Page" }),
    ).toBeVisible();
    await expect(
      guestPanel.getByRole("link", { name: "Hidden Source" }),
    ).toHaveCount(0);
  });
});
