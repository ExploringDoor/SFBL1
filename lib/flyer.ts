// Flyers attached to a league broadcast.
//
// Mike, 2026-09-10: "In the admin under send message there's no way I can send
// a flyer." He posts flyers for tournaments and clinics, and a message that
// cannot carry one is a message he sends from his own phone instead.
//
// STORED PER SEND, NEVER OVERWRITTEN. An email lives in somebody's inbox for
// years and keeps asking for the image. A single "current flyer" document
// would mean every flyer he ever sent silently turning into the newest one,
// and eventually into a broken image. Each send gets its own id.
//
// Served as real bytes by /api/broadcast-flyer/... rather than inlined: mail
// clients strip or mangle data: URLs, and Gmail refuses them outright, so an
// inlined flyer is a blank space in the one place it has to show up.

/** Formats a mail client will actually render inline. No SVG: it can carry
 *  script, and this is served from the league's own origin. No PDF: it would
 *  show as a broken image in the body rather than as the flyer he expects. */
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Firestore caps a document at 1MB. Base64 inflates by about a third, and the
 *  rest of the document is small, so this leaves comfortable room. A phone
 *  photo of a flyer is usually well under it once resized client-side. */
export const MAX_FLYER_BYTES = 700_000;

export function isAllowedFlyerDataUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/.exec(raw);
  if (!m) return false;
  if (!ALLOWED.includes(m[1]!.toLowerCase())) return false;
  return raw.length <= MAX_FLYER_BYTES;
}

/** The public URL for a stored flyer. Absolute, because it is read from an
 *  inbox where a relative path means nothing. */
export function flyerUrl(origin: string, leagueId: string, flyerId: string): string {
  return `${origin}/api/broadcast-flyer/${encodeURIComponent(leagueId)}/${encodeURIComponent(flyerId)}`;
}
