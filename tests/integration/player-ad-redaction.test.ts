// Player Ads PII contract.
//
// The public board at /leagues/{id}/player_ads is world-readable (firestore.rules).
// The submitted ad — poster's name, email, phone — lives in
// /form_submissions/player_ad, which has no rule and so falls to default-deny.
//
// The ONLY thing keeping contact details off a public, search-indexed page
// about 8U-18U players is that /api/admin-player-ads copies an explicit field
// allow-list instead of spreading the submission. This test pins that list.
//
// If someone "simplifies" the approve branch to `publicRef.set({...data})`,
// these fail. That is the entire point.

import { describe, it, expect } from "vitest";
// The REAL projection the approve branch calls, not a copy of it.
import { PUBLIC_AD_FIELDS, projectPublicAd as project } from "@/lib/player-ads";

const SUBMISSION = {
  posted_by: "player",
  contact_name: "Dana Example",
  email: "parent@example.com",
  phone: "631-555-0134",
  age_group: "12U",
  position: "Catcher",
  town: "Smithtown",
  team_name: "",
  message: "Strong defensive catcher looking for a 12U team for the fall.",
  agreed_to_terms: true,
  submitted_at: "2026-07-22T12:00:00.000Z",
  ip: "203.0.113.9",
  user_agent: "Mozilla/5.0",
};

describe("player ad public projection", () => {
  const pub = project(SUBMISSION);

  it("never publishes the poster's name, email or phone", () => {
    expect(pub).not.toHaveProperty("contact_name");
    expect(pub).not.toHaveProperty("email");
    expect(pub).not.toHaveProperty("phone");
  });

  it("never publishes request metadata", () => {
    expect(pub).not.toHaveProperty("ip");
    expect(pub).not.toHaveProperty("user_agent");
    expect(pub).not.toHaveProperty("agreed_to_terms");
  });

  it("does publish the fields the board actually renders", () => {
    expect(pub.posted_by).toBe("player");
    expect(pub.age_group).toBe("12U");
    expect(pub.position).toBe("Catcher");
    expect(pub.town).toBe("Smithtown");
    expect(pub.message).toContain("catcher");
  });

  it("drops empty values rather than writing blanks", () => {
    // team_name was "" on this player-side ad.
    expect(pub).not.toHaveProperty("team_name");
  });

  it("the allow-list itself contains no contact-ish field", () => {
    const banned = ["contact_name", "email", "phone", "ip", "user_agent"];
    for (const b of banned) {
      expect(PUBLIC_AD_FIELDS as readonly string[]).not.toContain(b);
    }
  });

  it("a full-spread projection would leak, proving the test has teeth", () => {
    const naive = { ...SUBMISSION };
    expect(naive).toHaveProperty("email");
    expect(Object.keys(naive).length).toBeGreaterThan(
      Object.keys(pub).length,
    );
  });
});
