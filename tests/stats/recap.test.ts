// Tests for lib/stats/recap.ts → buildRecap.
//
// buildRecap runs after every captain-submit and is what powers the
// auto-generated headline + 2-paragraph game story on /games/[id].
// It also drives the Player of the Game callout. A bug here means
// every final score has a broken or wrong story attached.
//
// We test structural properties (headline format, paragraph count,
// POTG presence/absence, no-crash-on-empty) rather than exact prose.
// Exact wording is allowed to drift.

import { describe, expect, it } from "vitest";
import {
  buildRecap,
  type RecapInput,
  type RecapOutput,
} from "@/lib/stats/recap";

// ── helpers ────────────────────────────────────────────────────────

function emptyInput(overrides: Partial<RecapInput> = {}): RecapInput {
  return {
    awayTeamName: "Yankees",
    homeTeamName: "Red Sox",
    awayScore: 0,
    homeScore: 0,
    awayLineup: [],
    homeLineup: [],
    awayPitchers: [],
    homePitchers: [],
    playerNames: {},
    ...overrides,
  };
}

const HALL_OF_FAME_BATTER = {
  player_id: "p1",
  ab: 4,
  h: 4,
  hr: 2,
  rbi: 5,
  r: 3,
  bb: 1,
};

// ── headline shapes ────────────────────────────────────────────────

describe("buildRecap — headline", () => {
  it("uses winner-first format with a margin verb", () => {
    const out = buildRecap(emptyInput({ awayScore: 7, homeScore: 3 }));
    // 4-run win → "beat" (margin 3–5). The old flowery verb ladder
    // (took down / ran away / rolled past) was simplified to
    // defeated / beat / edged.
    expect(out.headline).toContain("Yankees");
    expect(out.headline).toContain("Red Sox");
    expect(out.headline).toContain("7");
    expect(out.headline).toContain("3");
    expect(out.headline.toLowerCase()).toMatch(/yankees beat red sox/);
  });

  it("'defeated' verb on a large margin (>= 6)", () => {
    const out = buildRecap(emptyInput({ awayScore: 15, homeScore: 1 }));
    expect(out.headline.toLowerCase()).toContain("defeated");
  });

  it("'defeated' verb on margin 6-9", () => {
    const out = buildRecap(emptyInput({ awayScore: 8, homeScore: 1 }));
    expect(out.headline.toLowerCase()).toContain("defeated");
  });

  it("edged verb on 1-run margin", () => {
    const out = buildRecap(emptyInput({ awayScore: 4, homeScore: 3 }));
    expect(out.headline.toLowerCase()).toContain("edged");
  });

  it("plain 'beat' for 2-run margin", () => {
    const out = buildRecap(emptyInput({ awayScore: 5, homeScore: 3 }));
    expect(out.headline.toLowerCase()).toContain("beat");
    // Disambiguate from "ran away from"/"rolled past" etc.
    expect(out.headline.toLowerCase()).not.toContain("rolled past");
  });

  it("tie game: 'played to a draw' format", () => {
    const out = buildRecap(emptyInput({ awayScore: 4, homeScore: 4 }));
    expect(out.headline.toLowerCase()).toContain("draw");
    expect(out.headline).toContain("Yankees");
    expect(out.headline).toContain("Red Sox");
  });
});

// ── body structure ─────────────────────────────────────────────────

describe("buildRecap — body structure", () => {
  it("returns 1-2 paragraphs even with no players (no crash)", () => {
    const out = buildRecap(emptyInput({ awayScore: 5, homeScore: 3 }));
    expect(out.body.length).toBeGreaterThanOrEqual(1);
    expect(out.body.length).toBeLessThanOrEqual(2);
    // Each paragraph is a string, not array.
    for (const p of out.body) {
      expect(typeof p).toBe("string");
      expect(p.length).toBeGreaterThan(0);
    }
  });

  it("returns 2 paragraphs when there's a POTG and standouts", () => {
    const out = buildRecap(
      emptyInput({
        awayScore: 7,
        homeScore: 3,
        awayLineup: [
          HALL_OF_FAME_BATTER,
          { player_id: "p2", ab: 3, h: 2, rbi: 2, r: 1 },
        ],
        playerNames: { p1: "Aaron Judge", p2: "Juan Soto" },
      }),
    );
    expect(out.body.length).toBe(2);
  });
});

