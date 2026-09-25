import { describe, it, expect } from "vitest";
import { parseArbiterSchedule } from "@/lib/arbiter";

// Arbiter's "Games with Official info" report: the schedule plus numbered
// Official columns, each with an email and an acceptance status.
const NUMBERED = [
  "Game,Date,Time,Site,Away,Home,Official 1,Official 1 Email,Official 1 Status,Official 2,Official 2 Email,Official 2 Status",
  '1001,13-Apr-26,6:00 PM,Cedar Crest - Field 2,Ephrata Drillerz,Hempfield Black,"Smith, John",jsmith@umps.org,Accepted,"Doe, Jane",jdoe@umps.org,Unaccepted',
  '1002,13-Apr-26,6:00 PM,Lions Field,Warwick Phillies,Manheim Lions,"Brown, Bob",bbrown@umps.org,Declined,,,',
  "1003,14-Apr-26,5:30 PM,Manheim Twp Park,LS Blue,Cedar Crest,,,,,,",
].join("\n");

describe("officials — numbered Official columns", () => {
  const res = parseArbiterSchedule(NUMBERED);

  it("detects the official name columns and does not treat them as ignored", () => {
    expect(res.officialColumns).toEqual(["Official 1", "Official 2"]);
    expect(res.ignoredColumns).not.toContain("official 1 email");
    expect(res.ignoredColumns).not.toContain("official 1 status");
  });

  it("pairs each official with its email and keeps 'Last, First' intact", () => {
    const g = res.rows.find((r) => r.gameNumber === "1001")!;
    expect(g.officials).toEqual([
      { name: "Smith, John", email: "jsmith@umps.org", status: "Accepted" },
      { name: "Doe, Jane", email: "jdoe@umps.org", status: "Unaccepted" },
    ]);
  });

  it("drops an official whose status says they are off the game (Declined)", () => {
    const g = res.rows.find((r) => r.gameNumber === "1002")!;
    expect(g.officials).toEqual([]);
  });

  it("leaves officials empty for an unassigned game", () => {
    const g = res.rows.find((r) => r.gameNumber === "1003")!;
    expect(g.officials).toEqual([]);
  });
});

describe("officials — positional Plate/Base columns", () => {
  const res = parseArbiterSchedule(
    [
      "Game,Date,Time,Site,Away,Home,Plate,Base",
      '2001,20-Apr-26,10:00 AM,Field A,Reds,Blues,Ken Adams,Lee Ray',
    ].join("\n"),
  );

  it("tags each official with its position", () => {
    expect(res.officialColumns).toEqual(["Plate", "Base"]);
    expect(res.rows[0]!.officials).toEqual([
      { name: "Ken Adams", position: "Plate" },
      { name: "Lee Ray", position: "Base" },
    ]);
  });
});

describe("officials — one column listing several people", () => {
  const res = parseArbiterSchedule(
    [
      "Game,Date,Time,Site,Away,Home,Officials",
      '3001,21-Apr-26,10:00 AM,Field B,Reds,Blues,"Adams, Ken; Ray, Lee"',
    ].join("\n"),
  );

  it("splits on ';' but never on the comma inside a name", () => {
    expect(res.rows[0]!.officials).toEqual([
      { name: "Adams, Ken" },
      { name: "Ray, Lee" },
    ]);
  });
});

describe("officials — plain schedule (no crew columns)", () => {
  const res = parseArbiterSchedule(
    [
      "Game,Date,Time,Site,Away,Home",
      "4001,22-Apr-26,10:00 AM,Field C,Reds,Blues",
    ].join("\n"),
  );

  it("reports no official columns and empty crew per row", () => {
    expect(res.officialColumns).toEqual([]);
    expect(res.rows[0]!.officials).toEqual([]);
  });
});

describe("officials — duplicate name and placeholder slots", () => {
  const res = parseArbiterSchedule(
    [
      "Game,Date,Time,Site,Away,Home,Official 1,Official 2,Official 3",
      "5001,23-Apr-26,10:00 AM,Field D,Reds,Blues,Ken Adams,Ken Adams,TBD",
    ].join("\n"),
  );

  it("de-dupes a repeated official and drops TBD placeholders", () => {
    expect(res.rows[0]!.officials).toEqual([{ name: "Ken Adams" }]);
  });
});
