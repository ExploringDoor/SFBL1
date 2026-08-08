import { describe, it, expect } from "vitest";
import {
  displayName,
  projectPublicClaim,
  normaliseClaim,
  openSlots,
} from "../lib/volunteer-shifts";

describe("displayName", () => {
  it("reduces a full name to first name + last initial", () => {
    expect(displayName("Sarah Mitchell")).toBe("Sarah M.");
    expect(displayName("  jo   ann  Baker ")).toBe("jo ann B.");
  });

  it("leaves a single-word name alone rather than inventing an initial", () => {
    expect(displayName("Sarah")).toBe("Sarah");
  });

  it("returns empty for empty input", () => {
    expect(displayName("")).toBe("");
    expect(displayName("   ")).toBe("");
  });
});

describe("projectPublicClaim", () => {
  const now = "2026-04-18T12:00:00.000Z";

  it("publishes only a display name and a timestamp", () => {
    const pub = projectPublicClaim(
      { name: "Sarah Mitchell", email: "sarah@example.com", phone: "717-555-0100" },
      now,
    );
    expect(pub).toEqual({ display_name: "Sarah M.", claimed_at: now });
  });

  it("cannot leak a contact field even when one is supplied", () => {
    const pub = projectPublicClaim(
      {
        name: "Sarah Mitchell",
        email: "sarah@example.com",
        phone: "717-555-0100",
        // Fields the form does not have today but might grow later.
        ...({ address: "12 Elm St", note: "call me" } as Record<string, unknown>),
      },
      now,
    );
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain("example.com");
    expect(serialized).not.toContain("555");
    expect(serialized).not.toContain("Elm");
    expect(Object.keys(pub!)).toEqual(["display_name", "claimed_at"]);
  });

  it("refuses a claim with no usable name", () => {
    expect(projectPublicClaim({ name: "  " }, now)).toBeNull();
  });
});

describe("normaliseClaim", () => {
  it("trims and bounds the private fields", () => {
    const c = normaliseClaim({
      name: "  Sarah Mitchell  ",
      email: " sarah@example.com ",
      phone: " 717-555-0100 ",
    });
    expect(c).toEqual({
      name: "Sarah Mitchell",
      email: "sarah@example.com",
      phone: "717-555-0100",
    });
  });

  it("caps absurdly long input rather than storing it", () => {
    const c = normaliseClaim({ name: "x".repeat(500) });
    expect(c!.name.length).toBe(80);
  });

  it("requires a name", () => {
    expect(normaliseClaim({ email: "a@b.com" })).toBeNull();
  });
});

describe("openSlots", () => {
  it("counts remaining places", () => {
    expect(openSlots({ slots: 3, claims: [] })).toBe(3);
    expect(
      openSlots({ slots: 3, claims: [{ display_name: "A", claimed_at: "" }] }),
    ).toBe(2);
  });

  it("never goes negative when a shift is shrunk after sign-ups", () => {
    expect(
      openSlots({
        slots: 1,
        claims: [
          { display_name: "A", claimed_at: "" },
          { display_name: "B", claimed_at: "" },
        ],
      }),
    ).toBe(0);
  });
});
