import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

/**
 * The app at phone width.
 *
 * The app had no viewport meta tag at all, so a phone laid the page out at about
 * 980px and scaled the result down: every screen was a working desktop layout
 * shrunk to illegibility, and none of the existing breakpoints ever applied.
 *
 * The claim worth testing is not that it looks nice, which no assertion can
 * check, but the one thing that makes a page unusable on a phone and is
 * measurable: the page must not scroll sideways. Everything genuinely wider than
 * a phone — a table, a code block — has to scroll inside its own box instead.
 */
const RUN = Date.now().toString(36);
const EMAIL = `mobile-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `mobile-${RUN}`;

test.describe.configure({ mode: "serial" });

test.describe("At phone width", () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({
      viewport: { width: 360, height: 740 },
      hasTouch: true,
    });
    page = await context.newPage();
    await registerAndConfirm(page, EMAIL, PASSWORD);
    await createSpace(page, "Mobile Space", SPACE);

    const spaceId = (await page
      .locator(".space-shell")
      .getAttribute("data-space-id")) as string;

    // A page carrying the two things that are genuinely wider than a phone and
    // must scroll inside themselves rather than widening the page.
    const wide = await page.request.post("/api/v1/nodes", {
      data: { space_id: spaceId, kind: "file", name: "Wide Things" },
    });
    const nodeId = (await wide.json()).node.id;
    await page.request.patch(`/api/v1/nodes/${nodeId}`, {
      data: {
        content_version: 1,
        content: [
          "| A fairly long column header | And another one | And a third |",
          "| --- | --- | --- |",
          "| some value in here | another value here | a third value |",
          "",
          "```",
          "an_extremely_long_line_of_code_that_could_never_fit_on_a_narrow_screen_at_all_x = 1",
          "```",
          "",
          "https://example.com/an/extremely/long/url/that/cannot/be/broken/at/a/space/at/all",
        ].join("\n"),
      },
    });
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("the viewport is declared, or none of the rest applies", async () => {
    await page.goto("/");
    const meta = page.locator('meta[name="viewport"]');
    await expect(meta).toHaveAttribute("content", /width=device-width/);
    // Pinch-zoom must stay available: it is how people read small text.
    const content = (await meta.getAttribute("content")) ?? "";
    expect(content).not.toContain("user-scalable=no");
    expect(content).not.toContain("maximum-scale=1");
  });

  for (const [what, url] of [
    ["the front page", "/"],
    ["the sign-in page", "/login"],
    ["your spaces", "/spaces"],
    ["your teams", "/teams"],
    ["your account", "/account"],
    ["a space", `/s/${SPACE}`],
    ["a page with wide things on it", `/s/${SPACE}/wide-things`],
  ] as const) {
    test(`${what} does not scroll sideways`, async () => {
      await page.goto(url);

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));

      // One pixel of slack for sub-pixel rounding, and no more.
      expect(
        overflow.scrollWidth,
        `${url} is ${overflow.scrollWidth - overflow.innerWidth}px wider than the screen`,
      ).toBeLessThanOrEqual(overflow.innerWidth + 1);
    });
  }

  test("the header still offers everything it does on a desktop", async () => {
    await page.goto("/spaces");

    // Wrapped rather than cut off: all three must be reachable.
    await expect(page.locator(".shell-account")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.locator(".shell-brand")).toBeVisible();
  });

  test("the tree's actions are reachable without a hover", async () => {
    // The failure this guards: they were hidden behind :hover, which does not
    // exist on a touchscreen, so the tree could be read and not acted on and no
    // gesture would ever reveal the buttons.
    await page.goto(`/s/${SPACE}/wide-things`);

    const row = page.locator(".tree-row", { hasText: "Wide Things" });
    await expect(
      row.getByRole("button", { name: "Rename Wide Things" }),
    ).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Move Wide Things" }),
    ).toBeVisible();
  });

  test("and the footer is still there and still works", async () => {
    await page.goto("/spaces");
    await page.getByRole("button", { name: "Tell me a joke" }).click();
    await expect(
      page.getByRole("dialog", { name: "Tell me a joke" }),
    ).toBeVisible();
  });
});
