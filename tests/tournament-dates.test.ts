// The rule that decides whether a tournament still shows as enterable.
//
// Both the home page strip and /tournaments read this, so a mistake here is
// either a finished event still taking entries or a live one buried under
// "Finished this season". Pure, so no emulator.

import { describe, it, expect } from "vitest";
import { isTournamentPast, asTournamentDate } from "@/lib/tournament-dates";

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("isTournamentPast", () => {
  it("a multi-day event is NOT past on its final morning", () => {
    // The Sunday of a Saturday-to-Sunday event, which is exactly when someone
    // checks the site to find out where they are playing.
    expect(
      isTournamentPast({ start: "2026-09-12", end: "2026-09-13" }, at("2026-09-13")),
    ).toBe(false);
  });

  it("becomes past the day after it ends", () => {
    expect(
      isTournamentPast({ start: "2026-09-12", end: "2026-09-13" }, at("2026-09-14")),
    ).toBe(true);
  });

  it("a single-day event uses its start", () => {
    expect(isTournamentPast({ start: "2026-09-12" }, at("2026-09-12"))).toBe(false);
    expect(isTournamentPast({ start: "2026-09-12" }, at("2026-09-13"))).toBe(true);
  });

  it("an undated entry is NEVER past", () => {
    // Burying a tournament people can still enter is far worse than leaving a
    // finished one on top, so anything we cannot date stays visible.
    expect(isTournamentPast({}, at("2030-01-01"))).toBe(false);
    expect(isTournamentPast({ start: "", end: "" }, at("2030-01-01"))).toBe(false);
    expect(isTournamentPast({ start: null, end: null }, at("2030-01-01"))).toBe(false);
  });

  it("end wins over start", () => {
    expect(
      isTournamentPast({ start: "2026-09-01", end: "2026-12-01" }, at("2026-10-01")),
    ).toBe(false);
  });

  it("does not slip a day in a negative-offset timezone", () => {
    // A date-only string parses as UTC midnight, which is the previous evening
    // on Long Island. Parsing at noon keeps the instant inside the day.
    const d = asTournamentDate("2026-09-13");
    expect(d.toISOString()).toBe("2026-09-13T12:00:00.000Z");
    expect(
      d.toLocaleDateString("en-US", { timeZone: "America/New_York", day: "numeric" }),
    ).toBe("13");
  });

  it("Island's real slate splits correctly partway through the season", () => {
    const slate = [
      { name: "Labor Day Lash Out", start: "2026-09-05", end: "2026-09-06" },
      { name: "Never Forget", start: "2026-09-12", end: "2026-09-13" },
      { name: "Play for Rhiannon", start: "2026-09-12", end: "2026-09-13" },
    ];
    const on = at("2026-09-13");
    expect(slate.filter((e) => isTournamentPast(e, on)).map((e) => e.name)).toEqual([
      "Labor Day Lash Out",
    ]);
    expect(slate.filter((e) => !isTournamentPast(e, on)).length).toBe(2);
  });
});
