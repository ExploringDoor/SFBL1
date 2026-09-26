import { describe, it, expect } from "vitest";
import { buildReconcileMaps, resolveExistingGameId, arbiterGameId } from "@/lib/arbiter";

// The two ingestion paths mint different doc ids for the same game (iCal keys on
// the feed UID, CSV on the game number). resolveExistingGameId is what lets an
// incoming row land on the game the OTHER path already created.
const EXISTING = [
  // iCal-created: has a UID-based id and NO game number.
  { id: "arb-uidabc", gameNumber: null, date: "2026-04-13", time: "18:00", awayTeamId: "ephrata", homeTeamId: "hempfield" },
  // CSV-created: keyed on game number.
  { id: "arb-372", gameNumber: "372", date: "2026-04-14", time: "17:30", awayTeamId: "warwick", homeTeamId: "manheim" },
  // Archive game from a PRIOR season that reused number 45 with different teams.
  { id: "arb-45old", gameNumber: "45", date: "2025-05-01", time: "10:00", awayTeamId: "lancaster", homeTeamId: "donegal" },
  // A doubleheader: same date + teams, two start times.
  { id: "arb-dh1", gameNumber: null, date: "2026-05-01", time: "10:00", awayTeamId: "reds", homeTeamId: "blues" },
  { id: "arb-dh2", gameNumber: null, date: "2026-05-01", time: "13:00", awayTeamId: "reds", homeTeamId: "blues" },
];

const maps = buildReconcileMaps(EXISTING);

describe("resolveExistingGameId", () => {
  it("matches by game number when the teams also agree", () => {
    expect(
      resolveExistingGameId(
        { gameNumber: "372", date: "2026-04-14", time: "17:30", awayTeamId: "warwick", homeTeamId: "manheim" },
        maps,
      ),
    ).toBe("arb-372");
  });

  it("reconciles even when the two sources disagree on home/away (orientation-insensitive)", () => {
    // Existing arb-uidabc is ephrata(away)/hempfield(home). A row with the teams
    // SWAPPED (as the iCal SUMMARY heuristic might read them) must still land on
    // the same doc, not mint a duplicate with swapped sides.
    expect(
      resolveExistingGameId(
        { gameNumber: null, date: "2026-04-13", time: "18:00", awayTeamId: "hempfield", homeTeamId: "ephrata" },
        maps,
      ),
    ).toBe("arb-uidabc");
  });

  it("matches an iCal-created (no game number) doc by the natural key", () => {
    // An officials CSV row for a game the feed created: no matching id scheme,
    // must still land on arb-uidabc via date+teams.
    expect(
      resolveExistingGameId(
        { gameNumber: "9001", date: "2026-04-13", time: "18:00", awayTeamId: "ephrata", homeTeamId: "hempfield" },
        maps,
      ),
    ).toBe("arb-uidabc");
  });

  it("does NOT trust a game-number match when the teams differ (reused number)", () => {
    // Current-season #45 is reds/blues; the archive doc for #45 is lancaster/donegal.
    // Must ignore the number match and reconcile by natural key (the doubleheader).
    const id = resolveExistingGameId(
      { gameNumber: "45", date: "2026-05-01", time: "10:00", awayTeamId: "reds", homeTeamId: "blues" },
      maps,
    );
    expect(id).toBe("arb-dh1");
    expect(id).not.toBe("arb-45old");
  });

  it("disambiguates a doubleheader by start time", () => {
    expect(
      resolveExistingGameId(
        { gameNumber: null, date: "2026-05-01", time: "13:00", awayTeamId: "reds", homeTeamId: "blues" },
        maps,
      ),
    ).toBe("arb-dh2");
  });

  it("falls back to the first candidate (never a fresh id) when no time matches a doubleheader", () => {
    expect(
      resolveExistingGameId(
        { gameNumber: null, date: "2026-05-01", time: "19:00", awayTeamId: "reds", homeTeamId: "blues" },
        maps,
      ),
    ).toBe("arb-dh1");
  });

  it("returns null when nothing matches, so the caller mints a fresh id", () => {
    expect(
      resolveExistingGameId(
        { gameNumber: null, date: "2026-09-09", time: "12:00", awayTeamId: "octorara", homeTeamId: "solanco" },
        maps,
      ),
    ).toBeNull();
  });

  it("returns null (never the archived doc) when a reused number's teams differ and no natural match exists", () => {
    // Number 45 exists on arb-45old (lancaster/donegal). This row reuses #45 for a
    // different matchup with no existing game on that date → must be null so the
    // caller mints a fresh natural-key id instead of overwriting arb-45old.
    const id = resolveExistingGameId(
      { gameNumber: "45", date: "2026-09-09", time: "12:00", awayTeamId: "octorara", homeTeamId: "solanco" },
      maps,
    );
    expect(id).toBeNull();
  });
});

describe("arbiterGameId includes time so a doubleheader gets distinct ids", () => {
  it("differs by start time when there is no game number", () => {
    const a = arbiterGameId({ gameNumber: null, date: "2026-05-01", time: "10:00", awayTeamId: "reds", homeTeamId: "blues" });
    const b = arbiterGameId({ gameNumber: null, date: "2026-05-01", time: "13:00", awayTeamId: "reds", homeTeamId: "blues" });
    expect(a).not.toBe(b);
  });

  it("keys on the game number when present, regardless of time", () => {
    expect(arbiterGameId({ gameNumber: "372", date: "2026-04-14", time: "17:30", awayTeamId: "a", homeTeamId: "b" })).toBe("arb-372");
  });
});
