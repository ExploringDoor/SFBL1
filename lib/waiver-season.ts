// Which season's waiver counts right now.
//
// One constant, because three places have to agree: the roster gate that asks
// for it, the team stamp that records it, and the admin reading it back. A
// literal in any one of them would eventually drift and quietly stop asking.
//
// Deliberately manual rather than derived from the date. A league's Fall runs
// into the next calendar year and the changeover is an office decision, not a
// calendar one, so guessing it from `new Date()` would flip the waiver over on
// 1 January and re-ask every coach mid-season.
export const CURRENT_WAIVER_SEASON = "fall-2026";

/** "fall-2026" -> "Fall 2026". */
export function waiverSeasonLabel(season: string): string {
  const m = /^([a-z]+)-(\d{4})$/i.exec(season.trim());
  if (!m) return season;
  return `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1).toLowerCase()} ${m[2]}`;
}
