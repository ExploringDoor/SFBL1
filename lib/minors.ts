// Minor eligibility + age-as-of-cutoff math.
//
// WHY THIS EXISTS
// Adult leagues let teenagers play, and the league is responsible for knowing
// which players are minors. Helena's own published rule: "A player must be
// fifteen (15) years of age by the end of the year (December 31) to be eligible
// to play. Any player under the age of 18 must have a signed permission form."
// Their commissioner's words: "we don't have anything flagging it and it makes
// it difficult to keep track of our minors that are playing."
//
// THE PRIVACY RULE THAT DRIVES THE SHAPE OF THIS FILE
// A date of birth is PII and lives ONLY at
//   leagues/{leagueId}/players/{playerId}/_private/contact.dob
// which firestore.rules gates to admin-or-self. The PUBLIC player doc is
// world-readable (`allow read: if true`). So nothing in here ever returns a DOB
// for public rendering — it returns a DERIVED age and a classification, and the
// caller decides where that is allowed to appear.
//
// NOTHING DERIVED FROM A DOB GOES ON THE PUBLIC DOC EITHER — not the flag,
// and not the age. Publishing "age as of X" solves the wrong half of the
// problem. It hides the birthday; it does not hide WHICH PEOPLE ON THIS FIELD
// ARE CHILDREN. In a youth league an age column discriminates nothing because
// everyone is a minor. Helena is the inverse: an adult league where a column of
// 20s-40s containing three 15s IS the minor flag, in a form easier to scan than
// a boolean.
//
// The concrete exposure, not a hypothetical:
//   - firestore.rules grants `allow read: if true` on the player doc, and
//     Firestore `read` covers `list`, so the collection is enumerable by
//     anyone, unauthenticated.
//   - The web API key ships to the browser as NEXT_PUBLIC_*, so a stranger can
//     query the Firestore REST API directly without ever loading the site.
//   - firestore.indexes.json declares no fieldOverrides, so Firestore
//     auto-creates a single-field index for any new field. `where("age", "<",
//     18)` would return every child in the league, already joined to name,
//     jersey and team_id — and one hop from the public schedule, which says
//     which field that child stands on at 7pm Tuesday.
//   - It would be silent. Nothing in this repo would show the index exists.
//
// So minor status is derived per-request behind auth and shown to captains and
// admins only. There is deliberately no per-tenant flag to publish it: an
// escape hatch for this is a footgun, and no consumer asked for one.
//
// CUTOFF SEMANTICS
// Leagues do not use "age today" — they use age as of a fixed date, so a
// player's status cannot change mid-season. The cutoff is stored as "MM-DD"
// and evaluated within the season year. Two real examples:
//   Helena (HSA):        "12-31", age_of_majority 18, min_age 15
//   Small Town Select:   "05-01"  (a different league, different codebase)

/** Per-tenant minor policy. Lives on LeagueConfig as `minors`. */
export interface MinorsPolicy {
  /** Below this age at the cutoff, a player is a minor. Typically 18. */
  age_of_majority: number;
  /** "MM-DD" — the date the age is computed as of. Helena: "12-31". */
  cutoff: string;
  /** Optional floor: below this at the cutoff, the player cannot play at all.
   *  Helena: 15. Omit when the league has no minimum. */
  min_age?: number;
  /** Minors need a signed parental consent form on file. Helena: true. */
  requires_consent?: boolean;
}

export type MinorStatus =
  /** At or above age_of_majority at the cutoff. */
  | "adult"
  /** Old enough to play, but under age_of_majority — needs consent on file. */
  | "minor"
  /** Below min_age at the cutoff — not eligible to play at all. */
  | "under_minimum"
  /** No usable DOB on file, so we cannot say. NOT the same as "adult". */
  | "unknown";

export interface AgeAssessment {
  status: MinorStatus;
  /** Age in whole years at the cutoff, or null when the DOB is missing/bad. */
  age: number | null;
  /** The ISO date the age was computed as of, e.g. "2026-12-31". */
  cutoffDate: string | null;
}

const DOB_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CUTOFF_RE = /^(\d{2})-(\d{2})$/;

/** Whole years between two civil dates. Pure integer math on Y/M/D — no Date
 *  objects, so there is no timezone or DST class of bug to have. */
function yearsBetween(
  from: { y: number; m: number; d: number },
  to: { y: number; m: number; d: number },
): number {
  let age = to.y - from.y;
  if (to.m < from.m || (to.m === from.m && to.d < from.d)) age -= 1;
  return age;
}

function parseDob(dob: string): { y: number; m: number; d: number } | null {
  const m = DOB_RE.exec(String(dob ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Reject a date that does not exist (e.g. 2010-02-30). Round-tripping
  // through UTC avoids the local-timezone rollover trap.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  // A DOB in the future, or implausibly old, is a typo rather than a person.
  const nowY = new Date().getUTCFullYear();
  if (y > nowY || y < nowY - 120) return null;
  return { y, m: mo, d };
}

/**
 * Age in whole years as of the policy cutoff within `seasonYear`.
 * Returns null when the DOB is missing or unparseable.
 */
export function ageAsOfCutoff(
  dob: string | null | undefined,
  cutoff: string,
  seasonYear: number,
): number | null {
  if (!dob) return null;
  const birth = parseDob(dob);
  if (!birth) return null;
  const c = CUTOFF_RE.exec(String(cutoff ?? "").trim());
  if (!c) return null;
  const age = yearsBetween(birth, {
    y: seasonYear,
    m: Number(c[1]),
    d: Number(c[2]),
  });
  return age >= 0 ? age : null;
}

/** ISO form of the cutoff inside a season year, for display: "2026-12-31". */
export function cutoffDateIso(cutoff: string, seasonYear: number): string | null {
  const c = CUTOFF_RE.exec(String(cutoff ?? "").trim());
  if (!c) return null;
  return `${seasonYear}-${c[1]}-${c[2]}`;
}

/**
 * Classify a player against the league's minor policy.
 *
 * A missing DOB yields "unknown", never "adult" — an unknown age is exactly
 * the case the commissioner needs surfaced, not silently treated as fine.
 */
export function assessPlayer(
  dob: string | null | undefined,
  policy: MinorsPolicy | null | undefined,
  seasonYear: number,
): AgeAssessment {
  if (!policy) return { status: "unknown", age: null, cutoffDate: null };
  const cutoffDate = cutoffDateIso(policy.cutoff, seasonYear);
  const age = ageAsOfCutoff(dob, policy.cutoff, seasonYear);
  if (age == null) return { status: "unknown", age: null, cutoffDate };
  if (typeof policy.min_age === "number" && age < policy.min_age) {
    return { status: "under_minimum", age, cutoffDate };
  }
  if (age < policy.age_of_majority) return { status: "minor", age, cutoffDate };
  return { status: "adult", age, cutoffDate };
}

/** Does this assessment require a parental consent form on file? */
export function needsConsent(
  a: AgeAssessment,
  policy: MinorsPolicy | null | undefined,
): boolean {
  if (!policy || policy.requires_consent === false) return false;
  return a.status === "minor" || a.status === "under_minimum";
}

/** Short human label for admin tables. */
export function statusLabel(status: MinorStatus): string {
  switch (status) {
    case "adult": return "Adult";
    case "minor": return "Minor";
    case "under_minimum": return "Under minimum age";
    case "unknown": return "No DOB on file";
  }
}
