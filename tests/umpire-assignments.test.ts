// What each umpire is scheduled for, and how it reads in an email and a text.
//
// Two properties matter more than the formatting:
//
//   1. an umpire is only ever shown THEIR OWN games. Getting this wrong hands
//      one official another official's night.
//   2. the text message stays plain ASCII. One character outside GSM-7 flips
//      the whole SMS to UCS-2, which cuts the segment from 160 characters to
//      70, so a stray em-dash in a team name turns one text into three.

import { describe, expect, it } from "vitest";
import {
  renderLine,
  shortDate,
  shortTime,
  smsFor,
  smsSegments,
  toSmsSafe,
  upcomingByUmpire,
  type AssignmentGame,
} from "@/lib/umpire-assignments";

const TEAMS = new Map([
  ["t1", "Thunder 12U"],
  ["t2", "Waves 12U"],
  ["t3", "Rage 10U"],
]);

const GAMES: AssignmentGame[] = [
  { id: "past", date: "2026-09-01", time: "18:00", field: "Bellport 1", umpires: ["jim"], away_team_id: "t1", home_team_id: "t2" },
  { id: "g1", date: "2026-09-14", time: "18:00", field: "Bellport 1", umpires: ["jim", "tom"], away_team_id: "t1", home_team_id: "t2" },
  { id: "g2", date: "2026-09-15", time: "20:00", field: "Fireman's", umpires: ["tom"], away_team_id: "t3", home_team_id: "t1" },
  { id: "g3", date: "2026-09-16", time: "18:00", field: "Bellport 2", umpires: [], away_team_id: "t1", home_team_id: "t3" },
];

const TODAY = "2026-09-08";

describe("each umpire gets only their own games", () => {
  it("gives Jim his and not Tom's", () => {
    const m = upcomingByUmpire(GAMES, TEAMS, TODAY);
    expect(m.get("jim")).toHaveLength(1);
    expect(m.get("jim")!.map((l) => l.matchup)).toEqual(["Thunder 12U at Waves 12U"]);
  });

  it("gives Tom both of his", () => {
    expect(upcomingByUmpire(GAMES, TEAMS, TODAY).get("tom")).toHaveLength(2);
  });

  it("never leaks one umpire's field into another's list", () => {
    const jim = upcomingByUmpire(GAMES, TEAMS, TODAY).get("jim")!;
    expect(jim.map((l) => l.field)).not.toContain("Fireman's");
  });

  it("narrows to one umpire when asked", () => {
    const m = upcomingByUmpire(GAMES, TEAMS, TODAY, new Set(["jim"]));
    expect([...m.keys()]).toEqual(["jim"]);
  });
});

describe("what is left out", () => {
  it("drops games before today", () => {
    expect(upcomingByUmpire(GAMES, TEAMS, TODAY).get("jim")![0]!.date).toBe("2026-09-14");
  });

  it("keeps a game later today", () => {
    expect(upcomingByUmpire(GAMES, TEAMS, "2026-09-14").get("jim")).toHaveLength(1);
  });

  it("ignores games with nobody assigned", () => {
    const all = [...upcomingByUmpire(GAMES, TEAMS, TODAY).values()].flat();
    expect(all.map((l) => l.field)).not.toContain("Bellport 2");
  });

  it("returns nothing when no upcoming game has a crew", () => {
    expect(upcomingByUmpire([GAMES[3]!], TEAMS, TODAY).size).toBe(0);
  });

  it("is ordered earliest first", () => {
    const tom = upcomingByUmpire(GAMES, TEAMS, TODAY).get("tom")!;
    expect(tom.map((l) => l.date)).toEqual(["2026-09-14", "2026-09-15"]);
  });
});

