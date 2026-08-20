// Pure, no imports. Deliberately its own file: the admin uploader is a CLIENT
// component and needs this, while lib/tournament-logos.ts pulls in the
// Firebase Admin SDK. Sharing one module would drag firebase-admin into the
// browser bundle, which webpack refuses to build.

/** "Phantom on the Diamond" → "phantom-on-the-diamond".
 *
 *  The same shape as the checked-in filenames, so a logo Mike uploads and one
 *  Adam commits are keyed identically and cannot become two competing entries
 *  for the same event. */
export function tournamentSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
