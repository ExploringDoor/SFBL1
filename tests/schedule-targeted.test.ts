// Games-per-team scheduling.
//
// Mike, 2026-09-04: set the number of games each team plays, avoid repeat
// opponents and same-club matchups "if we can help it", and when the count is
// uneven let one team play one extra.
//
// The bug this replaces: same-club pairs were DELETED from the round robin, so
// clubs with two teams quietly played fewer games than everyone else. The
// tests that matter here are the ones proving a conflict now causes a re-pair
// instead of a missing game.

import { describe, expect, it } from "vitest";
import {
  buildTargetedRounds,
  generateSchedule,
  pairKeyOf,
  type GeneratorTeam,
} from "@/lib/schedule-generator";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

function counts(r: ReturnType<typeof buildTargetedRounds>) {
  return [...r.gamesFor.values()].sort((a, b) => a - b);
}

describe("buildTargetedRounds — the count is the promise", () => {
  it("gives every team exactly the games asked for, when it divides evenly", () => {
    const r = buildTargetedRounds({ teamIds: ids(8), gamesPerTeam: 4 });
    expect(counts(r)).toEqual([4, 4, 4, 4, 4, 4, 4, 4]);
    expect(r.short).toEqual([]);
  });

  it("never pairs a team with itself and never twice in one round", () => {
    const r = buildTargetedRounds({ teamIds: ids(10), gamesPerTeam: 5 });
    for (const round of r.rounds) {
      const seen = new Set<string>();
      for (const [a, b] of round) {
        expect(a).not.toBe(b);
        expect(seen.has(a)).toBe(false);
        expect(seen.has(b)).toBe(false);
        seen.add(a);
        seen.add(b);
      }
    }
  });

  it("avoids repeat opponents entirely when there is room to", () => {
    // 8 teams can give everyone 4 distinct opponents without any rematch.
    const r = buildTargetedRounds({ teamIds: ids(8), gamesPerTeam: 4 });
    expect(r.repeats).toEqual([]);
  });

  it("uses a rematch only rather than leave a team short", () => {
    // 4 teams, 5 games each: only 3 distinct opponents exist, so rematches are
    // unavoidable. Playing them beats sending a team home with 3 games.
    const r = buildTargetedRounds({ teamIds: ids(4), gamesPerTeam: 5 });
    expect(counts(r)).toEqual([5, 5, 5, 5]);
    expect(r.repeats.length).toBeGreaterThan(0);
  });
});

describe("uneven counts", () => {
  it("hands exactly one team the extra game when the total is odd", () => {
    // 5 teams x 3 games = 15 team-slots, an odd number, so it cannot come out
    // even. One team plays 4.
    const r = buildTargetedRounds({ teamIds: ids(5), gamesPerTeam: 3 });
    const c = counts(r);
    expect(c.filter((n) => n === 4)).toHaveLength(1);
    expect(c.filter((n) => n === 3)).toHaveLength(4);
  });

  it("an odd team count with even games still comes out level", () => {
    const r = buildTargetedRounds({ teamIds: ids(7), gamesPerTeam: 4 });
    expect(counts(r)).toEqual([4, 4, 4, 4, 4, 4, 4]);
  });

  it("nobody is ever left below the target when pairing is possible", () => {
    for (const teams of [3, 5, 6, 9, 11]) {
      for (const games of [1, 2, 3, 4]) {
        const r = buildTargetedRounds({ teamIds: ids(teams), gamesPerTeam: games });
        expect(Math.min(...counts(r))).toBeGreaterThanOrEqual(games);
        // and never more than one extra, for anyone
        expect(Math.max(...counts(r))).toBeLessThanOrEqual(games + 1);
      }
    }
  });
});

describe("clubs are avoided, not deleted", () => {
  // Four clubs of two. The old code deleted these four fixtures outright.
  const org: Record<string, string> = {
    t1: "Fire", t2: "Fire",
    t3: "Storm", t4: "Storm",
    t5: "Rays", t6: "Rays",
    t7: "Bolts", t8: "Bolts",
  };
  const orgOf = (id: string) => org[id] ?? "";

  it("keeps every team on the full count despite the clubs", () => {
    const r = buildTargetedRounds({ teamIds: ids(8), gamesPerTeam: 4, orgOf });
    expect(counts(r)).toEqual([4, 4, 4, 4, 4, 4, 4, 4]);
  });

  it("draws no club against itself when there is any alternative", () => {
    const r = buildTargetedRounds({ teamIds: ids(8), gamesPerTeam: 4, orgOf });
    expect(r.sameOrg).toEqual([]);
  });

  it("pairs a club against itself only when nothing else is left", () => {
    // One club of two, nobody else: the only game available is the derby.
    const r = buildTargetedRounds({
      teamIds: ["a", "b"],
      gamesPerTeam: 1,
      orgOf: () => "Fire",
    });
    expect(counts(r)).toEqual([1, 1]);
    expect(r.sameOrg).toHaveLength(1);
  });

  it("plays a rematch rather than draw a club against itself", () => {
    // Four teams, two of them one club, three games each. Only five legal
    // pairs exist but six games are needed, so SOMETHING has to give. The
    // right answer is a rematch. A derby used to be banned outright, so it is
    // the least acceptable of the soft conflicts and yields last. This pins
    // that ordering.
    const r = buildTargetedRounds({
      teamIds: ["a", "b", "c", "d"],
      gamesPerTeam: 3,
      orgOf: (id) => (id === "a" || id === "b" ? "Fire" : ""),
    });
    expect(counts(r)).toEqual([3, 3, 3, 3]);
    expect(r.sameOrg).toEqual([]);
    expect(r.repeats.length).toBeGreaterThan(0);
  });

  it("accepts the derby when it is the only game in town", () => {
    // Three teams, two of them one club, two games each: three games total and
    // no arrangement avoids the derby. Better to play it than send a team home
    // a game short, which is what the old code did.
    const r = buildTargetedRounds({
      teamIds: ["a", "b", "c"],
      gamesPerTeam: 2,
      orgOf: (id) => (id === "a" || id === "b" ? "Fire" : ""),
    });
    expect(counts(r)).toEqual([2, 2, 2]);
    expect(r.sameOrg).toHaveLength(1);
  });
});

