import type {
  EligibilityResult,
  PitchCountRuleset,
  PitchOuting,
} from "./types";

/** Rest days required for a given pitch count under a ruleset. */
export function restDaysFor(
  pitches: number,
  ruleset: PitchCountRuleset,
): number {
  if (pitches <= 0) return 0;
  const tier = ruleset.tiers.find((t) => pitches >= t.min && pitches <= t.max);
  if (tier) return tier.restDays;
  // Above all tiers — use the top tier's rest (tiers are ascending).
  return ruleset.tiers[ruleset.tiers.length - 1]?.restDays ?? 0;
}

/**
 * Compute a pitcher's eligibility from their outings.
 *
 * Convention (documented for confirmation with the league):
 *   nextEligibleDate = lastOutingDate + restDays + 1 calendar day.
 *   i.e. after pitching, observe `restDays` full calendar days, then
 *   eligible the following day. 0 rest → eligible the next day.
 * The pitch-count → restDays mapping itself is exact from the rules; only
 * this day-count convention is an assumption.
 *
 * @param outings  all of this pitcher's outings (any order)
 * @param ruleset  the age group's ruleset
 * @param asOf     the date to evaluate against (ISO date), e.g. "today"
 */
export function computeEligibility(
  outings: PitchOuting[],
  ruleset: PitchCountRuleset,
  asOf: string,
): EligibilityResult {
  if (outings.length === 0) {
    return {
      status: "eligible",
      nextEligibleDate: null,
      lastOuting: null,
      restDaysRequired: 0,
      pitchesLast: 0,
    };
  }

  const sorted = [...outings].sort((a, b) =>
    dayOf(a.date).localeCompare(dayOf(b.date)),
  );
  const last = sorted[sorted.length - 1]!;
  const restDays = restDaysFor(last.pitches, ruleset);
  const nextEligibleDate = addDays(dayOf(last.date), restDays + 1);
  const status = dayOf(asOf) >= nextEligibleDate ? "eligible" : "resting";

  return {
    status,
    nextEligibleDate,
    lastOuting: last,
    restDaysRequired: restDays,
    pitchesLast: last.pitches,
  };
}

/** Normalize an ISO date or timestamp to a YYYY-MM-DD day string. */
function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/** Add N calendar days to a YYYY-MM-DD string (UTC math, day-only). */
function addDays(day: string, days: number): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
