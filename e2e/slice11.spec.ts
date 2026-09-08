import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import { registerAndConfirm, createSpace } from "./auth";

const RUN = Date.now().toString(36);
const OWNER = `mcp-owner-${RUN}@maqsoodlabs.com`;
const OTHER = `mcp-other-${RUN}@maqsoodlabs.com`;
const PASSWORD = "correct-horse-battery";
const SPACE = `connected-${RUN}`;

const SECRET_WORD = `pineapple${RUN}`;

const SKILL = `---
name: Todo List
description: Read and update the reader's todos
---

# Todo List

Ask for open items, then mark them done.
`;

test.describe.configure({ mode: "serial" });

test.describe("MCP server", () => {
  let ownerCtx: BrowserContext;
  let otherCtx: BrowserContext;
  let owner: Page;
  let other: Page;
  let api: APIRequestContext;
  let spaceId: string;
  let token: string;
  let otherToken: string;
  const id: Record<string, string> = {};

  /** One JSON-RPC call, as an MCP client would make it. */
  async function rpc(
    method: string,
    params: Record<string, unknown> | undefined,
    bearer: string | null = token,
  ) {
    const res = await api.post("/api/mcp", {
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
      data: { jsonrpc: "2.0", id: 1, method, params },
    });
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  }

  async function call(name: string, args: Record<string, unknown>, bearer = token) {
    const { body } = await rpc("tools/call", { name, arguments: args }, bearer);
    return {
      text: body?.result?.content?.[0]?.text as string | undefined,
      isError: body?.result?.isError === true,
    };
  }

  test.beforeAll(async ({ browser }) => {
    // Read from the environment rather than the baseURL fixture: fixtures
    // scoped to a test are not available inside beforeAll.
    api = await playwrightRequest.newContext({
      baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    });

    otherCtx = await browser.newContext();
    other = await otherCtx.newPage();
    await registerAndConfirm(other, OTHER, PASSWORD);

    ownerCtx = await browser.newContext();
    owner = await ownerCtx.newPage();
    await registerAndConfirm(owner, OWNER, PASSWORD);
    await createSpace(owner, "Connected Space", SPACE);

    spaceId = (await owner
      .locator(".space-shell")
      .getAttribute("data-space-id")) as string;

    const pages: [string, string, "article" | "skill"][] = [
      ["Roadmap", `# Roadmap\n\nShip the thing. Mentions ${SECRET_WORD}.\n`, "article"],
      ["Todo List", SKILL, "skill"],
    ];

    for (const [name, body, contentType] of pages) {
      const created = await owner.request.post("/api/v1/nodes", {
        data: { space_id: spaceId, kind: "file", name, content_type: contentType },
      });
      expect(created.status(), await created.text()).toBe(201);
      id[name] = (await created.json()).node.id;

      const saved = await owner.request.patch(`/api/v1/nodes/${id[name]}`, {
        data: { content: body, content_version: 1 },
      });
      expect(saved.status(), await saved.text()).toBe(200);
    }
  });

  test.afterAll(async () => {
    await api.dispose();
    await ownerCtx.close();
    await otherCtx.close();
  });

  test("a token is shown exactly once, with its configuration", async () => {
    await owner.goto("/settings/mcp");
    await owner.getByLabel("Name this token").fill("Laptop");
    await owner.getByRole("button", { name: "Create token" }).click();

    const value = owner.locator(".token-value");
    await expect(value).toBeVisible();
    token = ((await value.textContent()) ?? "").trim();
    expect(token).toMatch(/^tea_/);

    // The configuration is shown alongside, so connecting is copy and paste
    // rather than a hunt through documentation.
    await expect(owner.locator(".token-config")).toContainText("/api/mcp");

    // Reloading must not show it again: only the hash was kept.
    await owner.reload();
    await expect(owner.locator(".token-value")).toHaveCount(0);
    await expect(owner.getByText("Laptop")).toBeVisible();
  });

  test("the endpoint refuses a request with no token", async () => {
    const { status } = await rpc("tools/list", undefined, null);
    expect(status).toBe(401);
  });

  test("an unknown token is refused, and looks exactly like a revoked one", async () => {
    const unknown = await rpc("tools/list", undefined, "tea_not_a_real_token");
    expect(unknown.status).toBe(401);
    expect(unknown.body?.error?.message).toBe("Unauthorized");
  });

  test("it handshakes and lists its tools", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "playwright", version: "1.0.0" },
    });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe("teapot");

    const listed = await rpc("tools/list", {});
    const names = listed.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("list_spaces");
    expect(names).toContain("search");
    expect(names).toContain("get_skill");

    // Nothing destructive ships in the first version. A leaked token that can
    // only add is a far smaller problem than one that can remove.
    expect(names).not.toContain("delete_page");
    expect(names).not.toContain("move_page");
  });

  test("it reads the owner's own content", async () => {
    const spaces = await call("list_spaces", {});
    expect(spaces.text).toContain("Connected Space");

    const page = await call("read_page", { space_id: spaceId, path: "roadmap" });
    expect(page.text).toContain("Ship the thing");

    const found = await call("search", { space_id: spaceId, query: SECRET_WORD });
    expect(found.text).toContain("Roadmap");
  });

  test("skills are listed with their metadata, and stripped of it when fetched", async () => {
    const skills = await call("list_skills", { space_id: spaceId });
    expect(skills.text).toContain("Todo List");
    expect(skills.text).toContain("Read and update the reader's todos");
    // The articles are not skills and must not be in this list.
    expect(skills.text).not.toContain("Roadmap");

    const skill = await call("get_skill", { space_id: spaceId, path: "todo-list" });
    expect(skill.text).toContain("Ask for open items");
    expect(skill.text).not.toContain("description:");

    const notASkill = await call("get_skill", {
      space_id: spaceId,
      path: "roadmap",
    });
    expect(notASkill.isError).toBe(true);
  });

  test("it can write, and refuses to clobber a concurrent edit", async () => {
    const created = await call("create_page", {
      space_id: spaceId,
      name: "From Claude",
      content: "# From Claude\n\nWritten through MCP.\n",
    });
    expect(created.isError).toBe(false);
    expect(created.text).toContain("from-claude");

    const page = await call("read_page", {
      space_id: spaceId,
      path: "from-claude",
    });
    const version = Number(/version: (\d+)/.exec(page.text ?? "")?.[1]);
    expect(version).toBeGreaterThan(0);
    const nodeId = /id: ([0-9a-f-]{36})/.exec(page.text ?? "")?.[1] as string;

    const saved = await call("update_page", {
      id: nodeId,
      content: "# From Claude\n\nEdited.\n",
      version,
    });
    expect(saved.isError).toBe(false);

    // The same version again is now stale, and must be refused rather than
    // silently overwriting what the first save wrote.
    const stale = await call("update_page", {
      id: nodeId,
      content: "# From Claude\n\nClobbered.\n",
      version,
    });
    expect(stale.isError).toBe(true);
    expect(stale.text).toMatch(/someone else saved/i);
  });

  test("a token cannot reach another account's content", async () => {
    await other.goto("/settings/mcp");
    await other.getByLabel("Name this token").fill("Theirs");
    await other.getByRole("button", { name: "Create token" }).click();
    otherToken = ((await other.locator(".token-value").textContent()) ?? "").trim();

    // Their token sees none of the owner's spaces, and asking directly for a
    // page by id gets the same not-found a missing page would.
    const spaces = await call("list_spaces", {}, otherToken);
    expect(spaces.text).not.toContain("Connected Space");

    const page = await call("read_page", { id: id["Roadmap"] }, otherToken);
    expect(page.isError).toBe(true);
    expect(page.text).toBe("Not found.");

    // And search finds nothing, including a word that exists only in a page
    // they cannot read. Finding it would confirm the page exists.
    const found = await call(
      "search",
      { space_id: spaceId, query: SECRET_WORD },
      otherToken,
    );
    expect(found.text).not.toContain("Roadmap");
  });

  test("a token cannot write into another account's space", async () => {
    const created = await call(
      "create_page",
      { space_id: spaceId, name: "Intruder" },
      otherToken,
    );
    expect(created.isError).toBe(true);

    // And nothing was created: the owner still sees only what they made.
    const listed = await owner.request.get(`/api/v1/nodes?space_id=${spaceId}`);
    const names = (await listed.json()).nodes.map((n: { name: string }) => n.name);
    expect(names).not.toContain("Intruder");
  });

  test("revoking a token stops it on the very next request", async () => {
    await owner.goto("/settings/mcp");
    await owner.getByRole("button", { name: "Revoke the token Laptop" }).click();
    await expect(owner.getByText("Laptop")).toHaveCount(0);

    const { status, body } = await rpc("tools/list", {});
    expect(status).toBe(401);
    // Indistinguishable from a token that never existed.
    expect(body?.error?.message).toBe("Unauthorized");
  });
});
