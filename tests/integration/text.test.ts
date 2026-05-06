// Tests for lib/text.ts → cleanName.
//
// Found 2026-05-05 by the DVSL Claude peer review session. DVSL caught
// 70+ NBSP-split players in production: "John Smith" (with NBSP)
// became a different doc id than "John Smith" (regular space), stats
// split across both, captains saw themselves as a separate unstats'd
// player.
//
// `String.prototype.trim()` only handles ASCII whitespace. Names
// pasted from Word, PDFs, copy-paste-from-the-web routinely have
// non-breaking spaces and friends. cleanName uses `\p{Z}` (Unicode
// separator class) to catch them all.

import { describe, expect, it } from "vitest";
import { cleanName } from "@/lib/text";

describe("cleanName — basic shapes", () => {
  it("returns '' for null / undefined / non-string", () => {
    expect(cleanName(null)).toBe("");
    expect(cleanName(undefined)).toBe("");
    expect(cleanName(0)).toBe("0"); // numbers stringify; that's fine, input shouldn't be number
    expect(cleanName({})).toBe("[object Object]"); // again stringifies; input shouldn't be obj
  });

  it("returns '' for empty string", () => {
    expect(cleanName("")).toBe("");
  });

  it("preserves a clean name unchanged", () => {
    expect(cleanName("John Smith")).toBe("John Smith");
  });

  it("trims leading + trailing whitespace", () => {
    expect(cleanName("  John Smith  ")).toBe("John Smith");
  });

  it("collapses runs of internal whitespace to a single space", () => {
    expect(cleanName("Aaron     Judge")).toBe("Aaron Judge");
    expect(cleanName("A\t\tB")).toBe("A B");
    expect(cleanName("A\n\nB")).toBe("A B");
  });
});

describe("cleanName — Unicode separators (the bug DVSL caught)", () => {
  it("normalizes non-breaking space (U+00A0) to regular space", () => {
    // The big one. Word, Outlook, copy-paste from web pages all sneak
    // in NBSP between words.
    const nbsp = "John Smith";
    expect(cleanName(nbsp)).toBe("John Smith");
  });

  it("normalizes narrow no-break space (U+202F)", () => {
    expect(cleanName("Mr. Smith")).toBe("Mr. Smith");
  });

  it("normalizes ideographic space (U+3000)", () => {
    expect(cleanName("X　Y")).toBe("X Y");
  });

  it("normalizes figure space (U+2007) + en quad (U+2000) + others", () => {
    expect(cleanName("A B")).toBe("A B");
    expect(cleanName("A B")).toBe("A B");
    expect(cleanName("A B")).toBe("A B"); // thin space
    expect(cleanName("A B")).toBe("A B"); // medium math space
  });

  it("collapses NBSP-then-regular-space to single space", () => {
    // `John[NBSP][space]Smith` — both characters get normalized to
    // space, then collapsed.
    expect(cleanName("John  Smith")).toBe("John Smith");
  });

  it("trims leading + trailing NBSP", () => {
    expect(cleanName(" John ")).toBe("John");
  });

  it("the whole DVSL nightmare in one input", () => {
    // Word-pasted name with NBSPs leading, between, trailing, plus
    // multiple varieties.
    const dirty = " 　  John   Smith   ";
    expect(cleanName(dirty)).toBe("John Smith");
  });
});

describe("cleanName — idempotency + roundtrip safety", () => {
  it("running twice produces the same result as once (idempotent)", () => {
    const inputs = [
      "John Smith",
      "  John  Smith  ",
      "John Smith",
      " John　Smith ",
    ];
    for (const input of inputs) {
      const once = cleanName(input);
      const twice = cleanName(once);
      expect(twice).toBe(once);
    }
  });

  it("two inputs that LOOK the same become the same string", () => {
    // The whole point — these two strings render visually identical
    // but are distinct without normalization. After cleanName they're
    // equal, so they slug to the same player id.
    const withNbsp = "John Smith";
    const withSpace = "John Smith";
    expect(cleanName(withNbsp)).toBe(cleanName(withSpace));
  });

  it("does NOT collapse different names to the same value (no false-positive merging)", () => {
    expect(cleanName("John Smith")).not.toBe(cleanName("Jon Smith"));
    expect(cleanName("Aaron Judge")).not.toBe(cleanName("Aaron Judges"));
  });
});
