// The Player Ads PII boundary, in one place.
//
// A submitted ad carries the poster's name, email and phone. The public board
// at /leagues/{id}/player_ads must carry none of that: these are 8U-18U
// players, and that collection is world-readable.
//
// `projectPublicAd` is the ONLY thing that should ever build a public ad
// document. It copies an explicit allow-list rather than spreading the
// submission, so a field added to the intake form later cannot reach the
// public doc by accident — someone has to come here and add it deliberately.
//
// Lives in lib/ rather than in the route because a Next.js route module may
// only export HTTP handlers and known config keys; exporting the constant from
// there fails the build. Keeping it here also lets the test import the real
// function instead of re-implementing it, so the test actually guards the
// shipped code path.

/** The only fields permitted on a public player ad. No contact fields. Ever. */
export const PUBLIC_AD_FIELDS = [
  "posted_by",
  "age_group",
  "position",
  "town",
  "team_name",
  "message",
] as const;

/** Build the public board document from a raw submission. Allow-list copy. */
export function projectPublicAd(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const pub: Record<string, unknown> = {};
  for (const f of PUBLIC_AD_FIELDS) {
    if (data[f] != null && data[f] !== "") pub[f] = data[f];
  }
  return pub;
}
