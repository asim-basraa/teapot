import { describe, expect, it } from "vitest";
import { diffLines, diffSummary } from "@/lib/diff";

const rendered = (before: string, after: string) =>
  diffLines(before, after).map(
    (line) =>
      `${line.kind === "same" ? " " : line.kind === "added" ? "+" : "-"}${line.text}`,
  );

describe("diffLines", () => {
  it("says nothing changed when nothing changed", () => {
    expect(rendered("one\ntwo\n", "one\ntwo\n")).toEqual([" one", " two"]);
  });

  it("marks an inserted line", () => {
    expect(rendered("one\nthree\n", "one\ntwo\nthree\n")).toEqual([
      " one",
      "+two",
      " three",
    ]);
  });

  it("marks a deleted line", () => {
    expect(rendered("one\ntwo\nthree\n", "one\nthree\n")).toEqual([
      " one",
      "-two",
      " three",
    ]);
  });

  it("shows a changed line as the old one and then the new", () => {
    expect(rendered("hello\n", "goodbye\n")).toEqual(["-hello", "+goodbye"]);
  });

  it("does not invent a change on a trailing newline", () => {
    // The bug this guards: splitting on newline yields a phantom empty last
    // line, so every file ending in a newline diffs as having changed.
    expect(rendered("one\n", "one")).toEqual([" one"]);
  });

  it("handles an empty document at either end", () => {
    expect(rendered("", "one\n")).toEqual(["+one"]);
    expect(rendered("one\n", "")).toEqual(["-one"]);
    expect(rendered("", "")).toEqual([]);
  });

  it("keeps the common lines rather than rewriting the whole document", () => {
    const before = "a\nb\nc\nd\ne\n";
    const after = "a\nb\nX\nd\ne\n";
    const lines = diffLines(before, after);

    expect(diffSummary(lines)).toEqual({ added: 1, removed: 1 });
    expect(lines.filter((l) => l.kind === "same").map((l) => l.text)).toEqual([
      "a",
      "b",
      "d",
      "e",
    ]);
  });

  it("counts both directions", () => {
    const lines = diffLines("a\nb\nc\n", "a\nx\ny\nz\n");
    expect(diffSummary(lines)).toEqual({ added: 3, removed: 2 });
  });
});
