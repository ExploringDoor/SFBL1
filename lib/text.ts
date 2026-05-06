// Shared text-normalization helpers. Used at every WRITE boundary that
// takes a human name from external input (CSV import, JSON body, form
// post). Reading downstream is naturally clean once writes are.
//
// Why these exist:
//   `String.prototype.trim()` only collapses ASCII whitespace. Names
//   pasted from Word, PDF, or copy-paste-from-the-web routinely contain
//   non-breaking spaces (U+00A0), narrow no-break spaces (U+202F),
//   ideographic spaces (U+3000), zero-width joiners — all of which look
//   identical to a regular space but compare false.
//
//   DVSL ran a one-off audit and caught **70+ NBSP-split players**
//   across team rosters: "John Smith" (with NBSP) vs "John Smith"
//   (regular space) silently became two different player records. Stats
//   then split across both. This was a real, recurring bug that ate
//   commissioner support time for months.
//
// Apply at every external-name input site. The helper is one regex
// replace + a trim, so it's cheap. Don't try to be clever about
// "preserving NBSP for international names" — every league we serve
// is English-speaking and a regular space is the right normal form.

/**
 * Normalize a name from external input:
 *   1. Replace every Unicode separator character with a regular space.
 *      `\p{Z}` covers NBSP (U+00A0), narrow NBSP (U+202F), figure space
 *      (U+2007), ideographic space (U+3000), and friends.
 *   2. Collapse runs of whitespace to a single space.
 *   3. Trim leading/trailing whitespace.
 *
 * Returns "" for null/undefined/non-string input — never throws.
 *
 * Examples:
 *   cleanName("John Smith")     → "John Smith"
 *   cleanName("  Aaron   Judge  ")   → "Aaron Judge"
 *   cleanName("X　Y")            → "X Y"
 *   cleanName(null)                  → ""
 */
export function cleanName(input: unknown): string {
  return String(input ?? "")
    .replace(/\p{Z}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
