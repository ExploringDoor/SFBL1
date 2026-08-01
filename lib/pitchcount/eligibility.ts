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

  // Pitch Smart rest tiers are defined on pitches thrown IN A DAY (see
  // RestTier.min/max), so a pitcher who appears twice in one day — a
  // doubleheader, or a start plus a relief stint — must be judged on that
  // DAY'S TOTAL. Summing first is the safety-critical step: 40 + 40 in one
  // day is a 4-rest-day 80, not two 2-rest-day 40s.
  const byDay = new Map<string, number>();
  for (const o of outings) {
    const day = dayOf(o.date);
    const p = Number(o.pitches);
    byDay.set(day, (byDay.get(day) ?? 0) + (Number.isFinite(p) ? p : 0));
  }

  // Every day imposes its own rest window. Take the LATEST window that is
  // still pending, not simply the most recent day: if a pitcher threw 70 on
  // Monday (4 days rest) and then — against the rules — threw 10 on Tuesday,
  // Monday's window still governs. Using only the last day would clear them
  // early, which is the failure this feature exists to prevent.
  let governingDay = "";
  let governingPitches = 0;
  let governingRest = 0;
  let nextEligibleDate = "";
  for (const [day, pitches] of byDay) {
    const rest = restDaysFor(pitches, ruleset);
    const eligibleOn = addDays(day, rest + 1);
    // Ties resolve to the later day so the reported outing is the recent one.
    if (
      eligibleOn > nextEligibleDate ||
      (eligibleOn === nextEligibleDate && day > governingDay)
    ) {
      nextEligibleDate = eligibleOn;
      governingDay = day;
      governingPitches = pitches;
      governingRest = rest;
    }
  }

  const status = dayOf(asOf) >= nextEligibleDate ? "eligible" : "resting";

  return {
    status,
    nextEligibleDate,
    // The day that governs rest, carrying that day's TOTAL pitches (which is
    // what the eligibility board should show — not one appearance of several).
    lastOuting: { date: governingDay, pitches: governingPitches },
    restDaysRequired: governingRest,
    pitchesLast: governingPitches,
    dailyMaxExceeded: governingPitches > ruleset.dailyMax,
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
