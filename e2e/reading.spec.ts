import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

/**
 * The reading column, and the contents rail beside it.
 *
 * A space is a workspace and runs the full width of the window, which is right
 * for a tree of files and wrong for a paragraph: text set across a very wide
 * pane is a line the eye loses its place on halfway back. So prose keeps a
 * measure of its own, tables and code blocks do not, and a document with
 * sections offers a way to jump between them.
 */
const RUN = Date.now().toString(36);
const READER = `reader-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `reading-${RUN}`;

const DOC = [
  "## Getting started",
  "",
  "Some prose in the first section.",
  "",
  "### A detail",
  "",
  "More prose.",
  "",
  "## Going further",
  "",
  "| A fairly long column header | And another one | And a third |",
  "| --- | --- | --- |",
  "| some value in here | another value here | a third value |",
].join("\n");

test.describe.configure({ mode: "serial" });

test.describe("Reading a page", () => {
  let ctx: BrowserContext;
  let page: Page;
  let href: string;
  /** Read once in setup: a test must not depend on where the last one left off. */
  let spaceId: string;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext();
    page = await ctx.newPage();
    await registerAndConfirm(page, READER, PASSWORD);
    await createSpace(page, "Reading Space", SPACE);

    spaceId = (await page
      .locator(".space-shell")
      .getAttribute("data-space-id")) as string;

    const created = await page.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "file", name: "Long Read" },
    });
    expect(created.status(), await created.text()).toBe(201);
    const nodeId = (await created.json()).node.id;

    const saved = await page.request.patch(`/api/v1/nodes/${nodeId}`, {
      data: { content_version: 1, content: DOC },
    });
    expect(saved.status(), await saved.text()).toBe(200);

    href = `/s/${SPACE}/long-read`;
  });

  test.afterAll(async () => {
    await ctx.close();
  });

  test("lists the sections, in the order they are met", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(href);

    const toc = page.locator(".toc");
    await expect(toc).toBeVisible();
    await expect(toc.locator("li")).toHaveText([
      "Getting started",
      "A detail",
      "Going further",
    ]);
  });

  test("and a section is a click away", async () => {
    await page.goto(href);
    await page.locator(".toc").getByRole("link", { name: "Going further" }).click();
    await expect(page).toHaveURL(new RegExp("#going-further$"));

    // The anchor is a real heading in the document, not just a fragment.
    await expect(page.locator("#going-further")).toBeVisible();
  });

  test("keeps prose to a measure while a table takes the room it needs", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(href);

    const paragraph = page
      .locator(".prose > p")
      .filter({ hasText: "Some prose in the first section." });
    const width = await paragraph.evaluate((el) => el.getBoundingClientRect().width);

    // 46rem at the default root size. The number that matters is that it is a
    // measure at all: without one this ran the whole width of the pane.
    expect(width).toBeLessThanOrEqual(46 * 16 + 1);

    const table = page.locator(".prose table").first();
    const column = await page
      .locator(".page-col")
      .evaluate((el) => el.getBoundingClientRect().width);
    const tableWidth = await table.evaluate((el) => el.getBoundingClientRect().width);
    expect(tableWidth).toBeGreaterThan(46 * 16);
    expect(tableWidth).toBeLessThanOrEqual(column + 1);
  });

  test("leaves no link to the browser's own colours", async () => {
    // The bug this guards: nothing set a colour for a bare link, so every one
    // that carried no class of its own was the browser's blue, and its purple
    // once followed. A purple "3 unread in your inbox" was the visible half.
    const UA_BLUE = "rgb(0, 0, 238)";

    for (const url of ["/spaces", href, "/account"]) {
      await page.goto(url);
      const colours = await page
        .locator("a")
        .evaluateAll((links) =>
          links.map((a) => getComputedStyle(a as HTMLElement).color),
        );
      expect(colours.length).toBeGreaterThan(0);
      expect(colours, `a link on ${url} is still the browser's default`)
        .not.toContain(UA_BLUE);
    }
  });

  test("offers no contents for a page with nothing to list", async () => {
    const created = await page.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "file", name: "Short Note" },
    });
    const nodeId = (await created.json()).node.id;
    await page.request.patch(`/api/v1/nodes/${nodeId}`, {
      data: { content_version: 1, content: "One paragraph, no sections." },
    });

    await page.goto(`/s/${SPACE}/short-note`);
    await expect(page.locator(".toc")).toHaveCount(0);
  });
});
