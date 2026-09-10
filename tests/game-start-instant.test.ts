import { describe, expect, it } from "vitest";
import { gameStartInstant } from "@/lib/format-time";
import { LEAGUE_TIME_ZONE, leagueTimeZone } from "@/lib/league-time";

// The calendar feed and the opening-day countdown turn a stored wall-clock
// into a real instant. ETBL (East Texas) is the first Central-time tenant,
// and before it the feed was an hour out for anyone not in Eastern: the
// instant was whatever machine ran the import thought 9:00 AM meant.

describe("gameStartInstant", () => {
  it("resolves the wall-clock time in the league's zone", () => {
    // September: CDT is UTC-5, EDT is UTC-4.
    expect(gameStartInstant("2026-09-12", "09:00", "America/Chicago")?.toISOString()).toBe(
      "2026-09-12T14:00:00.000Z",
    );
    expect(gameStartInstant("2026-09-12", "09:00", "America/New_York")?.toISOString()).toBe(
      "2026-09-12T13:00:00.000Z",
    );
  });

  it("trusts `time` over an instant the importer stamped on `date`", () => {
    // Provisioned on an Eastern laptop: 9:00 AM became 13:00Z. The game is
    // still at 9:00 AM in Texas.
    expect(
      gameStartInstant("2026-09-12T13:00:00.000Z", "09:00", "America/Chicago")?.toISOString(),
    ).toBe("2026-09-12T14:00:00.000Z");
  });

  it("keeps an offset-bearing date when there is no time at all (older docs)", () => {
    expect(gameStartInstant("2026-09-12T13:00:00.000Z", null, "America/Chicago")?.toISOString()).toBe(
      "2026-09-12T13:00:00.000Z",
    );
  });

  it("reads an embedded floating time when there is no time field", () => {
    expect(gameStandardEmbedded()).toBe("2026-09-12T23:00:00.000Z");
  });

  it("a bare day with no time is midnight in the zone", () => {
    expect(gameStartInstant("2026-09-12", "", "America/Chicago")?.toISOString()).toBe(
      "2026-09-12T05:00:00.000Z",
    );
  });

  it("handles DST: the same clock time in January is an hour later in UTC", () => {
    expect(gameStartInstant("2027-01-16", "09:00", "America/Chicago")?.toISOString()).toBe(
      "2027-01-16T15:00:00.000Z",
    );
  });

  it("returns null for nothing or garbage", () => {
    expect(gameStartInstant(null, "09:00", "America/Chicago")).toBeNull();
    expect(gameStartInstant("not a date", "09:00", "America/Chicago")).toBeNull();
  });
});

function gameStandardEmbedded() {
  return gameStartInstant("2026-09-12T18:00:00", null, "America/Chicago")?.toISOString();
}

describe("leagueTimeZone", () => {
  it("defaults to Eastern, which is every tenant before ETBL", () => {
    expect(LEAGUE_TIME_ZONE).toBe("America/New_York");
    expect(leagueTimeZone(null)).toBe("America/New_York");
    expect(leagueTimeZone({})).toBe("America/New_York");
    expect(leagueTimeZone({ timezone: "" })).toBe("America/New_York");
    expect(leagueTimeZone({ timezone: 5 })).toBe("America/New_York");
  });

  it("reads the league's own zone", () => {
    expect(leagueTimeZone({ timezone: " America/Chicago " })).toBe("America/Chicago");
  });
});
