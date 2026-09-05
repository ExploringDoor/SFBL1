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
  summariseClubs,
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

// ── invariants, swept across the shapes a league might have ──────────────
// These found three real bugs that the hand-written cases above missed:
// a finished team could be borrowed again and again, so several teams ended
// two and three games ABOVE the target; two teams blocked against each other
// stranded one another every round; and the extra game was handed out even
// when the total divided evenly. Cheap to run, so it stays.

describe("invariants across 1,000+ division shapes", () => {
  const CLUB_SHAPES = [
    { name: "no clubs", of: () => "" },
    { name: "two clubs of two", of: (i: number) => (i < 4 ? `C${Math.floor(i / 2)}` : "") },
    { name: "everyone in a club of three", of: (i: number) => `C${Math.floor(i / 3)}` },
    { name: "half the field in one club", of: (i: number) => (i % 2 ? "Big" : "") },
  ];

  it("holds for every team count, game target, club layout and block list", () => {
    const failures: string[] = [];
    let checked = 0;

    // Every small size exhaustively, plus a few big ones. Divisions are
    // usually 8 to 16 teams; the large entries are there so a whole-league
    // run cannot regress unnoticed.
    const SIZES = [...Array.from({ length: 23 }, (_, i) => i + 2), 28, 34, 41];
    for (const t of SIZES) {
      for (let g = 1; g <= 10; g++) {
        for (const shape of CLUB_SHAPES) {
          const teamIds = Array.from({ length: t }, (_, i) => `t${i}`);
          const orgOf = (id: string) => shape.of(Number(id.slice(1)));
          const blocked =
            t >= 4
              ? new Set([pairKeyOf("t0", "t1"), pairKeyOf("t2", "t3")])
              : new Set<string>();
          const r = buildTargetedRounds({ teamIds, gamesPerTeam: g, orgOf, blocked });
          checked++;
          const where = `${t} teams x ${g} games, ${shape.name}`;
          const counts = teamIds.map((id) => r.gamesFor.get(id) ?? 0);
          const fail = (m: string) => failures.push(`${where}: ${m}`);

          // A blocked pair is absolute, always, everywhere.
          for (const round of r.rounds) {
            for (const [a, b] of round) {
              if (blocked.has(pairKeyOf(a, b))) fail("played a blocked pair");
            }
          }

          // Nobody plays twice in one round, and nobody plays themselves.
          for (const round of r.rounds) {
            const seen = new Set<string>();
            for (const [a, b] of round) {
              if (a === b) fail("team paired with itself");
              if (seen.has(a) || seen.has(b)) fail("team twice in one round");
              seen.add(a);
              seen.add(b);
            }
          }

          // The reported counts match the rounds actually produced.
          const tally = new Map<string, number>();
          for (const round of r.rounds) {
            for (const [a, b] of round) {
              tally.set(a, (tally.get(a) ?? 0) + 1);
              tally.set(b, (tally.get(b) ?? 0) + 1);
            }
          }
          for (const id of teamIds) {
            if ((tally.get(id) ?? 0) !== (r.gamesFor.get(id) ?? 0)) {
              fail(`bookkeeping drift on ${id}`);
            }
          }

          // Nobody is ever handed more than one extra game.
          if (Math.max(...counts) > g + 1) fail(`a team reached ${Math.max(...counts)}`);

          // With no blocks in the way the count is exact: everyone reaches the
          // target, and the extra game appears only when the total is odd.
          if (blocked.size === 0) {
            if (Math.min(...counts) < g) fail(`a team finished on ${Math.min(...counts)}`);
            const extras = counts.filter((n) => n === g + 1).length;
            const expected = (t * g) % 2 === 1 ? 1 : 0;
            if (extras !== expected) fail(`${extras} extras, expected ${expected}`);
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(1000);
    expect(failures.slice(0, 10)).toEqual([]);
  });
});

// ── the club chips ───────────────────────────────────────────────────────
// The point of showing these is that a typo is INVISIBLE otherwise: matching
// is by name, so "Fire" against "Fire Softball" silently stops keeping two
// teams apart, and the only clue is a club showing one team. So the summary
// has to group exactly the way the pairing does, or the chips lie.

describe("summariseClubs", () => {
  const teams = [
    { id: "1", name: "Thunder 12U" },
    { id: "2", name: "Thunder 14U" },
    { id: "3", name: "Rays" },
    { id: "4", name: "Bolts" },
  ];

  it("groups teams that share a club", () => {
    const out = summariseClubs(teams, (id) =>
      id === "1" || id === "2" ? "Thunder" : "",
    );
    expect(out).toEqual([{ label: "Thunder", teams: ["Thunder 12U", "Thunder 14U"] }]);
  });

  it("ignores case and padding, exactly as the pairing does", () => {
    const out = summariseClubs(teams, (id) =>
      id === "1" ? "  Thunder " : id === "2" ? "THUNDER" : "",
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.teams).toHaveLength(2);
  });

  it("shows a misspelling as two clubs of one, which is the whole point", () => {
    const out = summariseClubs(teams, (id) =>
      id === "1" ? "Thunder" : id === "2" ? "Thunder Softball" : "",
    );
    expect(out.map((c) => c.teams.length)).toEqual([1, 1]);
  });

  it("keeps the spelling a human typed rather than a lowercased key", () => {
    const out = summariseClubs(teams, (id) => (id === "1" ? "Long Island Thunder" : ""));
    expect(out[0]!.label).toBe("Long Island Thunder");
  });

  it("skips teams with no club, and returns nothing when none are set", () => {
    expect(summariseClubs(teams, () => "")).toEqual([]);
    expect(summariseClubs(teams, () => null)).toEqual([]);
    expect(summariseClubs(teams, () => undefined)).toEqual([]);
  });

  it("puts the biggest club first, then alphabetical, so the order is stable", () => {
    const out = summariseClubs(teams, (id) =>
      id === "1" || id === "2" ? "Zebras" : id === "3" ? "Apples" : "Bears",
    );
    expect(out.map((c) => c.label)).toEqual(["Zebras", "Apples", "Bears"]);
  });

  it("agrees with the pairing: a club it shows as 2 really is kept apart", () => {
    const org: Record<string, string> = { a: "Fire", b: "  fire  ", c: "", d: "" };
    const summary = summariseClubs(
      ["a", "b", "c", "d"].map((id) => ({ id, name: id })),
      (id) => org[id] ?? "",
    );
    expect(summary[0]!.teams).toHaveLength(2);
    // and the scheduler treats them as one club too
    const r = buildTargetedRounds({
      teamIds: ["a", "b", "c", "d"],
      gamesPerTeam: 2,
      orgOf: (id) => org[id] ?? "",
    });
    expect(r.sameOrg).toEqual([]);
  });
});
