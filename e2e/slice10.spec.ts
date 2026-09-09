import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

const RUN = Date.now().toString(36);
const OWNER = `types-owner-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `typed-${RUN}`;

const SKILL_BODY = `---
name: Todo List
description: Read and update the reader's todos
---

# Todo List

Ask Teapot for open items, then mark them done.
`;

test.describe.configure({ mode: "serial" });

test.describe("Content types: article and skill", () => {
  let ctx: BrowserContext;
  let page: Page;
  let spaceId: string;
  let skillId: string;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext();
    page = await ctx.newPage();
    await registerAndConfirm(page, OWNER, PASSWORD);
    await createSpace(page, "Typed Space", SPACE);

    spaceId = (await page
      .locator(".space-shell")
      .getAttribute("data-space-id")) as string;
  });

  test.afterAll(async () => {
    await ctx.close();
  });

  test("a new page is an article, and a folder has no type at all", async () => {
    const article = await page.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "file", name: "Meeting Note" },
    });
    expect(article.status(), await article.text()).toBe(201);
    expect((await article.json()).node.content_type).toBe("article");

    const folder = await page.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "folder", name: "Notes" },
    });
    expect(folder.status(), await folder.text()).toBe(201);
    // A folder is neither prose nor a skill. Typing it would invite filters
    // that quietly include the containers rather than the documents.
    expect((await folder.json()).node.content_type).toBeNull();
  });

  test("a folder cannot be given a type", async () => {
    const folder = await page.request.post("/api/v1/nodes", {
      data: {
        space_id: spaceId,
        kind: "folder",
        name: "Tricky",
        content_type: "skill",
      },
    });
    expect(folder.status(), await folder.text()).toBe(201);
    expect((await folder.json()).node.content_type).toBeNull();
  });

  test("a skill can be created directly, prefilled with its frontmatter", async () => {
    const created = await page.request.post("/api/v1/nodes", {
      data: {
        space_id: spaceId,
        kind: "file",
        name: "Todo List",
        content_type: "skill",
      },
    });
    expect(created.status(), await created.text()).toBe(201);

    const node = (await created.json()).node;
    skillId = node.id;
    expect(node.content_type).toBe("skill");
    // The metadata is the part authors forget, so a new skill starts with the
    // block already there rather than being scolded for its absence later.
    expect(node.content).toContain("name: Todo List");
  });

  test("frontmatter does not render as body text", async () => {
    const saved = await page.request.patch(`/api/v1/nodes/${skillId}`, {
      data: { content: SKILL_BODY, content_version: 1 },
    });
    expect(saved.status(), await saved.text()).toBe(200);

    await page.goto(`/s/${SPACE}/todo-list`);

    const article = page.locator("article.prose");
    await expect(
      article.getByRole("heading", { level: 1, name: "Todo List" }),
    ).toBeVisible();
    await expect(article).toContainText("Ask Teapot for open items");
    // The metadata belongs to the document, not in it.
    await expect(article).not.toContainText("description:");
    await expect(article).not.toContainText("---");
  });

  test("the sidebar tells a skill from an article", async () => {
    await page.goto(`/s/${SPACE}/todo-list`);

    const skill = page.locator(".tree").getByRole("link", { name: /Todo List/ });
    await expect(skill.locator(".tree-badge")).toHaveText("skill");

    const note = page
      .locator(".tree")
      .getByRole("link", { name: /Meeting Note/ });
    await expect(note.locator(".tree-badge")).toHaveCount(0);
  });

  test("the API filters by type", async () => {
    const skills = await page.request.get(
      `/api/v1/nodes?space_id=${spaceId}&content_type=skill`,
    );
    const { nodes } = await skills.json();
    expect(nodes.map((n: { name: string }) => n.name)).toEqual(["Todo List"]);

    const articles = await page.request.get(
      `/api/v1/nodes?space_id=${spaceId}&content_type=article`,
    );
    const names = (await articles.json()).nodes.map(
      (n: { name: string }) => n.name,
    );
    expect(names).toContain("Meeting Note");
    expect(names).not.toContain("Todo List");
    // Folders carry no type, so filtering by either one leaves them out.
    expect(names).not.toContain("Notes");

    const bad = await page.request.get(
      `/api/v1/nodes?space_id=${spaceId}&content_type=nonsense`,
    );
    expect(bad.status()).toBe(400);
  });

  test("an author can reclassify a page in the editor", async () => {
    const landed = await page.goto(`/s/${SPACE}/meeting-note?edit=1`);
    expect(landed?.status()).toBe(200);

    // The editor renders only for somebody the page says may edit, so its
    // absence and a failure to change the type look identical from the outside.
    // Asserting it first means a failure says which of the two happened.
    await expect(
      page.getByRole("textbox", { name: /Markdown source/ }),
      "the editor must render before anything on it can be used",
    ).toBeVisible();

    // By role, not by label: the tree's "Rename <space>" and "Delete <space>"
    // buttons carry the space name, and getByLabel matches on a substring.
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/v1/nodes/") && r.request().method() === "PATCH",
      ),
      page.getByRole("combobox", { name: "Type" }).selectOption("skill"),
    ]);
    expect(response.status(), await response.text()).toBe(200);

    // Saved but flagged: a skill with no metadata is still somebody's writing,
    // and refusing it would lose the work over a formatting detail.
    await expect(page.getByText("This skill has no name or description")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  });

  test("the flag clears once the metadata is there", async () => {
    await page.goto(`/s/${SPACE}/meeting-note?edit=1`);
    await expect(page.getByText("This skill has no")).toBeVisible();

    await page
      .getByRole("textbox", { name: /Markdown source/ })
      .fill("---\nname: Meeting Note\ndescription: How we run them\n---\n\n# Meeting Note\n");

    await expect(page.getByText("This skill has no")).toHaveCount(0);
  });
});
