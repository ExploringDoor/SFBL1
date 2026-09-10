// Sport-specific wording for surfaces every tenant shares.
//
// The data model is sport-neutral (games carry away_score / home_score,
// standings compute W/L/PCT and a differential) — only the WORDS are
// baseball-shaped: "runs", "RS/RA", "fields", "diamond". A basketball league
// reads those as someone else's site. Everything that needs a sport-aware
// noun asks here, so adding a sport is one function each rather than a grep
// across the pages.
//
// Pure and client-safe: no imports beyond the config type.

import type { Sport } from "@/lib/types";

/** Header labels for the for / against / differential standings columns. */
export interface ScoreLabels {
  for: string;
  against: string;
  diff: string;
}

/** Accepts the parsed tenant header's loose `sport?: string` as well as the
 *  typed union, so callers that only have the JSON need no cast. */
type SportLike = Sport | string | null | undefined;

export function scoreLabels(sport: SportLike): ScoreLabels {
  return sport === "basketball"
    ? { for: "PF", against: "PA", diff: "DIFF" }
    : { for: "RS", against: "RA", diff: "DIFF" };
}

/** The thing a team scores: "Total points scored" vs "Total runs scored". */
export function scoreUnit(sport: SportLike): "points" | "runs" {
  return sport === "basketball" ? "points" : "runs";
}

/** The sport as a plain noun for copy such as the meta description. Unknown
 *  or missing falls back to baseball, which is what the layout assumed before
 *  this helper existed. */
export function sportNoun(
  sport: SportLike,
): "softball" | "baseball" | "basketball" {
  if (sport === "softball") return "softball";
  if (sport === "basketball") return "basketball";
  return "baseball";
}

/** The game clock's position for the live scoreboard: "TOP 3" / "BOT 3" for
 *  a bat-and-ball sport, "Q3" / "OT" / "2OT" for basketball. `period` is the
 *  game doc's current_inning, which basketball reuses as the quarter. */
export function periodLabel(
  sport: SportLike,
  period: number,
  half?: "top" | "bottom" | string | null,
): string {
  const p = Math.max(1, Math.floor(Number(period) || 1));
  if (sport === "basketball") {
    if (p <= 4) return `Q${p}`;
    return p === 5 ? "OT" : `${p - 4}OT`;
  }
  return `${half === "bottom" ? "BOT" : "TOP"} ${p}`;
}

/** Where games are played. The /fields route and the admin tab keep their
 *  key; only what the visitor reads changes. */
export function venueLabels(sport: SportLike): {
  singular: string;
  plural: string;
  blurb: string;
} {
  if (sport === "basketball") {
    return {
      singular: "Gym",
      plural: "Gyms",
      blurb:
        "Every gym the league plays in, on one map. Search the list or tap a pin for one-tap driving directions.",
    };
  }
  return {
    singular: "Field",
    plural: "Fields",
    blurb:
      "Every diamond the league plays at on one interactive map. Search the list or tap a pin for one-tap driving directions.",
  };
}
