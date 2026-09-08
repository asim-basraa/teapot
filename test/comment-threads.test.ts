import { describe, it, expect } from "vitest";
import { buildThreads, type Comment } from "../lib/comment-threads";

let n = 0;
function comment(over: Partial<Comment> = {}): Comment {
  n += 1;
  return {
    id: `c${n}`,
    parent_id: null,
    author_id: "u1",
    author_email: "a@example.com",
    body: `body ${n}`,
    created_at: new Date(1700000000000 + n * 1000).toISOString(),
    deleted: false,
    ...over,
  };
}

describe("buildThreads", () => {
  it("returns nothing for an empty conversation", () => {
    expect(buildThreads([])).toEqual([]);
  });

  it("keeps top-level comments in the order given", () => {
    const a = comment();
    const b = comment();
    expect(buildThreads([a, b]).map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it("nests a reply under the comment it answers", () => {
    const parent = comment();
    const reply = comment({ parent_id: parent.id });

    const threads = buildThreads([parent, reply]);
    expect(threads).toHaveLength(1);
    expect(threads[0].replies.map((r) => r.id)).toEqual([reply.id]);
  });

  // A withdrawn comment with nothing hanging off it leaves no trace: there is
  // nothing for a tombstone to explain.
  it("drops a withdrawn comment that has no replies", () => {
    const gone = comment({ deleted: true });
    const kept = comment();
    expect(buildThreads([gone, kept]).map((t) => t.id)).toEqual([kept.id]);
  });

  // But one that does keeps its place, or the answers underneath it become
  // replies to nothing.
  it("keeps a withdrawn comment that still has replies", () => {
    const gone = comment({ deleted: true });
    const reply = comment({ parent_id: gone.id });

    const threads = buildThreads([gone, reply]);
    expect(threads).toHaveLength(1);
    expect(threads[0].deleted).toBe(true);
    expect(threads[0].replies.map((r) => r.id)).toEqual([reply.id]);
  });

  it("drops withdrawn replies", () => {
    const parent = comment();
    const gone = comment({ parent_id: parent.id, deleted: true });
    const kept = comment({ parent_id: parent.id });

    const threads = buildThreads([parent, gone, kept]);
    expect(threads[0].replies.map((r) => r.id)).toEqual([kept.id]);
  });

  // A parent whose every reply was withdrawn has nothing left to explain
  // either, so the tombstone goes too.
  it("drops a withdrawn comment whose replies were all withdrawn", () => {
    const gone = comment({ deleted: true });
    const goneReply = comment({ parent_id: gone.id, deleted: true });
    expect(buildThreads([gone, goneReply])).toEqual([]);
  });

  // The whole conversation is always fetched together, so a reply whose parent
  // is absent cannot arise. Pinned here so the behaviour is a decision rather
  // than an accident: it is dropped rather than promoted to the top level,
  // where it would read as a statement instead of an answer.
  it("drops a reply whose parent is not in the list", () => {
    const orphan = comment({ parent_id: "missing" });
    expect(buildThreads([orphan])).toEqual([]);
  });
});
