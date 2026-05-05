// Tests for lib/notifications/categories.ts.
//
// Categories are the source of truth for the 11 push types. Every
// trigger site uses a string from ALL_CATEGORIES; the prefs UI reads
// CATEGORY_LABELS / CATEGORY_SUBLABELS / CATEGORY_DISPLAY_ORDER. If
// any of these get out of sync, the prefs UI breaks or pushes go
// uncategorized. We lock down:
//   1. ALL_CATEGORIES has the 11 expected names (DVSL parity)
//   2. DEFAULT_CATEGORIES is the 9 opt-in defaults (the other 2
//      are auth-gated: captains_chat + admin)
//   3. Labels + sublabels exist for every category (no missing UI text)
//   4. Display order covers every category exactly once
//   5. isValidCategory accepts known + rejects unknown
//   6. Sets are consistent with arrays (ALL_CATEGORIES_SET)

import { describe, expect, it } from "vitest";
import {
  ALL_CATEGORIES,
  ALL_CATEGORIES_SET,
  DEFAULT_CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_SUBLABELS,
  CATEGORY_DISPLAY_ORDER,
  isValidCategory,
} from "@/lib/notifications/categories";

describe("ALL_CATEGORIES", () => {
  it("has exactly the 11 DVSL-parity categories", () => {
    // Names locked — DON'T change without coordinating with DVSL spec
    // and notifications.html label markup.
    expect([...ALL_CATEGORIES]).toEqual([
      "scores",
      "rainouts",
      "schedule",
      "playoffs",
      "team_chat",
      "captains_chat",
      "announcements",
      "photos",
      "admin",
      "live",
      "pregame",
    ]);
  });

  it("has no duplicates", () => {
    expect(new Set(ALL_CATEGORIES).size).toBe(ALL_CATEGORIES.length);
  });

  it("ALL_CATEGORIES_SET is consistent with the array", () => {
    expect(ALL_CATEGORIES_SET.size).toBe(ALL_CATEGORIES.length);
    for (const cat of ALL_CATEGORIES) {
      expect(ALL_CATEGORIES_SET.has(cat)).toBe(true);
    }
  });
});

describe("DEFAULT_CATEGORIES", () => {
  it("has 9 categories (DVSL: 11 total minus 2 auth-gated)", () => {
    expect(DEFAULT_CATEGORIES).toHaveLength(9);
  });

  it("matches DVSL register-time defaults exactly", () => {
    // notifications.html:1054 — same 9, same order.
    expect(DEFAULT_CATEGORIES).toEqual([
      "scores",
      "rainouts",
      "schedule",
      "playoffs",
      "team_chat",
      "announcements",
      "live",
      "pregame",
      "photos",
    ]);
  });

  it("excludes captains_chat (auth-gated, opt-in for captains)", () => {
    expect(DEFAULT_CATEGORIES).not.toContain("captains_chat");
  });

  it("excludes admin (auth-gated, hidden from non-admins)", () => {
    expect(DEFAULT_CATEGORIES).not.toContain("admin");
  });

  it("every default IS a valid category", () => {
    for (const cat of DEFAULT_CATEGORIES) {
      expect(ALL_CATEGORIES_SET.has(cat)).toBe(true);
    }
  });
});

describe("CATEGORY_LABELS + SUBLABELS — UI integrity", () => {
  it("has a label for every category (no missing strings in prefs UI)", () => {
    for (const cat of ALL_CATEGORIES) {
      expect(CATEGORY_LABELS[cat], `missing label for ${cat}`).toBeTruthy();
      expect(typeof CATEGORY_LABELS[cat]).toBe("string");
    }
  });

  it("has a sublabel for every category", () => {
    for (const cat of ALL_CATEGORIES) {
      expect(
        CATEGORY_SUBLABELS[cat],
        `missing sublabel for ${cat}`,
      ).toBeTruthy();
    }
  });

  it("labels are user-facing (not internal slugs)", () => {
    // Any label still equal to its key would be a missed translation.
    for (const cat of ALL_CATEGORIES) {
      expect(CATEGORY_LABELS[cat]).not.toBe(cat);
    }
  });
});

describe("CATEGORY_DISPLAY_ORDER", () => {
  it("covers every category exactly once", () => {
    expect(CATEGORY_DISPLAY_ORDER).toHaveLength(ALL_CATEGORIES.length);
    expect(new Set(CATEGORY_DISPLAY_ORDER).size).toBe(
      CATEGORY_DISPLAY_ORDER.length,
    );
    for (const cat of ALL_CATEGORIES) {
      expect(CATEGORY_DISPLAY_ORDER).toContain(cat);
    }
  });

  it("starts with scores (DVSL spec §4 ordering)", () => {
    expect(CATEGORY_DISPLAY_ORDER[0]).toBe("scores");
  });

  it("admin is last in display order (auth-gated, shown only to admins)", () => {
    expect(CATEGORY_DISPLAY_ORDER[CATEGORY_DISPLAY_ORDER.length - 1]).toBe(
      "admin",
    );
  });
});

describe("isValidCategory", () => {
  it("accepts every known category", () => {
    for (const cat of ALL_CATEGORIES) {
      expect(isValidCategory(cat)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isValidCategory("not_a_category")).toBe(false);
    expect(isValidCategory("SCORES")).toBe(false); // case-sensitive
    expect(isValidCategory("")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidCategory(null)).toBe(false);
    expect(isValidCategory(undefined)).toBe(false);
    expect(isValidCategory(0)).toBe(false);
    expect(isValidCategory(["scores"])).toBe(false);
    expect(isValidCategory({ category: "scores" })).toBe(false);
  });

  it("type-narrows correctly (compiler check)", () => {
    const x: unknown = "scores";
    if (isValidCategory(x)) {
      // x is now NotificationCategory; can be assigned without coercion.
      const cat: typeof ALL_CATEGORIES[number] = x;
      expect(cat).toBe("scores");
    }
  });
});
