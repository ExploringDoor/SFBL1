// Forgiving the loss in a team's extra game.
//
// Mike, 2026-09-04: when a division cannot split its team-games evenly one
// team plays an extra, "and then we drop loss for them". Adam picked the
// literal reading: drop one loss, keep the wins, so 3-1 over four games shows
// as 3-0.
//
// This is standings surgery on a live league, so the tests below care most
// about what must NOT move: a level division, the wins, and any league that
// did not ask for the rule.

import { describe, expect, it } from "vitest";
import { dropExtraGameLosses, type StandingsRow } from "@/lib/stats/shared";

const row = (
  team_id: string,
  w: number,
  l: number,
  t = 0,
  rs = 0,
  ra = 0,
): StandingsRow => ({
  team_id,
  gp: w + l + t,
  w,
  l,
  t,
  rs,
  ra,
  rd: rs - ra,
  pct: w + l + t > 0 ? (w + 0.5 * t) / (w + l + t) : 0,
  gb: 0,
});

const find = (rows: StandingsRow[], id: string) => rows.find((r) => r.team_id === id)!;

describe("the extra game", () => {
  it("drops the loss from the team that played one more", () => {
    const out = dropExtraGameLosses([row("a", 3, 1), row("b", 2, 1), row("c", 1, 2)]);
    expect(find(out, "a")).toMatchObject({ w: 3, l: 0, gp: 3 });
    expect(find(out, "b")).toMatchObject({ w: 2, l: 1, gp: 3 });
    expect(find(out, "c")).toMatchObject({ w: 1, l: 2, gp: 3 });
  });

  it("keeps an extra WIN, because nobody should lose out on a game they won", () => {
    const out = dropExtraGameLosses([row("a", 4, 0), row("b", 2, 1)]);
    expect(find(out, "a")).toMatchObject({ w: 4, l: 0, gp: 4 });
  });

  it("recomputes win percentage off the adjusted record", () => {
    const out = dropExtraGameLosses([row("a", 3, 1), row("b", 3, 0)]);
    expect(find(out, "a").pct).toBe(1); // 3-0
    expect(find(out, "b").pct).toBe(1);
  });

  it("recomputes games behind off the adjusted record", () => {
    const out = dropExtraGameLosses([row("a", 3, 1), row("b", 2, 1), row("c", 0, 3)]);
    // a is 3-0 after the drop, so it sets the pace at +3.
    expect(find(out, "a").gb).toBe(0);
    expect(find(out, "b").gb).toBe(1);
  });
});

describe("what must not move", () => {
  it("changes nothing when every team played the same number", () => {
    const rows = [row("a", 3, 1), row("b", 2, 2), row("c", 1, 3)];
    const out = dropExtraGameLosses(rows);
    expect(out).toEqual(rows.map((r) => ({ ...r, gb: expect.any(Number) })));
    for (const r of out) expect(r.gp).toBe(4);
  });

  it("never invents a loss to drop when the team has none", () => {
    // Two extra games but only one loss: only the loss can go.
    const out = dropExtraGameLosses([row("a", 4, 1), row("b", 3, 0)]);
    expect(find(out, "a")).toMatchObject({ w: 4, l: 0, gp: 4 });
  });

  it("leaves runs alone, so the extra game still counts against run diff", () => {
    const out = dropExtraGameLosses([row("a", 3, 1, 0, 20, 30), row("b", 2, 1, 0, 10, 8)]);
    expect(find(out, "a")).toMatchObject({ rs: 20, ra: 30, rd: -10 });
  });

  it("does not mutate the rows it was given", () => {
    const rows = [row("a", 3, 1), row("b", 2, 1)];
    dropExtraGameLosses(rows);
    expect(rows[0]).toMatchObject({ l: 1, gp: 4 });
  });

  it("handles an empty or single-team division without touching it", () => {
    expect(dropExtraGameLosses([])).toEqual([]);
    const one = [row("a", 3, 1)];
    expect(dropExtraGameLosses(one)[0]).toMatchObject({ w: 3, l: 1, gp: 4 });
  });

  it("ignores teams that have not played, so they cannot set the baseline", () => {
    // A team added mid-season with 0 games must not make everyone else "extra".
    const out = dropExtraGameLosses([row("a", 3, 1), row("b", 2, 2), row("new", 0, 0)]);
    expect(find(out, "a")).toMatchObject({ w: 3, l: 1, gp: 4 });
    expect(find(out, "new")).toMatchObject({ gp: 0 });
  });
});

describe("more than one extra game", () => {
  it("forgives one loss per extra game played", () => {
    const out = dropExtraGameLosses([row("a", 3, 2), row("b", 2, 1)]);
    expect(find(out, "a")).toMatchObject({ w: 3, l: 0, gp: 3 });
  });

  it("stops at the number of losses the team actually has", () => {
    const out = dropExtraGameLosses([row("a", 5, 1), row("b", 1, 2)]);
    expect(find(out, "a")).toMatchObject({ w: 5, l: 0, gp: 5 });
  });
});

// ── the mid-season trap ──────────────────────────────────────────────────
// Judging by games PLAYED is right in a finished season and wrong every other
// week of one. A rainout puts one team a game ahead of another through nobody's
// doing, and the played-games baseline would strike a real loss off the leader
// every week until the makeup was played. The schedule is the stable measure.

describe("baseline comes from the schedule, not the games played so far", () => {
  const scheduled = new Map([["a", 10], ["b", 10], ["c", 10]]);

  it("forgives nothing mid-season when the schedule is level", () => {
    // a has played 5, b only 4, because b was rained out. Nothing is forgiven.
    const out = dropExtraGameLosses([row("a", 3, 2), row("b", 2, 2)], scheduled);
    expect(find(out, "a")).toMatchObject({ w: 3, l: 2, gp: 5 });
    expect(find(out, "b")).toMatchObject({ w: 2, l: 2, gp: 4 });
  });

  it("still forgives the team the schedule really did give an extra game", () => {
    const uneven = new Map([["a", 11], ["b", 10], ["c", 10]]);
    const out = dropExtraGameLosses(
      [row("a", 6, 5), row("b", 5, 5), row("c", 4, 6)],
      uneven,
    );
    expect(find(out, "a")).toMatchObject({ w: 6, l: 4, gp: 10 });
    expect(find(out, "b")).toMatchObject({ w: 5, l: 5, gp: 10 });
  });

  it("forgives from the first week, not only once the season is over", () => {
    const uneven = new Map([["a", 11], ["b", 10]]);
    // One game in each. a lost theirs; the extra game is already accounted for.
    const out = dropExtraGameLosses([row("a", 0, 1), row("b", 1, 0)], uneven);
    expect(find(out, "a")).toMatchObject({ w: 0, l: 0, gp: 0 });
  });

  it("falls back to games played when the schedule is only partly known", () => {
    // A partial map must not mix baselines, so it is ignored entirely.
    const partial = new Map([["a", 11]]);
    const out = dropExtraGameLosses([row("a", 3, 1), row("b", 2, 1)], partial);
    expect(find(out, "a")).toMatchObject({ w: 3, l: 0, gp: 3 });
  });

  it("accepts a plain object as well as a Map", () => {
    const out = dropExtraGameLosses([row("a", 3, 1), row("b", 2, 1)], { a: 11, b: 10 });
    expect(find(out, "a")).toMatchObject({ w: 3, l: 0, gp: 3 });
  });
});
