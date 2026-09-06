// Taking the schedule down, and every way that must NOT happen by accident.
//
// Mike asked for a switch he can flip while moving games around. The dangerous
// direction is not "failed to hide" but "hid when nobody asked": a league whose
// schedule vanishes because a field went missing looks broken to every coach,
// and nobody would think to look at a visibility flag they have never used.

import { describe, expect, it } from "vitest";
import { DEFAULT_HIDDEN_NOTE, readVisibility } from "@/lib/schedule-visibility";

describe("only a deliberate press hides the schedule", () => {
  it("hides on an explicit boolean true", () => {
    expect(readVisibility({ hidden: true })).toEqual({
      hidden: true,
      note: "",
      releaseNote: "",
    });
  });

  it("stays visible for a league that has never touched it", () => {
    expect(readVisibility(undefined).hidden).toBe(false);
    expect(readVisibility(null).hidden).toBe(false);
    expect(readVisibility({}).hidden).toBe(false);
  });

  it("stays visible for anything that is not exactly true", () => {
    for (const v of ["true", 1, "yes", [], {}, "1"]) {
      expect(readVisibility({ hidden: v }).hidden).toBe(false);
    }
  });

  it("stays visible when explicitly shown", () => {
    expect(readVisibility({ hidden: false }).hidden).toBe(false);
  });

  it("survives a document of the wrong shape entirely", () => {
    expect(readVisibility("hidden").hidden).toBe(false);
    expect(readVisibility(42).hidden).toBe(false);
  });
});

describe("the standing release note", () => {
  it("is carried through, and is independent of hiding", () => {
    const v = readVisibility({ release_note: "Schedules go up Tuesday night." });
    expect(v.releaseNote).toBe("Schedules go up Tuesday night.");
    // It shows whether or not the schedule is hidden, so it must not imply one.
    expect(v.hidden).toBe(false);
  });

  it("is trimmed, since it renders as a standing line", () => {
    expect(readVisibility({ release_note: "  Tuesday night.  " }).releaseNote).toBe(
      "Tuesday night.",
    );
  });

  it("is empty when unset or the wrong type, so nothing odd renders", () => {
    expect(readVisibility({}).releaseNote).toBe("");
    expect(readVisibility({ release_note: 7 }).releaseNote).toBe("");
    expect(readVisibility(null).releaseNote).toBe("");
  });
});

describe("the hidden note", () => {
  it("is carried through when set", () => {
    expect(readVisibility({ hidden: true, note: "Back Friday" }).note).toBe(
      "Back Friday",
    );
  });

  it("is dropped when it is not a string, so nothing odd renders", () => {
    expect(readVisibility({ hidden: true, note: 12 }).note).toBe("");
  });

  it("has a default worth showing, rather than a bare coming soon", () => {
    // A league with no note still has to say something that reads like work in
    // progress, not like an abandoned site.
    expect(DEFAULT_HIDDEN_NOTE).toMatch(/updated/i);
  });
});
