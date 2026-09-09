// Whatever a coach pastes into the GameChanger box.
//
// Both real-world failures from Island's Fall 2026 signup are pinned here.
// Neither coach did anything wrong, which is the point: the box has to cope
// with what GameChanger and their mail provider actually hand them.

import { describe, expect, it } from "vitest";
import { normalizeGameChangerUrl } from "@/lib/gamechanger";

const CANON = "https://web.gc.com/teams/IO294CAWDufo";

describe("clean links", () => {
  it("keeps a plain team URL", () => {
    expect(normalizeGameChangerUrl("https://web.gc.com/teams/IO294CAWDufo")).toBe(CANON);
  });

  it("strips GameChanger's own tracking query", () => {
    expect(
      normalizeGameChangerUrl(
        "https://web.gc.com/teams/IO294CAWDufo?pid=Copy&c=team_share_link_hero_ui_control",
      ),
    ).toBe(CANON);
  });

  it("strips a trailing /live", () => {
    expect(normalizeGameChangerUrl("https://web.gc.com/teams/IO294CAWDufo/live?pid=SMS")).toBe(
      CANON,
    );
  });

  it("accepts http and upgrades it", () => {
    expect(normalizeGameChangerUrl("http://web.gc.com/teams/IO294CAWDufo")).toBe(CANON);
  });

  it("accepts a missing scheme", () => {
    expect(normalizeGameChangerUrl("web.gc.com/teams/IO294CAWDufo")).toBe(CANON);
  });

  it("accepts gc.com without the web subdomain", () => {
    expect(normalizeGameChangerUrl("https://gc.com/teams/IO294CAWDufo")).toBe(CANON);
  });
});

describe("Copiague Youth Leagues: a bare team id", () => {
  // What GameChanger's own screen shows, so coaches paste it.
  it("builds a URL from the id alone", () => {
    expect(normalizeGameChangerUrl("0y6pOzgPiAVr")).toBe(
      "https://web.gc.com/teams/0y6pOzgPiAVr",
    );
  });

  it("does not treat an ordinary word as an id", () => {
    expect(normalizeGameChangerUrl("none")).toBeNull();
    expect(normalizeGameChangerUrl("notapplicable")).toBeNull();
  });

  it("does not treat an email as an id", () => {
    expect(normalizeGameChangerUrl("coach@example.com")).toBeNull();
  });

  it("does not treat a phone number as an id", () => {
    expect(normalizeGameChangerUrl("5164736119")).toBeNull();
  });
});

describe("LI Heat 12U: a link their mail provider rewrote", () => {
  const PROOFPOINT =
    "https://urldefense.com/v3/__http://web.gc.com/teams/XL6Et3OLUThu/live?pid=Email&c=team_share_link_hero_ui_control__;!!P4SdNyxKAPE!GkJew82sZJMZRTuubXrwmN4uiYJVQzVMoA5EQUTKIq8IV7NAfWI_6hgduKQH7dFl9aymM5GcRySCnTQ17CrFDCg0$";

  it("unwraps Proofpoint v3", () => {
    expect(normalizeGameChangerUrl(PROOFPOINT)).toBe(
      "https://web.gc.com/teams/XL6Et3OLUThu",
    );
  });

  it("unwraps Outlook Safe Links", () => {
    const safe =
      "https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fweb.gc.com%2Fteams%2FIO294CAWDufo&data=05%7C01";
    expect(normalizeGameChangerUrl(safe)).toBe(CANON);
  });

  it("refuses a wrapper around a NON-GameChanger site", () => {
    const evil = "https://urldefense.com/v3/__http://example.com/teams/IO294CAWDufo__;!!x$";
    expect(normalizeGameChangerUrl(evil)).toBeNull();
  });
});

describe("what must never be stored", () => {
  it("rejects another site entirely", () => {
    expect(normalizeGameChangerUrl("https://example.com/teams/IO294CAWDufo")).toBeNull();
  });

  it("rejects a lookalike host", () => {
    expect(normalizeGameChangerUrl("https://web.gc.com.evil.test/teams/IO294CAWDufo")).toBeNull();
  });

  it("rejects a javascript: URL", () => {
    expect(normalizeGameChangerUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects a gc.com page that is not a team", () => {
    expect(normalizeGameChangerUrl("https://web.gc.com/account/settings")).toBeNull();
  });

  it("rejects empty and non-strings", () => {
    expect(normalizeGameChangerUrl("")).toBeNull();
    expect(normalizeGameChangerUrl("   ")).toBeNull();
    expect(normalizeGameChangerUrl(null)).toBeNull();
    expect(normalizeGameChangerUrl(42)).toBeNull();
  });
});
