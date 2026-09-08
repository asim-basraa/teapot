import { describe, it, expect } from "vitest";
import { parseFrontmatter, readSkillMetadata } from "../src/index";

describe("parseFrontmatter", () => {
  it("returns the document untouched when there is no frontmatter", () => {
    const result = parseFrontmatter("# Title\n\nSome prose.\n");
    expect(result.present).toBe(false);
    expect(result.data).toEqual({});
    expect(result.body).toBe("# Title\n\nSome prose.\n");
    expect(result.error).toBeNull();
  });

  it("splits a block off the top and keeps the body", () => {
    const result = parseFrontmatter(
      "---\nname: Chat Context\ndescription: Load prior conversation\n---\n# Chat Context\n\nBody.\n",
    );
    expect(result.present).toBe(true);
    expect(result.data).toEqual({
      name: "Chat Context",
      description: "Load prior conversation",
    });
    expect(result.body).toBe("# Chat Context\n\nBody.\n");
  });

  it("lowercases keys so casing in the file does not matter", () => {
    const result = parseFrontmatter("---\nName: A\nDESCRIPTION: B\n---\nBody\n");
    expect(result.data).toEqual({ name: "A", description: "B" });
  });

  // A rule partway down a document is a horizontal rule. Treating it as
  // frontmatter would eat the top of somebody's page.
  it("ignores a rule that is not at the very start", () => {
    const markdown = "# Title\n\n---\nname: Nope\n---\n";
    const result = parseFrontmatter(markdown);
    expect(result.present).toBe(false);
    expect(result.body).toBe(markdown);
  });

  it("accepts a closing ... as well as ---", () => {
    const result = parseFrontmatter("---\nname: A\n...\nBody\n");
    expect(result.data).toEqual({ name: "A" });
    expect(result.body).toBe("Body\n");
  });

  it("handles an empty block", () => {
    const result = parseFrontmatter("---\n\n---\nBody\n");
    expect(result.present).toBe(true);
    expect(result.data).toEqual({});
    expect(result.error).toBeNull();
    expect(result.body).toBe("Body\n");
  });

  // Forgiving on purpose: refusing the save would lose the author's work over
  // a stray colon, so the body survives and the problem is reported.
  it("keeps the body and reports the error when YAML is malformed", () => {
    const result = parseFrontmatter("---\nname: [unclosed\n---\nBody\n");
    expect(result.present).toBe(true);
    expect(result.body).toBe("Body\n");
    expect(result.error).toBeTruthy();
    expect(result.data).toEqual({});
  });

  it("reports a block that is not key-value pairs", () => {
    const result = parseFrontmatter("---\n- one\n- two\n---\nBody\n");
    expect(result.error).toMatch(/key: value/i);
    expect(result.body).toBe("Body\n");
  });

  it("flattens non-string values rather than dropping them", () => {
    const result = parseFrontmatter(
      "---\nname: A\ncount: 3\ntags:\n  - x\n  - y\n---\nBody\n",
    );
    expect(result.data.count).toBe("3");
    expect(result.data.tags).toBe("x, y");
  });

  it("carries CRLF documents", () => {
    const result = parseFrontmatter("---\r\nname: A\r\n---\r\nBody\r\n");
    expect(result.data).toEqual({ name: "A" });
    expect(result.body).toBe("Body\r\n");
  });
});

describe("readSkillMetadata", () => {
  it("reads name and description", () => {
    const meta = readSkillMetadata(
      "---\nname: Todo\ndescription: Track work\n---\nBody\n",
    );
    expect(meta).toEqual({
      name: "Todo",
      description: "Track work",
      missing: [],
    });
  });

  it("names what is missing rather than failing", () => {
    expect(readSkillMetadata("---\nname: Todo\n---\nBody\n").missing).toEqual([
      "description",
    ]);
    expect(readSkillMetadata("# Just prose\n").missing).toEqual([
      "name",
      "description",
    ]);
  });

  it("treats blank values as missing", () => {
    const meta = readSkillMetadata(
      '---\nname: "  "\ndescription: ""\n---\nBody\n',
    );
    expect(meta.name).toBeNull();
    expect(meta.missing).toEqual(["name", "description"]);
  });
});
