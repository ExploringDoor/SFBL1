import type { PitchCountRuleset } from "./types";

// COYBL 9U–10U pitch-count rules (confirmed from COYBL's posted rules,
// 2026-06-18): daily max 75; rest scales with pitches thrown that day.
export const COYBL_9U_10U: PitchCountRuleset = {
  id: "9U-10U",
  label: "9U–10U",
  dailyMax: 75,
  tiers: [
    { min: 1, max: 20, restDays: 0 },
    { min: 21, max: 35, restDays: 1 },
    { min: 36, max: 50, restDays: 2 },
    { min: 51, max: 65, restDays: 3 },
    { min: 66, max: Infinity, restDays: 4 },
  ],
};

// Registry by ruleset id. Other age groups have different thresholds
// (USA Baseball Pitch Smart) — TODO: pull 7U–8U (coach pitch, likely n/a),
// 11U–12U, 13U–14U from COYBL's full LEAGUE RULES page and add here.
export const PITCH_RULESETS: Record<string, PitchCountRuleset> = {
  "9U-10U": COYBL_9U_10U,
};

/**
 * Map a team's age group ("9U", "10U", "11U"…) to its ruleset id.
 * 9U and 10U share one ruleset. Returns null when no ruleset is defined
 * yet for that age group (caller can hide eligibility for that division).
 */
export function rulesetIdForAge(ageGroup: string): string | null {
  const n = parseInt(ageGroup.match(/\d+/)?.[0] ?? "", 10);
  if (Number.isNaN(n)) return null;
  if (n === 9 || n === 10) return "9U-10U";
  // TODO: 11/12, 13/14 once rules are pulled.
  return null;
}
