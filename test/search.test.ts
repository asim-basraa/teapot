import { describe, it, expect } from "vitest";
import {
  splitHighlights,
  HIGHLIGHT_START as S,
  HIGHLIGHT_END as E,
} from "../lib/search";

describe("splitHighlights", () => {
  it("returns nothing for an empty snippet", () => {
    expect(splitHighlights("")).toEqual([]);
  });

  it("returns one plain run when nothing matched", () => {
    expect(splitHighlights("no matches here")).toEqual([
      { text: "no matches here", match: false },
    ]);
  });

  it("splits a single match out of its surroundings", () => {
    expect(splitHighlights(`the ${S}roadmap${E} is firm`)).toEqual([
      { text: "the ", match: false },
      { text: "roadmap", match: true },
      { text: " is firm", match: false },
    ]);
  });

  it("handles a match at either end", () => {
    expect(splitHighlights(`${S}first${E} then last`)).toEqual([
      { text: "first", match: true },
      { text: " then last", match: false },
    ]);
    expect(splitHighlights(`up to the ${S}end${E}`)).toEqual([
      { text: "up to the ", match: false },
      { text: "end", match: true },
    ]);
  });

  it("handles several matches", () => {
    expect(
      splitHighlights(`${S}a${E} and ${S}b${E} and c`),
    ).toEqual([
      { text: "a", match: true },
      { text: " and ", match: false },
      { text: "b", match: true },
      { text: " and c", match: false },
    ]);
  });

  // The sentinels are control characters, so a document containing them is
  // pathological rather than expected. It must still not produce something the
  // renderer chokes on: the worst outcome allowed is a misplaced highlight.
  it("survives an unterminated match", () => {
    expect(splitHighlights(`text ${S}runs to the end`)).toEqual([
      { text: "text ", match: false },
      { text: "runs to the end", match: true },
    ]);
  });

  it("survives a stray closing sentinel", () => {
    expect(splitHighlights(`stray ${E} marker`)).toEqual([
      { text: `stray ${E} marker`, match: false },
    ]);
  });
});
