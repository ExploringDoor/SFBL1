import { describe, it, expect } from "vitest";
import { parseArbiterIcs, splitMatchup, normalizeFeedUrl } from "@/lib/arbiter-ical";

const SAMPLE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//ArbiterSports//iCal//EN",
  "BEGIN:VEVENT",
  "UID:game-12345@arbitersports.com",
  "DTSTART;TZID=America/New_York:20260413T180000",
  "LOCATION:Cedar Crest HS - Field 2",
  "SUMMARY:Ephrata Drillerz at Hempfield Black",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:game-12346@arbitersports.com",
  "DTSTART;TZID=America/New_York:20260414T173000",
  "LOCATION:Manheim Twp Park",
  "SUMMARY:14U Section 1: Warwick Phillies vs Manheim Lions",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:game-utc@arbitersports.com",
  "DTSTART:20260413T230000Z",
  "LOCATION:Lions Field",
  "SUMMARY:LS Blue @ Cedar Crest",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseArbiterIcs", () => {
  const res = parseArbiterIcs(SAMPLE);

  it("parses every event with no errors", () => {
    expect(res.eventCount).toBe(3);
    expect(res.rows).toHaveLength(3);
    expect(res.errors).toHaveLength(0);
  });

  it("reads a TZID local time literally (no shift) and 'at' = away at home", () => {
    const g = res.rows[0]!;
    expect(g.date).toBe("2026-04-13");
    expect(g.time).toBe("18:00");
    expect(g.awayName).toBe("Ephrata Drillerz");
    expect(g.homeName).toBe("Hempfield Black");
    expect(g.field).toBe("Cedar Crest HS - Field 2");
    expect(g.uid).toBe("game-12345@arbitersports.com");
  });

  it("strips a 'label:' prefix and 'vs' = home vs away", () => {
    const g = res.rows[1]!;
    expect(g.time).toBe("17:30");
    expect(g.homeName).toBe("Warwick Phillies");
    expect(g.awayName).toBe("Manheim Lions");
  });

  it("converts a UTC instant to Eastern with DST (23:00Z Apr -> 19:00 EDT)", () => {
    const g = res.rows[2]!;
    expect(g.date).toBe("2026-04-13");
    expect(g.time).toBe("19:00");
    expect(g.awayName).toBe("LS Blue");
    expect(g.homeName).toBe("Cedar Crest");
  });

  it("rejects non-ical text", () => {
    const bad = parseArbiterIcs("just some text");
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(bad.rows).toHaveLength(0);
  });
});

describe("normalizeFeedUrl", () => {
  it("rewrites webcal:// to https:// (the URL setter can't)", () => {
    expect(normalizeFeedUrl("webcal://feeds.arbitersports.com/x.ics")).toBe(
      "https://feeds.arbitersports.com/x.ics",
    );
    expect(normalizeFeedUrl("WEBCAL://feeds.arbitersports.com/x.ics")).toBe(
      "https://feeds.arbitersports.com/x.ics",
    );
  });
  it("leaves https untouched and trims", () => {
    expect(normalizeFeedUrl("  https://x.test/a.ics  ")).toBe("https://x.test/a.ics");
  });
});

describe("splitMatchup", () => {
  it("handles the common shapes", () => {
    expect(splitMatchup("A at B")).toEqual({ away: "A", home: "B" });
    expect(splitMatchup("A @ B")).toEqual({ away: "A", home: "B" });
    expect(splitMatchup("A vs B")).toEqual({ home: "A", away: "B" });
    expect(splitMatchup("A vs. B")).toEqual({ home: "A", away: "B" });
    expect(splitMatchup("Warwick Phillies (14U) at Manheim Lions (14U)"))
      .toEqual({ away: "Warwick Phillies", home: "Manheim Lions" });
    expect(splitMatchup("no separator here")).toBeNull();
  });
});
