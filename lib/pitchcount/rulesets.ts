import type { PitchCountRuleset, RestTier } from "./types";

// COYBL uses IDENTICAL rest tiers across every kid-pitch age group (USA
// Baseball Pitch Smart); only the per-game daily max differs (75 / 85 / 95).
// Confirmed from COYBL's 2026 rule books (9U–12U + 13U PDFs), 2026-06-18.
//
// Data-entry note (handled at entry, not here): if a pitcher crosses a tier
// mid–at-bat, the coach records the threshold count, not the overage
// ("finish the batter" exception). The engine just consumes the recorded count.
const STANDARD_TIERS: RestTier[] = [
  { min: 1, max: 20, restDays: 0 },
  { min: 21, max: 35, restDays: 1 },
  { min: 36, max: 50, restDays: 2 },
  { min: 51, max: 65, restDays: 3 },
  { min: 66, max: Infinity, restDays: 4 },
];

export const COYBL_9U_10U: PitchCountRuleset = {
  id: "9U-10U",
  label: "9U–10U",
  dailyMax: 75,
  tiers: STANDARD_TIERS,
};

export const COYBL_11U_12U: PitchCountRuleset = {
  id: "11U-12U",
  label: "11U–12U",
  dailyMax: 85,
  tiers: STANDARD_TIERS,
};

export const COYBL_13U_14U: PitchCountRuleset = {
  id: "13U-14U",
  label: "13U–14U",
  dailyMax: 95,
  tiers: STANDARD_TIERS,
};

export const PITCH_RULESETS: Record<string, PitchCountRuleset> = {
  "9U-10U": COYBL_9U_10U,
  "11U-12U": COYBL_11U_12U,
  "13U-14U": COYBL_13U_14U,
};

/**
 * Map a team's age group ("9U", "10U", "12U"…) to its ruleset id.
 * 9/10, 11/12, 13/14 each share a ruleset. 7U/8U are coach-pitch with no
 * pitcher rules → null (caller hides eligibility for those divisions).
 */
export function rulesetIdForAge(ageGroup: string): string | null {
  const n = parseInt(ageGroup.match(/\d+/)?.[0] ?? "", 10);
  if (Number.isNaN(n)) return null;
  if (n === 9 || n === 10) return "9U-10U";
  if (n === 11 || n === 12) return "11U-12U";
  if (n === 13 || n === 14) return "13U-14U";
  return null;
}
