import { describe, it, expect, beforeEach } from "vitest";
import {
  allowToken,
  failuresSpent,
  recordFailure,
  reset,
  VALID_LIMIT,
  FAILURE_LIMIT,
} from "../lib/mcp/rate-limit";

describe("the MCP throttle", () => {
  beforeEach(() => reset());

  it("does not count a request that succeeded against the failure budget", () => {
    // The bug this guards: the failure bucket was incremented on every
    // request, so twenty calls a minute from one address were refused however
    // good the token was. A client filing a folder of documents does more than
    // that in a few seconds.
    for (let i = 0; i < FAILURE_LIMIT * 5; i += 1) {
      expect(failuresSpent("198.51.100.7")).toBe(false);
    }
  });

  it("spends the budget on refusals, and only on refusals", () => {
    for (let i = 0; i < FAILURE_LIMIT - 1; i += 1) {
      recordFailure("198.51.100.7");
      expect(failuresSpent("198.51.100.7")).toBe(false);
    }

    recordFailure("198.51.100.7");
    expect(failuresSpent("198.51.100.7")).toBe(true);
  });

  it("keeps one address's guessing away from another's", () => {
    for (let i = 0; i < FAILURE_LIMIT; i += 1) recordFailure("198.51.100.7");

    expect(failuresSpent("198.51.100.7")).toBe(true);
    expect(failuresSpent("203.0.113.9")).toBe(false);
  });

  it("still throttles a valid token, generously", () => {
    for (let i = 0; i < VALID_LIMIT; i += 1) {
      expect(allowToken("token-1")).toBe(true);
    }
    expect(allowToken("token-1")).toBe(false);

    // Per token, so one noisy client does not throttle another.
    expect(allowToken("token-2")).toBe(true);
  });
});
