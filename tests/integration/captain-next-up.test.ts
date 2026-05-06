// Tests for lib/captain-next-up.ts → awaitingScoreGames.
//
// Pins the filter logic that drives the captain dashboard's
// "Awaiting your score" CTA section. DVSL §9 flagged "where do I
// submit my final score?" as the #1 captain support ticket — so
// this surface needs to be DVSL-faithful: show every past
// non-final game where the captain's team is involved, oldest-first,
// excluding the captain's other-team games.

import { describe, expect, it } from "vitest";
import {
  awaitingScoreGames,
  type CaptainGame,
} from "@/lib/captain-next-up";

const today = new Date("2026-05-10T12:00:00Z");

function game(overrides: Partial<CaptainGame> = {}): CaptainGame {
  return {
    id: "g1",
    date: "2026-05-09",
    status: "scheduled",
    away_team_id: "team_a",
    home_team_id: "team_b",
    ...overrides,
  };
}

// ── basic filter behavior ─────────────────────────────────────────

describe("awaitingScoreGames — basic", () => {
  it("returns empty when no games at all", () => {
    expect(awaitingScoreGames([], "team_a", today)).toEqual([]);
  });

  it("returns entry with side='away' when captain's team is the away side", () => {
    const result = awaitingScoreGames(
      [game({ away_team_id: "team_a", home_team_id: "team_b" })],
      "team_a",
      today,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.side).toBe("away");
  });

  it("returns entry with side='home' when captain's team is the home side", () => {
    const result = awaitingScoreGames(
      [game({ away_team_id: "team_a", home_team_id: "team_b" })],
      "team_b",
      today,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.side).toBe("home");
  });
});

// ── exclusion rules ───────────────────────────────────────────────

describe("awaitingScoreGames — exclusions", () => {
  it("EXCLUDES games where this captain's team is NOT a participant", () => {
    const games = [
      game({ id: "mine", away_team_id: "team_a", home_team_id: "team_b" }),
      game({ id: "other", away_team_id: "team_c", home_team_id: "team_d" }),
    ];
    const result = awaitingScoreGames(games, "team_a", today);
    expect(result.map((r) => r.game.id)).toEqual(["mine"]);
  });

  it("EXCLUDES games marked 'final' (already submitted by both)", () => {
    const result = awaitingScoreGames(
      [game({ status: "final" })],
      "team_a",
      today,
    );
    expect(result).toEqual([]);
  });

  it("EXCLUDES games marked 'approved' (admin-confirmed final)", () => {
    const result = awaitingScoreGames(
      [game({ status: "approved" })],
      "team_a",
      today,
    );
    expect(result).toEqual([]);
  });

  it("EXCLUDES future games (we don't show 'submit score' CTAs pre-game)", () => {
    const result = awaitingScoreGames(
      [game({ date: "2026-05-15" })], // 5 days in the future
      "team_a",
      today,
    );
    expect(result).toEqual([]);
  });

  it("EXCLUDES games with no date (can't tell if past or future)", () => {
    const result = awaitingScoreGames(
      [game({ date: null })],
      "team_a",
      today,
    );
    expect(result).toEqual([]);
  });

  it("EXCLUDES games with malformed date strings", () => {
    const result = awaitingScoreGames(
      [game({ date: "not-a-date" })],
      "team_a",
      today,
    );
    expect(result).toEqual([]);
  });

  it("INCLUDES today's games (date == today)", () => {
    const result = awaitingScoreGames(
      [game({ date: "2026-05-10" })],
      "team_a",
      today,
    );
    expect(result).toHaveLength(1);
  });

  it("INCLUDES games with non-final non-scheduled statuses (e.g. 'in_progress')", () => {
    // Defensive: any non-terminal state means score still needed.
    const result = awaitingScoreGames(
      [game({ status: "in_progress" })],
      "team_a",
      today,
    );
    expect(result).toHaveLength(1);
  });
});

// ── sort order + multi-game ───────────────────────────────────────

describe("awaitingScoreGames — sort + multi-game", () => {
  it("sorts oldest-first so most urgent un-scored games surface", () => {
    const games = [
      game({ id: "newest", date: "2026-05-08" }),
      game({ id: "oldest", date: "2026-04-20" }),
      game({ id: "middle", date: "2026-05-01" }),
    ];
    const result = awaitingScoreGames(games, "team_a", today);
    expect(result.map((r) => r.game.id)).toEqual([
      "oldest",
      "middle",
      "newest",
    ]);
  });

  it("returns multiple entries when captain has 3 un-scored past games", () => {
    const games = [
      game({ id: "g1", date: "2026-05-01" }),
      game({ id: "g2", date: "2026-05-03" }),
      game({ id: "g3", date: "2026-05-05" }),
    ];
    const result = awaitingScoreGames(games, "team_a", today);
    expect(result).toHaveLength(3);
  });

  it("interleaves home + away games correctly", () => {
    const games = [
      game({
        id: "as_away",
        date: "2026-05-01",
        away_team_id: "team_a",
        home_team_id: "team_b",
      }),
      game({
        id: "as_home",
        date: "2026-05-03",
        away_team_id: "team_c",
        home_team_id: "team_a",
      }),
    ];
    const result = awaitingScoreGames(games, "team_a", today);
    expect(result.map((r) => ({ id: r.game.id, side: r.side }))).toEqual([
      { id: "as_away", side: "away" },
      { id: "as_home", side: "home" },
    ]);
  });
});

// ── timezone defensiveness ────────────────────────────────────────

describe("awaitingScoreGames — date parsing", () => {
  it("handles bare yyyy-mm-dd dates (no time portion)", () => {
    const result = awaitingScoreGames(
      [game({ date: "2026-05-09" })], // yesterday
      "team_a",
      today,
    );
    expect(result).toHaveLength(1);
  });

  it("handles full ISO datetimes with time + Z", () => {
    const result = awaitingScoreGames(
      [game({ date: "2026-05-09T18:00:00Z" })],
      "team_a",
      today,
    );
    expect(result).toHaveLength(1);
  });

  it("handles full ISO datetimes without Z (locale-naive)", () => {
    const result = awaitingScoreGames(
      [game({ date: "2026-05-09T18:00:00" })],
      "team_a",
      today,
    );
    expect(result).toHaveLength(1);
  });
});
