// Safe-coerce a Firestore-read stats object into a known-numeric
// Record<string, number>. Firestore docs are typed as `unknown` at
// the boundary; six pages were casting `.data().stats as
// Record<string, number>` directly to JSX and would have rendered
// "5.0" verbatim if a captain-side bug ever wrote a string into a
// numeric slot.
//
// Closes audit M3 + M4.
//
// Returns:
//   - null for null/undefined input (callers test for null)
//   - {} for non-object input (defensive)
//   - { ...numericValues } where every value is a finite number or 0

export function numericStats(
  input: unknown,
): Record<string, number> | null {
  if (input == null) return null;
  if (typeof input !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const n = Number(v);
    out[k] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

// Same shape but never returns null — for sites that always want
// an object to spread/reduce over.
export function numericStatsOrEmpty(
  input: unknown,
): Record<string, number> {
  return numericStats(input) ?? {};
}
