// Age helpers shared by the admin roster + the form-submission reviewer
// (Nelson, 2026-07: age-division eligibility checks).

// Whole years old from a "YYYY-MM-DD" date of birth. Null if the string
// isn't a parseable date. Uses noon-UTC to dodge timezone off-by-one.
export function ageFromDob(s: string | null | undefined): number | null {
  if (!s) return null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!ymd) return null;
  const dob = new Date(`${ymd[1]}-${ymd[2]}-${ymd[3]}T12:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const before =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() &&
      now.getUTCDate() < dob.getUTCDate());
  if (before) age--;
  return age;
}

// Minimum age a division requires, parsed from names like "18+", "28+",
// "35+ American". Returns null when the division carries no age minimum
// (blank, "—", "Open", etc.) so callers skip the eligibility flag.
export function divisionMinAge(
  division: string | null | undefined,
): number | null {
  if (!division) return null;
  const m = /(\d{1,2})\s*\+/.exec(division);
  return m ? Number(m[1]) : null;
}
