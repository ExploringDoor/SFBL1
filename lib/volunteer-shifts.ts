// The snack-bar / volunteer PII boundary, in one place.
//
// A shift claim carries the volunteer's name, email and phone. The public
// shift board is world-readable, so it must carry none of that — a parent
// signing up to run the snack bar has not agreed to publish their phone
// number on the league website.
//
// `projectPublicClaim` is the ONLY thing that should build the public side of
// a claim. It copies an explicit allow-list rather than spreading the
// submission, so a field added to the form later cannot reach the public doc
// by accident. Same rule, and same reasoning, as lib/player-ads.ts.

/** What a claim looks like once it is safe to show the world. */
export interface PublicClaim {
  /** "Sarah M." — enough for a volunteer to recognise their own slot and for
   *  the league to see the shift is covered, without publishing a full name. */
  display_name: string;
  claimed_at: string;
}

export interface ClaimInput {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
}

/** First name + last initial. "Sarah Mitchell" -> "Sarah M." A single-word
 *  name is returned as-is; nothing is invented. */
export function displayName(fullName: string): string {
  const parts = String(fullName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  const last = parts[parts.length - 1]!;
  return `${parts.slice(0, -1).join(" ")} ${last[0]!.toUpperCase()}.`;
}

/** Build the public claim. Allow-list by construction: this function cannot
 *  emit a contact field because it never reads one. */
export function projectPublicClaim(
  input: ClaimInput,
  nowIso: string,
): PublicClaim | null {
  const name = displayName(String(input.name ?? ""));
  if (!name) return null;
  return { display_name: name, claimed_at: nowIso };
}

/** Normalise and bound-check the private side of a claim. Returns null when
 *  there is no usable name, which is the one genuinely required field. */
export function normaliseClaim(
  input: ClaimInput,
): { name: string; email: string; phone: string } | null {
  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!name) return null;
  const email = String(input.email ?? "").trim().slice(0, 160);
  const phone = String(input.phone ?? "").trim().slice(0, 40);
  return { name, email, phone };
}

/** A shift as stored. `claims` holds only projected public claims. */
export interface Shift {
  id: string;
  date: string;
  start: string;
  end?: string;
  location?: string;
  /** How many volunteers this shift needs. */
  slots: number;
  claims: PublicClaim[];
  note?: string;
}

/** Slots still open. Never negative, even if a shift's size is reduced after
 *  people have already signed up. */
export function openSlots(s: Pick<Shift, "slots" | "claims">): number {
  return Math.max(0, (s.slots ?? 0) - (s.claims?.length ?? 0));
}
