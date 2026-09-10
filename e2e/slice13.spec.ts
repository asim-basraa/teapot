import { test, expect } from "@playwright/test";

/**
 * The documentation page.
 *
 * Reachable without an account on purpose: somebody deciding whether to connect
 * Teapot to Claude needs to read what it will and will not reach before they
 * have one. So this whole suite runs in a context that never signs in.
 */
test.describe("Documentation", () => {
  test("an anonymous visitor can read it", async ({ page }) => {
    const response = await page.goto("/docs");
    expect(response?.status()).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: "Teapot" }),
    ).toBeVisible();
    // Not a redirect to the sign-in page, which is the failure mode that
    // matters here.
    expect(page.url()).toContain("/docs");
  });

  test("it says how to connect, for each client", async ({ page }) => {
    await page.goto("/docs");

    await expect(page.getByText("/api/mcp").first()).toBeVisible();
    await expect(page.getByText("claude mcp add")).toBeVisible();
    await expect(page.getByText("mcpServers")).toBeVisible();
    // Named in prose and again inside the block below it, so this asks for the
    // first rather than for the only one.
    await expect(page.getByText("mcp_servers").first()).toBeVisible();

    // The two halves it is easy to give one of. Without the beta header, or
    // without the toolset entry, the request is refused outright.
    const api = page.locator(".copyable").filter({ hasText: "Anthropic API" });
    const text = (await api.locator("pre").textContent()) ?? "";
    expect(text).toContain("anthropic-beta: mcp-client-2025-11-20");
    expect(text).toContain("mcp_toolset");
  });

  test("it is honest about the token being shown once", async ({ page }) => {
    await page.goto("/docs");
    await expect(
      page.getByText("shown once and never again", { exact: false }),
    ).toBeVisible();
  });

  test("it states what a connected Claude cannot reach", async ({ page }) => {
    await page.goto("/docs");

    await expect(page.getByText("exactly what you see and never more")).toBeVisible();
    await expect(page.getByText("delete or move anything")).toBeVisible();
    await expect(page.getByText("change who can see anything")).toBeVisible();
  });

  test("all six starter skills are there, each with a worked example", async ({
    page,
  }) => {
    await page.goto("/docs");

    const titles = [
      "Chat Context",
      "Todo List",
      "Decision Log",
      "House Style",
      "Onboarding a Colleague",
      "Runbooks",
    ];

    for (const title of titles) {
      await expect(
        page.getByRole("heading", { level: 3, name: title }),
      ).toBeVisible();
    }

    // Every skill is a real skill file, so each carries its frontmatter, and
    // each carries the worked example that makes it usable.
    const blocks = page.locator(".skill-card pre");
    await expect(blocks).toHaveCount(titles.length);

    for (let i = 0; i < titles.length; i += 1) {
      const text = (await blocks.nth(i).textContent()) ?? "";
      expect(text).toContain("---");
      expect(text).toContain("name:");
      expect(text).toContain("description:");
      expect(text).toContain("Worked example");
    }
  });

  test("the todo skill documents its format and its concurrent-edit rule", async ({
    page,
  }) => {
    await page.goto("/docs");

    const todo = page
      .locator(".skill-card")
      .filter({ hasText: "Todo List" })
      .locator("pre");

    const text = (await todo.textContent()) ?? "";
    expect(text).toContain("- [ ]");
    expect(text).toContain("- [x]");
    // The rule that stops one person's todo quietly disappearing.
    expect(text).toContain("read immediately before you write");
  });

  test("every skill can be copied in one action", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/docs");

    await page.getByRole("button", { name: "Copy Chat Context" }).click();
    await expect(page.getByRole("button", { name: "Copy Chat Context" })).toHaveText(
      "Copied",
    );

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("name: Chat Context");
    expect(copied).toContain("Worked example");
  });

  test("the landing page points at it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Read the documentation" }).click();
    await page.waitForURL(/\/docs/);
  });
});
