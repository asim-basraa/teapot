import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

/**
 * History, diffs and restore.
 *
 * Quartz has none of this to borrow: its only version-adjacent feature reads a
 * last-modified date out of git, and Post-it has no repository to read. So the
 * question these answer is whether a history built on the database keeps the
 * one property that matters here, which is that a revision is exactly as
 * reachable as the page it belongs to.
 */
const RUN = Date.now().toString(36);
const OWNER = `hist-owner-${RUN}@maqsoodlabs.com`;
const READER = `hist-reader-${RUN}@maqsoodlabs.com`;
const STRANGER = `hist-stranger-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `versioned-${RUN}`;

const PAGE = `/s/${SPACE}/roadmap`;

const FIRST = "# Roadmap\n\nShip in March.\n";
const SECOND = "# Roadmap\n\nShip in April.\n";

test.describe.configure({ mode: "serial" });

test.describe("Version history", () => {
  let ownerCtx: BrowserContext;
  let readerCtx: BrowserContext;
  let strangerCtx: BrowserContext;
  let owner: Page;
  let reader: Page;
  let stranger: Page;
  let nodeId: string;

  test.beforeAll(async ({ browser }) => {
    readerCtx = await browser.newContext();
    reader = await readerCtx.newPage();
    await registerAndConfirm(reader, READER, PASSWORD);

    strangerCtx = await browser.newContext();
    stranger = await strangerCtx.newPage();
    await registerAndConfirm(stranger, STRANGER, PASSWORD);

    ownerCtx = await browser.newContext();
    owner = await ownerCtx.newPage();
    await registerAndConfirm(owner, OWNER, PASSWORD);
    await createSpace(owner, "Versioned Space", SPACE);

    const spaceId = await owner
      .locator(".space-shell")
      .getAttribute("data-space-id");

    const created = await owner.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "file", name: "Roadmap" },
    });
    expect(created.status(), await created.text()).toBe(201);
    const node = (await created.json()).node;
    nodeId = node.id;

    for (const [content, version] of [
      [FIRST, node.content_version],
      [SECOND, node.content_version + 1],
    ] as const) {
      const saved = await owner.request.patch(`/api/v1/nodes/${nodeId}`, {
        data: { content, content_version: version },
      });
      expect(saved.status(), await saved.text()).toBe(200);
    }

    const shared = await owner.request.post(`/api/v1/nodes/${nodeId}/grants`, {
      data: { email: READER, role: "viewer" },
    });
    expect(shared.status(), await shared.text()).toBe(201);
  });

  test.afterAll(async () => {
    await ownerCtx.close();
    await readerCtx.close();
    await strangerCtx.close();
  });

  test("every save is kept, newest first", async () => {
    const res = await owner.request.get(`/api/v1/nodes/${nodeId}/revisions`);
    const { revisions } = await res.json();

    // The page as created, plus the two saves.
    expect(revisions).toHaveLength(3);
    expect(revisions[0].author_email).toBe(OWNER);

    const times = revisions.map((r: { created_at: string }) =>
      Date.parse(r.created_at),
    );
    expect(times, "newest first").toEqual([...times].sort((a, b) => b - a));
  });

  test("the panel shows what changed, not just that something did", async () => {
    await owner.goto(PAGE);
    await owner.getByRole("button", { name: "History" }).click();

    const dialog = owner.getByRole("dialog", { name: "History of Roadmap" });
    await expect(dialog).toBeVisible();

    // It opens on the previous version rather than on the current one,
    // because comparing something with itself is the one answer nobody wants.
    await expect(dialog.locator(".diff-removed")).toContainText("Ship in March");
    await expect(dialog.locator(".diff-added")).toContainText("Ship in April");
    await expect(dialog.getByText("1 added, 1 removed")).toBeVisible();

    // And the lines that did not change are shown as unchanged rather than as
    // a wholesale rewrite.
    // The heading line specifically. Every line of the document is its own
    // span, so asking the whole set to contain one line asks several elements
    // the same question at once.
    await expect(
      dialog.locator(".diff-same").filter({ hasText: "# Roadmap" }),
    ).toHaveCount(1);
  });

  test("restoring puts the old text back, and goes in forwards", async () => {
    const dialog = owner.getByRole("dialog", { name: "History of Roadmap" });
    await dialog.getByRole("button", { name: "Restore this version" }).click();

    await expect(dialog.getByText("Restored")).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();

    await owner.goto(PAGE);
    await expect(owner.locator("article.prose")).toContainText("Ship in March");

    // The restore is an edit like any other, so it is itself in the history and
    // can itself be undone. Three rather than four because only the last three
    // versions are kept: the fourth pushed the page as created off the end.
    const res = await owner.request.get(`/api/v1/nodes/${nodeId}/revisions`);
    const { revisions } = await res.json();
    expect(revisions).toHaveLength(3);
  });

  test("a reader can see the history but not rewrite it", async () => {
    await reader.goto(PAGE);
    await reader.getByRole("button", { name: "History" }).click();

    const dialog = reader.getByRole("dialog", { name: "History of Roadmap" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".history-entry")).toHaveCount(3);

    // Reading the past is a reader's right; changing it is not.
    await expect(
      dialog.getByRole("button", { name: "Restore this version" }),
    ).toHaveCount(0);
  });

  test("three deep, and the oldest falls off the end", async () => {
    // A version is stored as the difference from the one after it, anchored at
    // what the page says now. So this is the case worth proving: after enough
    // saves to push the far end off, every version still left must rebuild
    // exactly, which it can only do if dropping the oldest never broke the
    // chain.
    // The newest entry is the page as it stands, so its version number is the
    // one a save has to present.
    const before = await owner.request.get(`/api/v1/nodes/${nodeId}/revisions`);
    let version = (await before.json()).revisions[0].content_version as number;

    for (const month of ["June", "July", "August"]) {
      const saved = await owner.request.patch(`/api/v1/nodes/${nodeId}`, {
        data: { content: `# Roadmap\n\nShip in ${month}.\n`, content_version: version },
      });
      expect(saved.status(), await saved.text()).toBe(200);
      version += 1;
    }

    const res = await owner.request.get(`/api/v1/nodes/${nodeId}/revisions`);
    const { revisions } = await res.json();
    expect(revisions, "never more than three").toHaveLength(3);

    const bodies: string[] = [];
    for (const revision of revisions) {
      const one = await owner.request.get(`/api/v1/revisions/${revision.id}`);
      expect(one.status(), await one.text()).toBe(200);
      bodies.push((await one.json()).revision.content);
    }

    // Newest first: what it says now, then the two before it. The months
    // before those are gone, which is what keeping three means.
    expect(bodies).toEqual([
      "# Roadmap\n\nShip in August.\n",
      "# Roadmap\n\nShip in July.\n",
      "# Roadmap\n\nShip in June.\n",
    ]);
  });

  test("somebody who cannot read the page has no history to read", async () => {
    expect((await stranger.goto(PAGE))?.status()).toBe(404);

    const res = await stranger.request.get(
      `/api/v1/nodes/${nodeId}/revisions`,
    );
    // Empty, not forbidden: the same answer a page with no history gives, and
    // the same answer a page that does not exist gives.
    expect((await res.json()).revisions).toHaveLength(0);
  });

  test("and cannot restore one by naming it", async () => {
    const listed = await owner.request.get(
      `/api/v1/nodes/${nodeId}/revisions`,
    );
    const { revisions } = await listed.json();
    const target = revisions[revisions.length - 1].id;

    const refused = await stranger.request.post(
      `/api/v1/revisions/${target}/restore`,
    );
    expect(refused.status()).toBe(404);

    // A viewer knows the id and still may not.
    const viewer = await reader.request.post(
      `/api/v1/revisions/${target}/restore`,
    );
    expect(viewer.status()).toBe(404);
  });
});