describe("a blocked pair is absolute", () => {
  it("never draws a hand-blocked matchup, even at the cost of games", () => {
    const blocked = new Set([pairKeyOf("t1", "t2")]);
    const r = buildTargetedRounds({ teamIds: ids(6), gamesPerTeam: 3, blocked });
    for (const round of r.rounds) {
      for (const [a, b] of round) {
        expect(pairKeyOf(a, b)).not.toBe(pairKeyOf("t1", "t2"));
      }
    }
  });

  it("reports a team as short rather than break a block", () => {
    // Two teams, blocked against each other: there is no legal game at all.
    const r = buildTargetedRounds({
      teamIds: ["a", "b"],
      gamesPerTeam: 2,
      blocked: new Set([pairKeyOf("a", "b")]),
    });
    expect(r.rounds).toEqual([]);
    expect(r.short.sort()).toEqual(["a", "b"]);
  });
});

describe("degenerate inputs return rather than spin", () => {
  it("handles zero and one team", () => {
    expect(buildTargetedRounds({ teamIds: [], gamesPerTeam: 3 }).rounds).toEqual([]);
    expect(buildTargetedRounds({ teamIds: ["a"], gamesPerTeam: 3 }).rounds).toEqual([]);
  });

  it("handles a target of zero", () => {
    expect(buildTargetedRounds({ teamIds: ids(6), gamesPerTeam: 0 }).rounds).toEqual([]);
  });

  it("is deterministic, so rebuilding a season gives the same schedule", () => {
    const a = buildTargetedRounds({ teamIds: ids(9), gamesPerTeam: 4 });
    const b = buildTargetedRounds({ teamIds: ids(9), gamesPerTeam: 4 });
    expect(a.rounds).toEqual(b.rounds);
  });
});

// ── through the real generator, with a calendar and fields ───────────────

const team = (id: string, organization?: string): GeneratorTeam => ({
  id,
  name: id.toUpperCase(),
  ...(organization ? { organization } : {}),
});

const FIELDS = [{ name: "Cedar Hill", times: ["17:30", "19:00"] }];

describe("generateSchedule with gamesPerTeam", () => {
  it("places the target and stops, instead of filling the calendar", () => {
    const res = generateSchedule({
      teams: ids(6).map((i) => team(i)),
      startDate: "2026-09-12",
      weeks: 20, // far more calendar than the target needs
      daysOfWeek: [6],
      fields: FIELDS,
      gamesPerTeam: 3,
    });
    expect(res.warnings.filter((w) => w.includes("did not reach"))).toEqual([]);
    for (const row of res.gamesPerTeamActual) expect(row.games).toBe(3);
    expect(res.games).toHaveLength(9); // 6 teams x 3 games / 2
  });

  it("reports the team handed the extra game", () => {
    const res = generateSchedule({
      teams: ids(5).map((i) => team(i)),
      startDate: "2026-09-12",
      weeks: 20,
      daysOfWeek: [6],
      fields: [{ name: "Cedar Hill", times: ["09:00", "11:00", "13:00"] }],
      gamesPerTeam: 3,
    });
    expect(res.extraGameTeams).toHaveLength(1);
    const games = res.gamesPerTeamActual.map((r) => r.games).sort();
    expect(games).toEqual([3, 3, 3, 3, 4]);
  });

  it("does not delete same-club games any more, it re-pairs around them", () => {
    const teams = [
      team("a", "Fire"), team("b", "Fire"),
      team("c", "Storm"), team("d", "Storm"),
      team("e"), team("f"),
    ];
    const res = generateSchedule({
      teams,
      startDate: "2026-09-12",
      weeks: 20,
      daysOfWeek: [6],
      fields: FIELDS,
      gamesPerTeam: 3,
    });
    expect(res.skippedSameOrg).toEqual([]); // nothing dropped
    expect(res.sameOrgUsed).toEqual([]); // and none needed
    for (const row of res.gamesPerTeamActual) expect(row.games).toBe(3);
  });

  it("warns, rather than silently underfilling, when the calendar is too small", () => {
    const res = generateSchedule({
      teams: ids(8).map((i) => team(i)),
      startDate: "2026-09-12",
      weeks: 1, // one Saturday, two slots: nowhere near 4 games each
      daysOfWeek: [6],
      fields: FIELDS,
      gamesPerTeam: 4,
    });
    expect(res.warnings.some((w) => w.includes("did not reach"))).toBe(true);
  });

  it("leaves the old round-robin behaviour alone when gamesPerTeam is unset", () => {
    const withOut = generateSchedule({
      teams: ids(4).map((i) => team(i)),
      startDate: "2026-09-12",
      weeks: 6,
      daysOfWeek: [6],
      fields: FIELDS,
    });
    expect(withOut.everyPairPlayed).toBe(true);
    expect(withOut.gamesPerTeamActual.length).toBe(4);
    expect(withOut.extraGameTeams).toEqual([]);
  });
});
