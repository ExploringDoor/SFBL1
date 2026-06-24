// Pitch-count / pitcher-eligibility tracking (USA Baseball "Pitch Smart"
// style). Youth leagues mandate per-outing rest based on pitches thrown.
// This is a SAFETY/compliance feature, distinct from performance stats —
// it stays on even for stats-off tenants like COYBL.

export interface RestTier {
  /** Inclusive lower bound of pitches thrown in a day. */
  min: number;
  /** Inclusive upper bound (use Infinity for the top tier). */
  max: number;
  /** Calendar days of rest required after throwing in this tier. */
  restDays: number;
}

export interface PitchCountRuleset {
  /** Stable id, e.g. "9U-10U". */
  id: string;
  /** Display label, e.g. "9U–10U". */
  label: string;
  /** Hard cap on pitches in a single day/game. */
  dailyMax: number;
  /** Rest tiers, ascending by pitch count. */
  tiers: RestTier[];
}

/** A single appearance: the date pitched and how many pitches were thrown. */
export interface PitchOuting {
  /** ISO date — date-only (YYYY-MM-DD) or a full timestamp; only the day is used. */
  date: string;
  pitches: number;
}

export type EligibilityStatus = "eligible" | "resting";

export interface EligibilityResult {
  status: EligibilityStatus;
  /** Date the pitcher is next eligible (ISO date), or null if never pitched. */
  nextEligibleDate: string | null;
  /** The most recent outing that governs current rest, or null. */
  lastOuting: PitchOuting | null;
  /** Rest days required from that last outing. */
  restDaysRequired: number;
  /** Pitches thrown in that last outing. */
  pitchesLast: number;
}