// ── POTG identification ────────────────────────────────────────────

describe("buildRecap — POTG", () => {
  it("identifies a strong batter as POTG and surfaces their name", () => {
    const out = buildRecap(
      emptyInput({
        awayScore: 7,
        homeScore: 3,
        awayLineup: [HALL_OF_FAME_BATTER],
        playerNames: { p1: "Aaron Judge" },
      }),
    );
    expect(out.potg).not.toBeNull();
    expect(out.potg!.player_id).toBe("p1");
    expect(out.potg!.player_name).toBe("Aaron Judge");
    expect(out.potg!.source).toBe("batting");
    // POTG mentioned in body text.
    expect(out.body.join(" ")).toContain("Aaron Judge");
  });

  it("identifies a dominant pitcher (no ER, lots of K) as POTG", () => {
    const out = buildRecap(
      emptyInput({
        awayScore: 5,
        homeScore: 0,
        awayPitchers: [
          {
            player_id: "p1",
            ip_outs: 21, // 7 IP
            so: 12,
            er: 0,
          },
        ],
        playerNames: { p1: "Gerrit Cole" },
      }),
    );
    expect(out.potg).not.toBeNull();
    expect(out.potg!.player_id).toBe("p1");
    expect(out.potg!.source).toBe("pitching");
    expect(out.body.join(" ")).toContain("Gerrit Cole");
  });

  it("returns potg=null when there are no batters or pitchers", () => {
    const out = buildRecap(emptyInput({ awayScore: 7, homeScore: 3 }));
    expect(out.potg).toBeNull();
  });

  it("falls back to player_id when name is missing", () => {
    const out = buildRecap(
      emptyInput({
        awayScore: 7,
        homeScore: 3,
        awayLineup: [HALL_OF_FAME_BATTER],
        playerNames: {}, // no entry for p1
      }),
    );
    expect(out.potg!.player_name).toBe("p1");
  });
});

// ── Score-Only awareness ───────────────────────────────────────────

