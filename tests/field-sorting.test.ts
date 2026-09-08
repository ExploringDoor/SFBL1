// Fields come back alphabetically.
//
// Mike added "Fireman's Field, Lindenhurst" on 2026-09-08 and it went to the
// bottom of the list. The admin screen sorted its own copy, but the STORED
// order is what the public /fields page, the captain schedule tab and the
// field dropdown all render, and nothing sorted on the way in.

import { describe, expect, it } from "vitest";

/** The comparator used by the write path and the public read. */
const byName = (a: { name?: string }, b: { name?: string }) =>
  String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });

const sorted = (names: string[]) =>
  names.map((name) => ({ name })).sort(byName).map((f) => f.name);

describe("field ordering", () => {
  it("puts a newly added field in place instead of at the end", () => {
    expect(sorted(["Bellport Martha Avenue", "Zorn Park", "Fireman's Field"])).toEqual([
      "Bellport Martha Avenue",
      "Fireman's Field",
      "Zorn Park",
    ]);
  });

  it("orders numbered fields the way a person counts", () => {
    // A plain string sort puts Field 10 before Field 2.
    expect(sorted(["Field 10", "Field 2", "Field 1"])).toEqual([
      "Field 1",
      "Field 2",
      "Field 10",
    ]);
  });

  it("ignores case so a lowercase entry does not sink", () => {
    expect(sorted(["bellport", "Attack Field", "Copiague"])).toEqual([
      "Attack Field",
      "bellport",
      "Copiague",
    ]);
  });

  it("does not throw on a field with no name", () => {
    expect(() => [{ name: undefined }, { name: "A" }].sort(byName)).not.toThrow();
  });

  it("keeps an already-sorted list unchanged", () => {
    const l = ["Alpha", "Bravo", "Charlie"];
    expect(sorted(l)).toEqual(l);
  });

  it("sorts an apostrophe name where a reader expects it", () => {
    expect(sorted(["Zorn", "Fireman's Field Dirt", "Amity"])).toEqual([
      "Amity",
      "Fireman's Field Dirt",
      "Zorn",
    ]);
  });
});
