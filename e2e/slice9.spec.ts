import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

const RUN = Date.now().toString(36);
const OWNER = `mermaid-owner-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `diagrams-${RUN}`;

const GOOD = `# Good Diagram

\`\`\`mermaid
graph TD;
  Draft-->Review;
  Review-->Published;
\`\`\`
`;

const BAD = `# Bad Diagram

\`\`\`mermaid
graph TD
  this is not a diagram (((
\`\`\`
`;

const MIXED = `# Mixed Page

\`\`\`mermaid
graph LR;
  A-->B;
\`\`\`

\`\`\`ts
const x: number = 1;
\`\`\`
`;

test.describe.configure({ mode: "serial" });

test.describe("Mermaid diagrams", () => {
  let ctx: BrowserContext;
  let page: Page;
  let spaceId: string;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext();
    page = await ctx.newPage();
    await registerAndConfirm(page, OWNER, PASSWORD);
    await createSpace(page, "Diagram Space", SPACE);

    spaceId = (await page
      .locator(".space-shell")
      .getAttribute("data-space-id")) as string;

    const pages: [string, string][] = [
      ["Good Diagram", GOOD],
      ["Bad Diagram", BAD],
      ["Mixed Page", MIXED],
    ];

    for (const [name, body] of pages) {
      const created = await page.request.post("/api/v1/nodes", {
        data: { space_id: spaceId, kind: "file", name },
      });
      expect(created.status(), await created.text()).toBe(201);

      const saved = await page.request.patch(
        `/api/v1/nodes/${(await created.json()).node.id}`,
        { data: { content: body, content_version: 1 } },
      );
      expect(saved.status(), await saved.text()).toBe(200);
    }
  });

  test.afterAll(async () => {
    await ctx.close();
  });

  test("a diagram renders as a drawing", async () => {
    await page.goto(`/s/${SPACE}/good-diagram`);

    const diagram = page.locator("pre.mermaid");
    await expect(diagram.locator("svg")).toBeVisible();
    // The labels came from the source, so the drawing is this diagram and not
    // some leftover from another page.
    await expect(diagram).toContainText("Published");
  });

  test("a malformed diagram shows its source and the error", async () => {
    await page.goto(`/s/${SPACE}/bad-diagram`);

    const diagram = page.locator("pre.mermaid");
    await expect(diagram).toHaveClass(/mermaid-error/);
    // Both halves matter: an author needs to know it failed and see what they
    // wrote. A blank space is the worst outcome.
    await expect(diagram.locator(".mermaid-message")).toBeVisible();
    await expect(diagram.locator("code")).toContainText(
      "this is not a diagram",
    );
  });

  test("ordinary code on the same page is still highlighted", async () => {
    await page.goto(`/s/${SPACE}/mixed-page`);

    await expect(page.locator("pre.mermaid svg")).toBeVisible();
    // Shiki's own class, on the block that is not a diagram.
    await expect(page.locator("pre.shiki")).toBeVisible();
    await expect(page.locator("pre.shiki")).toContainText("const x");
  });

  test("a diagram is legible in dark mode too", async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/s/${SPACE}/good-diagram`);

    const diagram = page.locator("pre.mermaid");
    await expect(diagram.locator("svg")).toBeVisible();
    await expect(diagram).toContainText("Published");

    await page.emulateMedia({ colorScheme: "light" });
  });
});
