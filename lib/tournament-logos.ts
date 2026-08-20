// Tournament logos Mike can change himself.
//
// The slate (dates, prices, names) is a checked-in JSON file, which means
// every change routes through Adam. That was tolerable for a date; it stopped
// being tolerable for logos, which arrive in ones and twos all season and
// arrived four times in one evening (2026-08-19).
//
// So logos ONLY are overridable from the admin. The events themselves stay in
// the file. That is a deliberately small cut: it removes the request that
// actually recurs without building a whole tournament CMS tonight.
//
// STORED AS DATA URLS ON FIRESTORE DOCS, one doc per tournament, exactly like
// team logos in /api/captain-team-logo. No Storage bucket to provision, no
// bucket rules to get wrong, and no second place for an image to go missing.
// One doc each rather than one doc for all thirteen: a Firestore document is
// capped at 1MB and thirteen logos in a single doc would blow through it.
//
// PRECEDENCE: an uploaded logo beats the file. Clearing it falls back to
// whatever is checked in, so Mike can experiment without destroying the
// original art.

import { getAdminDb } from "@/lib/firebase-admin";

// Re-exported so server callers have one import rather than two.
export { tournamentSlug } from "@/lib/tournament-slug";

/**
 * Every admin-uploaded logo for a league, keyed by slug.
 *
 * Never throws: a tournaments page that 500s because a logo lookup failed is
 * far worse than one showing the checked-in art. Returns {} on any problem,
 * which is exactly the "no overrides" case.
 */
export async function loadTournamentLogos(
  tenantId: string,
): Promise<Record<string, string>> {
  try {
    const snap = await getAdminDb()
      .collection(`leagues/${tenantId}/tournament_logos`)
      .get();
    const out: Record<string, string> = {};
    for (const d of snap.docs) {
      const logo = d.data()?.logo;
      if (typeof logo === "string" && logo.startsWith("data:image/")) {
        out[d.id] = logo;
      }
    }
    return out;
  } catch (err) {
    console.error("[tournament-logos] load failed", err);
    return {};
  }
}
