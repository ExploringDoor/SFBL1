// Lightweight, conservative spam heuristic for public form submissions.
//
// The honeypot (a hidden "website" field) catches lazy bots, but some POST
// gibberish straight to /api/league-form and skip it. Those submissions
// have a very recognizable shape — random-case tokens no human types
// ("BFPXoiXJKFzeovzU"), consonant-soup cities ("Dwymtwyaq"), the same
// position picked twice. This scores those signals so we can flag the
// entry (kept, never deleted) and skip the notification email.
//
// Deliberately conservative: a single odd field is NOT enough. Real
// registrations — including unusual South-Florida names — score 0 because
// the strongest signal (random internal capitalization) never occurs in a
// name a person actually types.

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// Does this look like a random bot token rather than a real word/name?
export function isGibberish(raw: unknown): boolean {
  const w = str(raw);
  if (w.length < 6) return false; // short names/cities are fine

  // 1) Random internal capitalization — count lowercase→UPPERCASE flips
  //    inside the token. "BFPXoiXJKF" / "eqITgOQrdi" trip this; "Rodriguez"
  //    never does. This alone is a near-certain bot tell.
  let flips = 0;
  for (let i = 1; i < w.length; i++) {
    if (/[a-z]/.test(w[i - 1]!) && /[A-Z]/.test(w[i]!)) flips++;
  }
  if (flips >= 2) return true;

  // 2) A long run of consonants (y counts) — "Dwymtwyaq", "Zxcvbn".
  if (/[bcdfghjklmnpqrstvwxyz]{5,}/i.test(w)) return true;

  // 3) Very low vowel ratio across a longish token.
  const letters = (w.match(/[a-z]/gi) || []).length;
  const vowels = (w.match(/[aeiou]/gi) || []).length;
  if (letters >= 8 && vowels / letters < 0.2) return true;

  return false;
}

// Returns true when a submission looks like bot spam. Score-based so no
// single weak signal flags a real person (threshold 3; a gibberish name is
// worth 2, so it always takes a second signal to trip).
export function looksLikeSpam(data: Record<string, unknown>): boolean {
  let score = 0;

  // Name fields (player OR team-manager) — the strongest signal.
  for (const k of [
    "first_name",
    "last_name",
    "manager_first_name",
    "manager_last_name",
  ]) {
    if (isGibberish(data[k])) score += 2;
  }

  // Supporting signals.
  if (isGibberish(data.city)) score += 1;
  if (isGibberish(data.team_name)) score += 1;

  // Same primary + secondary position is a common bot pattern (it just
  // picks the first <option> twice).
  const p = str(data.primary_position);
  const s = str(data.secondary_position);
  if (p && p === s) score += 1;

  return score >= 3;
}
