// The calendar feed's clock.
//
// This pairing has been wrong in production twice. A game is stored floating
// ("2026-09-14" + "18:00", no offset) because that is what makes it read
// "6:00 PM" to everyone on the schedule page. An iCalendar DTSTART ending in
// "Z" is the opposite: an absolute instant. Writing the wall clock straight
// into it tells every Google, Apple and Outlook subscriber the game starts at
// the league's UTC offset away from when it does.
//
// Measured on islandfastpitch.com 2026-09-10: a 6:00 PM Eastern game published
// as DTSTART:20260914T180000Z, which is 2:00 PM. Every game in the season was
// four hours early for everyone subscribed to the feed.
//
// These run against the real helpers the feed route uses, not copies of them,
// because a copy of the formatter would have passed happily while production
// was wrong.

import { describe, expect, it } from "vitest";
import { formatICalDate, gameStartInstant } from "@/lib/format-time";
import { leagueTimeZone } from "@/lib/league-time";

/** What the feed route writes for one game. */
const dtstart = (date: string, time: string | null, tz: string): string => {
  const start = gameStartInstant(date, time, tz);
  if (!start) throw new Error("gameStartInstant returned null");
  return formatICalDate(start);
};

describe("a league that never set a timezone", () => {
  // Island, LMLL, the district sites: every tenant before ETBL. An unset
  // timezone has to keep meaning Eastern or the fix breaks the platform.
  it("is Eastern", () => {
    expect(leagueTimeZone(undefined)).toBe("America/New_York");
    expect(leagueTimeZone(null)).toBe("America/New_York");
    expect(leagueTimeZone({})).toBe("America/New_York");
    expect(leagueTimeZone({ timezone: "   " })).toBe("America/New_York");
  });

  it("does not let a tenant that DID set one fall back", () => {
    expect(leagueTimeZone({ timezone: "America/Chicago" })).toBe("America/Chicago");
  });
});

describe("Island Fastpitch, the season that was four hours early", () => {
  const tz = leagueTimeZone({}); // Island sets no timezone

  it("publishes a 6:00 PM September game at 22:00Z, not 18:00Z", () => {
    expect(dtstart("2026-09-14", "18:00", tz)).toBe("20260914T220000Z");
  });

  // The exact string the live site was serving. Naming it means this test
  // fails loudly if anyone reintroduces the wall-clock-as-UTC shortcut.
  it("never republishes the wall clock as if it were UTC", () => {
    expect(dtstart("2026-09-14", "18:00", tz)).not.toBe("20260914T180000Z");
  });

  it("handles the 8:00 PM slot too", () => {
    expect(dtstart("2026-09-15", "20:00", tz)).toBe("20260916T000000Z");
  });

  it("is five hours off UTC once the clocks go back, not four", () => {
    // EDT ends 2026-11-01. A November game is EST, so 6 PM is 23:00Z.
    expect(dtstart("2026-11-10", "18:00", tz)).toBe("20261110T230000Z");
  });

  it("gets the day right on either side of the DST change", () => {
    expect(dtstart("2026-10-31", "18:00", tz)).toBe("20261031T220000Z"); // EDT
    expect(dtstart("2026-11-02", "18:00", tz)).toBe("20261102T230000Z"); // EST
  });
});

describe("ETBL, the reason the zone became per-tenant", () => {
  const tz = leagueTimeZone({ timezone: "America/Chicago" });

  it("publishes a 6:00 PM Central game at 23:00Z", () => {
    expect(dtstart("2026-09-14", "18:00", tz)).toBe("20260914T230000Z");
  });

  it("is six hours off UTC in the winter", () => {
    expect(dtstart("2026-12-08", "18:00", tz)).toBe("20261209T000000Z");
  });
});

describe("games with an awkward time field", () => {
  const tz = "America/New_York";

  it("treats a missing time as midnight in the league's own zone", () => {
    // Not UTC midnight: that was audit C3, and it moved the game to the
    // previous evening for every subscriber west of Greenwich.
    expect(dtstart("2026-09-14", null, tz)).toBe("20260914T040000Z");
  });

  it("accepts a single-digit hour", () => {
    expect(dtstart("2026-09-14", "9:30", tz)).toBe("20260914T133000Z");
  });

  it("reads a time embedded in the date when there is no time field", () => {
    expect(dtstart("2026-09-14T18:00", null, tz)).toBe("20260914T220000Z");
  });

  it("returns null rather than an invented instant for junk", () => {
    expect(gameStartInstant("", "18:00", tz)).toBeNull();
    expect(gameStartInstant(null, "18:00", tz)).toBeNull();
  });
});

describe("the formatter itself", () => {
  it("writes the iCal shape, zero padded", () => {
    expect(formatICalDate(new Date(Date.UTC(2026, 8, 4, 3, 7, 9)))).toBe("20260904T030709Z");
  });
});