describe("buildRecap — Score-Only mode", () => {
  it("away score-only drops away player highlights from POTG pool", () => {
    // Even though awayLineup has a HOF batter, awayScoreOnly should
    // exclude them. Home has no batters — so POTG should be null.
    const out = buildRecap(
      emptyInput({
        awayScore: 7,
        homeScore: 3,
        awayLineup: [HALL_OF_FAME_BATTER],
        awayScoreOnly: true,
        playerNames: { p1: "Aaron Judge" },
      }),
    );
    expect(out.potg).toBeNull();
    // Mentions that the away team submitted score-only.
    expect(out.body.join(" ")).toContain("score-only");
  });

  it("home score-only drops home player highlights from POTG pool", () => {
    const out = buildRecap(
      emptyInput({
        awayScore: 3,
        homeScore: 7,
        homeLineup: [HALL_OF_FAME_BATTER],
        homeScoreOnly: true,
        playerNames: { p1: "Mookie Betts" },
      }),
    );
    expect(out.potg).toBeNull();
    expect(out.body.join(" ")).toContain("score-only");
  });

  it("both sides score-only: no stats disclaimer, just the result", () => {
    const out = buildRecap(
      emptyInput({
        awayScore: 5,
        homeScore: 2,
        awayScoreOnly: true,
        homeScoreOnly: true,
      }),
    );
    expect(out.potg).toBeNull();
    // The old "individual stats weren't recorded" boilerplate repeated on
    // every score-only recap and told the reader nothing; the missing
    // stat line already says it.
    expect(out.body.join(" ")).not.toContain("Score-only result");
    expect(out.body.join(" ")).not.toContain("weren't recorded");
    // Should still have a sensible headline and an actual result.
    expect(out.headline).toContain("Yankees");
    expect(out.headline).toContain("Red Sox");
    expect(out.body.join(" ")).toContain("5–2");
  });

  it("playoff game: recap names the round and the stakes", () => {
    const out = buildRecap(
      emptyInput({
        awayScore: 16,
        homeScore: 7,
        playoff: {
          divisionLabel: "35+ National",
          roundLabel: "Round 1",
          isFinalRound: false,
        },
      }),
    );
    const text = out.body.join(" ");
    expect(text).toContain("Round 1 of the 35+ National playoffs");
    expect(text).toContain("advance");
    expect(text).toContain("season is over");
  });

  it("championship game: recap crowns the winner", () => {
    const out = buildRecap(
      emptyInput({
        awayScore: 4,
        homeScore: 3,
        playoff: {
          divisionLabel: "28+",
          roundLabel: "Round 3",
          isFinalRound: true,
        },
      }),
    );
    const text = out.body.join(" ");
    expect(text).toContain("the 28+ championship game");
    expect(text).toContain("champions");
    expect(text).not.toContain("season is over");
  });

  it("regular-season recap says nothing about playoffs", () => {
    const out = buildRecap(emptyInput({ awayScore: 6, homeScore: 1 }));
    const text = out.body.join(" ");
    expect(text).not.toContain("playoff");
    expect(text).not.toContain("advance");
  });

  it("only the score-only team's batters are excluded — other team's POTG stands", () => {
    // Away is score-only. Home has a POTG-worthy batter.
    const out = buildRecap(
      emptyInput({
        awayScore: 3,
        homeScore: 7,
        awayLineup: [HALL_OF_FAME_BATTER],
        awayScoreOnly: true,
        homeLineup: [
          { player_id: "p2", ab: 4, h: 3, hr: 1, rbi: 4, r: 2 },
        ],
        playerNames: { p1: "Aaron Judge", p2: "Mookie Betts" },
      }),
    );
    expect(out.potg!.player_id).toBe("p2");
    expect(out.potg!.player_name).toBe("Mookie Betts");
    // The score-only team's batter should NOT be the POTG.
    expect(out.body.join(" ")).not.toContain("Aaron Judge");
  });
});

// ── inning highlight ──────────────────────────────────────────────

describe("buildRecap — inning highlight", () => {
  it("names the biggest 5+ run inning with its ordinal", () => {
    const out = buildRecap(
      emptyInput({
        awayScore: 8,
        homeScore: 1,
        awayLine: [0, 0, 5, 0, 0, 1, 2, 0, 0],
        homeLine: [1, 0, 0, 0, 0, 0, 0, 0, 0],
      }),
    );
    // The 5-run 3rd is the big inning; a later, smaller inning must not
    // overwrite it (regression guard for the big-inning fix).
    expect(out.body.join(" ")).toMatch(/put up 5 runs in the 3rd/i);
  });

  it("a 3-run inning gets no big-inning callout (threshold is 5)", () => {
    const out = buildRecap(
      emptyInput({
        awayScore: 4,
        homeScore: 1,
        awayLine: [0, 0, 3, 0, 0, 1, 0, 0, 0],
        homeLine: [0, 0, 0, 0, 0, 1, 0, 0, 0],
      }),
    );
    expect(out.body.join(" ")).not.toMatch(/put up \d+ runs in the/i);
  });

  it("no inning highlight when no inning has 3+ runs", () => {
    const out = buildRecap(
      emptyInput({
        awayScore: 4,
        homeScore: 3,
        awayLine: [1, 1, 0, 1, 1, 0, 0, 0, 0],
        homeLine: [0, 1, 1, 0, 0, 1, 0, 0, 0],
      }),
    );
    // Body shouldn't mention "broke things open" or similar.
    expect(out.body.join(" ")).not.toMatch(/broke things open/i);
  });

  it("no crash when linescore arrays are absent", () => {
    expect(() =>
      buildRecap(emptyInput({ awayScore: 7, homeScore: 3 })),
    ).not.toThrow();
  });
});

