import { describe, expect, it } from "vitest";
import { person } from "@/lib/people";

describe("person", () => {
  it("shortens a two-part address to the two initials", () => {
    const p = person("faryal.awais@maqsoodlabs.com");
    expect(p.initials).toBe("FA");
    expect(p.label).toBe("Faryal Awais");
    expect(p.full).toBe("faryal.awais@maqsoodlabs.com");
  });

  it("gives a one-word address two letters, so every badge is one width", () => {
    expect(person("asim@maqsoodlabs.com").initials).toBe("AS");
  });

  it("reads the ends of a longer name, not the middle", () => {
    expect(person("mary.jane.watson@example.com").initials).toBe("MW");
    expect(person("mary.jane.watson@example.com").label).toBe(
      "Mary Jane Watson",
    );
  });

  it("ignores the routing tag and the domain", () => {
    expect(person("noor.zainab+jokes@maqsoodlabs.com").initials).toBe("NZ");
    expect(person("noor.zainab+jokes@maqsoodlabs.com").label).toBe(
      "Noor Zainab",
    );
  });

  it("treats separators the same however they are written", () => {
    expect(person("inbox-owner-1757@maqsoodlabs.com").initials).toBe("IO");
    expect(person("first_last@example.com").initials).toBe("FL");
  });

  it("leaves a label that is not an address alone", () => {
    for (const label of ["Post-it", "Anonymous"]) {
      const p = person(label);
      expect(p.initials).toBeNull();
      expect(p.label).toBe(label);
    }
  });

  it("shows an address with no letters in it whole rather than as a blank", () => {
    const p = person("12345@example.com");
    expect(p.initials).toBeNull();
    expect(p.label).toBe("12345@example.com");
  });
});
