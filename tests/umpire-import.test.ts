// Importing an umpire roster the assignor already has.
//
// The bug this is built to avoid, hit on the AssignCrew side 2026-09-08: a
// POSITIONAL importer reads a real export silently wrong. An Arbiter sheet
// leads with its own columns in its own order, so the last name lands in the
// first name, the phone lands in the level, and the header row is saved as a
// person. Nothing errors, which is the worst version of it.

import { describe, expect, it } from "vitest";
import {
  buildUmpirePreview,
  guessUmpireMapping,
  isImportableUmpire,
  looksBinarySpreadsheet,
  parseUmpireTable,
  splitDelimited,
  tidyName,
} from "@/lib/umpire-import";

/** Read a block the way the UI does: parse, guess, preview. */
function ingest(text: string, existing: Parameters<typeof buildUmpirePreview>[2] = []) {
  const t = parseUmpireTable(text);
  const map = guessUmpireMapping(t.headers, t.hadHeader);
  return { ...t, map, preview: buildUmpirePreview(t.rows, map, existing) };
}

describe("an Arbiter-shaped export", () => {
  const ARBITER = [
    "Official ID,Last Name,First Name,Email Address,Cell Phone,Rank,City",
    "10432,Kumo,Jim,jim@example.com,(516) 851-5638,Senior,Massapequa",
    "10433,Reilly,Tom,tom@example.com,516-555-0132,Junior,Levittown",
  ].join("\n");

  it("finds the columns wherever they sit", () => {
    const { map } = ingest(ARBITER);
    expect(map.first).toBe("first name");
    expect(map.last).toBe("last name");
    expect(map.email).toBe("email address");
    expect(map.phone).toBe("cell phone");
    expect(map.level).toBe("rank");
  });

  it("builds the name first-then-last, not last-then-first", () => {
    expect(ingest(ARBITER).preview[0]!.name).toBe("Jim Kumo");
  });

  it("keeps the phone", () => {
    expect(ingest(ARBITER).preview[0]!.phone).toBe("(516) 851-5638");
  });

  it("does not import the header row as a person", () => {
    const { preview } = ingest(ARBITER);
    expect(preview).toHaveLength(2);
    expect(preview.map((p) => p.name)).toEqual(["Jim Kumo", "Tom Reilly"]);
  });
});

describe("a combined name column", () => {
  it('turns "Doe, Jane" into "Jane Doe"', () => {
    expect(tidyName("Doe, Jane")).toBe("Jane Doe");
  });

  it("leaves an already-natural name alone", () => {
    expect(tidyName("Jane Doe")).toBe("Jane Doe");
  });

  it("survives a single word", () => {
    expect(tidyName("Cher")).toBe("Cher");
  });

  it("reads a whole file with one Name column", () => {
    const { preview } = ingest(['Name,Email,Phone', '"Kumo, Jim",jim@example.com,5168515638'].join("\n"));
    expect(preview[0]!.name).toBe("Jim Kumo");
    // The quoted comma must not shift every later column by one.
    expect(preview[0]!.email).toBe("jim@example.com");
  });
});

describe("splitDelimited", () => {
  it("respects quoted commas", () => {
    expect(splitDelimited('"Kumo, Jim",jim@example.com', ",")).toEqual([
      "Kumo, Jim",
      "jim@example.com",
    ]);
  });

  it('understands the "" escape', () => {
    expect(splitDelimited('"He said ""hi""",x', ",")).toEqual(['He said "hi"', "x"]);
  });

  it("handles tabs from an Excel paste", () => {
    expect(splitDelimited("Jane\tjane@example.com", "\t")).toEqual(["Jane", "jane@example.com"]);
  });
});

describe("a headerless paste", () => {
  const PASTED = "Jane Doe, jane@example.com, 516-555-0132, Senior\nTom Reilly, tom@example.com";

  it("does not eat the first row as a header", () => {
    const { preview, hadHeader } = ingest(PASTED);
    expect(hadHeader).toBe(false);
    expect(preview).toHaveLength(2);
  });

  it("reads it in the order the add form asks for", () => {
    expect(ingest(PASTED).preview[0]).toMatchObject({
      name: "Jane Doe",
      email: "jane@example.com",
      phone: "516-555-0132",
      level: "Senior",
    });
  });

  it("reads tab-separated cells pasted out of Excel", () => {
    const { preview } = ingest("Name\tEmail\nJane Doe\tjane@example.com");
    expect(preview[0]).toMatchObject({ name: "Jane Doe", email: "jane@example.com" });
  });
});

describe("duplicates are skipped, not duplicated", () => {
  const existing = [{ name: "Jim Kumo", email: "jim@example.com" }];

  it("skips a match on email", () => {
    const { preview } = ingest(
      ["Name,Email", "James Kumo,JIM@example.com"].join("\n"),
      existing,
    );
    expect(preview[0]!.skip).toBe(true);
    expect(isImportableUmpire(preview[0]!)).toBe(false);
  });

  it("skips a match on name when there is no email", () => {
    const { preview } = ingest(["Name", "Jim Kumo"].join("\n"), existing);
    expect(preview[0]!.skip).toBe(true);
  });

  it("skips a repeat inside the same file", () => {
    const { preview } = ingest(
      ["Name,Email", "Tom Reilly,tom@example.com", "Tom Reilly,tom@example.com"].join("\n"),
    );
    expect(preview[0]!.skip).toBe(false);
    expect(preview[1]!.skip).toBe(true);
  });

  it("still imports everyone else", () => {
    const { preview } = ingest(
      ["Name,Email", "Jim Kumo,jim@example.com", "Tom Reilly,tom@example.com"].join("\n"),
      existing,
    );
    expect(preview.filter(isImportableUmpire).map((p) => p.name)).toEqual(["Tom Reilly"]);
  });
});

describe("bad values are flagged, not saved", () => {
  it("drops a junk email", () => {
    const { preview } = ingest(["Name,Email", "Jane Doe,none"].join("\n"));
    expect(preview[0]!.email).toBe("");
    expect(preview[0]!.notes.join(" ")).toContain("not an email");
  });

  it("drops a junk phone", () => {
    expect(ingest(["Name,Phone", "Jane Doe,n/a"].join("\n")).preview[0]!.phone).toBe("");
  });

  it("blocks a row with no name", () => {
    const { preview } = ingest(["Name,Email", ",ghost@example.com"].join("\n"));
    expect(preview[0]!.problems).toContain("no name");
    expect(isImportableUmpire(preview[0]!)).toBe(false);
  });

  it("an umpire with no email is still importable", () => {
    const { preview } = ingest(["Name,Phone", "Jane Doe,516-555-0132"].join("\n"));
    expect(isImportableUmpire(preview[0]!)).toBe(true);
  });
});

describe("an actual .xlsx", () => {
  it("is recognised as binary", () => {
    expect(looksBinarySpreadsheet("PK\x03\x04\x14\x00")).toBe(true);
    expect(looksBinarySpreadsheet("Name,Email\nJane,j@e.com")).toBe(false);
  });
});

describe("empty and odd input", () => {
  it("returns nothing for an empty paste", () => {
    expect(ingest("").preview).toEqual([]);
  });

  it("ignores blank lines", () => {
    expect(ingest("Name,Email\n\nJane Doe,j@e.com\n\n").preview).toHaveLength(1);
  });

  it("handles a row with fewer cells than the header", () => {
    const { preview } = ingest(["Name,Email,Phone,Level", "Jane Doe"].join("\n"));
    expect(preview[0]).toMatchObject({ name: "Jane Doe", email: "", phone: "", level: "" });
  });
});