// ── opener context (date / field) ──────────────────────────────────

describe("buildRecap — opener context", () => {
  it("includes field name when provided", () => {
    const out = buildRecap(
      emptyInput({
        awayScore: 5,
        homeScore: 3,
        field: "Field 7",
      }),
    );
    expect(out.body[0]).toContain("Field 7");
  });

  it("includes the date in human format when provided", () => {
    const out = buildRecap(
      emptyInput({
        awayScore: 5,
        homeScore: 3,
        date: "2026-05-10T18:00:00",
      }),
    );
    // Should contain at least the day/month — exact format depends
    // on locale but "May" and "10" should be in there.
    const body = out.body[0]!;
    expect(body).toMatch(/May|may/);
    expect(body).toMatch(/10|9/); // date depends on local TZ
  });

  it("omits field/date gracefully when not provided", () => {
    const out = buildRecap(emptyInput({ awayScore: 5, homeScore: 3 }));
    // No NaN, no "undefined", no "at " trailing nothing.
    expect(out.body[0]).not.toContain("undefined");
    expect(out.body[0]).not.toContain("NaN");
    expect(out.body[0]).not.toMatch(/\bat\s*\./);
    expect(out.body[0]).not.toMatch(/\bon\s*\./);
  });

  it("doesn't crash on a malformed date string", () => {
    // Anything new Date(...) can swallow without throwing — including
    // garbage. Just verify no throw.
    expect(() =>
      buildRecap(
        emptyInput({
          awayScore: 5,
          homeScore: 3,
          date: "not-a-date-at-all",
        }),
      ),
    ).not.toThrow();
  });
});

// ── closing line + tone ────────────────────────────────────────────

describe("buildRecap — closing line", () => {
  it("emits no editorial closing rhetoric (removed by design)", () => {
    // The old "statement win" / "momentum" / "played them tough" closers
    // weren't backed by data and were intentionally removed. Guard so they
    // don't creep back in.
    for (const [awayScore, homeScore] of [
      [12, 2],
      [7, 2],
      [4, 3],
    ] as const) {
      const out = buildRecap(
        emptyInput({
          awayScore,
          homeScore,
          awayLineup: [HALL_OF_FAME_BATTER],
          playerNames: { p1: "X" },
        }),
      );
      const text = out.body.join(" ").toLowerCase();
      expect(text).not.toContain("statement win");
      expect(text).not.toContain("momentum");
      expect(text).not.toContain("played them tough");
    }
  });

  it("no closing line for ties (no winner to anchor it)", () => {
    const out = buildRecap(
      emptyInput({
        awayScore: 4,
        homeScore: 4,
        awayLineup: [HALL_OF_FAME_BATTER],
        playerNames: { p1: "X" },
      }),
    );
    expect(out.body.join(" ").toLowerCase()).not.toContain("statement win");
    expect(out.body.join(" ").toLowerCase()).not.toContain("come out on top");
  });
});

// ── output safety ──────────────────────────────────────────────────

describe("buildRecap — output safety", () => {
  it("never returns 'undefined' or 'NaN' in output strings", () => {
    const out = buildRecap(
      emptyInput({
        awayScore: 5,
        homeScore: 3,
        awayLineup: [{ player_id: "p1", ab: 4, h: 2 }], // sparse fields
        playerNames: { p1: "Sparse" },
      }),
    );
    const all = [out.headline, ...out.body].join(" ");
    expect(all).not.toContain("undefined");
    expect(all).not.toContain("NaN");
    expect(all).not.toContain("null");
  });

  it("doesn't throw on totally empty input + 0-0 score", () => {
    expect(() => buildRecap(emptyInput())).not.toThrow();
  });

  it("doesn't throw on extremely high scores or margins", () => {
    expect(() =>
      buildRecap(emptyInput({ awayScore: 99, homeScore: 0 })),
    ).not.toThrow();
  });
});