describe("dates and times read the way a person says them", () => {
  it("turns 2026-09-14 into Mon 9/14", () => {
    expect(shortDate("2026-09-14")).toBe("Mon 9/14");
  });

  it("does not slide a day west of Greenwich", () => {
    // new Date("2026-09-14") is UTC midnight, which is the 13th in New York.
    // These are floating wall-clock dates and must not move.
    expect(shortDate("2026-09-14")).toContain("9/14");
    expect(shortDate("2026-01-01")).toContain("1/1");
  });

  it("turns 18:00 into 6:00 PM", () => {
    expect(shortTime("18:00")).toBe("6:00 PM");
  });

  it("handles noon and midnight", () => {
    expect(shortTime("12:00")).toBe("12:00 PM");
    expect(shortTime("00:30")).toBe("12:30 AM");
  });

  it("leaves a missing time blank rather than inventing midnight", () => {
    expect(shortTime("")).toBe("");
  });

  it("carries the game id so an email can link to it", () => {
    expect(upcomingByUmpire(GAMES, TEAMS, TODAY).get("jim")![0]!.id).toBe("g1");
  });

  it("renders a full line", () => {
    const l = upcomingByUmpire(GAMES, TEAMS, TODAY).get("jim")![0]!;
    expect(renderLine(l)).toBe("Mon 9/14 6:00 PM, Bellport 1 - Thunder 12U at Waves 12U");
  });
});

describe("the text message stays GSM-7", () => {
  it("replaces an em-dash rather than tripling the segment count", () => {
    expect(toSmsSafe("Thunder — Waves")).toBe("Thunder - Waves");
  });

  it("replaces curly quotes", () => {
    expect(toSmsSafe("Fireman’s “field”")).toBe("Fireman's \"field\"");
  });

  it("strips anything else outside plain ASCII", () => {
    expect(toSmsSafe("Rage ⚾ 10U")).toBe("Rage  10U");
  });

  it("leaves a clean message untouched", () => {
    expect(toSmsSafe("Mon 9/14 6:00 PM, Bellport 1")).toBe("Mon 9/14 6:00 PM, Bellport 1");
  });

  it("produces no non-ASCII for a team name full of them", () => {
    const teams = new Map([["t1", "Thunder—12U"], ["t2", "Waves’12U"]]);
    const lines = upcomingByUmpire(GAMES, teams, TODAY).get("jim")!;
    const msg = smsFor("Jim Kumo", lines, "Island Fastpitch");
    expect(/[^\x20-\x7E\n]/.test(msg)).toBe(false);
  });
});

describe("segment counting", () => {
  it("counts a short message as one", () => {
    expect(smsSegments("a".repeat(160))).toBe(1);
  });

  it("counts 161 characters as two", () => {
    expect(smsSegments("a".repeat(161))).toBe(2);
  });

  it("counts an empty message as zero", () => {
    expect(smsSegments("")).toBe(0);
  });
});

describe("the message itself", () => {
  const lines = upcomingByUmpire(GAMES, TEAMS, TODAY).get("tom")!;

  it("opens with the umpire's first name", () => {
    expect(smsFor("Tom Reilly", lines, "Island Fastpitch")).toMatch(/^Tom, /);
  });

  it("names the league", () => {
    expect(smsFor("Tom Reilly", lines, "Island Fastpitch")).toContain("Island Fastpitch");
  });

  it("lists every game", () => {
    const msg = smsFor("Tom Reilly", lines, "Island Fastpitch");
    expect(msg).toContain("Mon 9/14");
    expect(msg).toContain("Tue 9/15");
  });

  it("gets the singular right for one game", () => {
    const one = upcomingByUmpire(GAMES, TEAMS, TODAY).get("jim")!;
    expect(smsFor("Jim Kumo", one, "Island Fastpitch")).toContain("your game for");
  });

  it("says how many when there are several", () => {
    expect(smsFor("Tom Reilly", lines, "Island Fastpitch")).toContain("your 2 games for");
  });

  it("copes with an umpire stored as one word", () => {
    expect(smsFor("Cher", lines, "Island Fastpitch")).toMatch(/^Cher, /);
  });

  it("does not start with a stray comma when the name is blank", () => {
    expect(smsFor("", lines, "Island Fastpitch")).toMatch(/^your /);
  });
});
