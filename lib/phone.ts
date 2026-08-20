// US phone numbers, checked and normalised.
//
// The forms took phone as free text and stored whatever was typed. Alyssa
// Schroeder registered for the College Clinic three times on 2026-08-19 and
// two of the three carried a mistyped 11-digit number beginning 163, which
// reaches nobody. The one purpose of that field is letting the league phone a
// parent, and it was the one thing nothing checked.
//
// Pure and dependency-free: imported by the CLIENT form for instant feedback
// and by the API route as the authority. One implementation, so the two can
// never disagree about what a valid number is.
//
// REJECTING IS RIGHT HERE, unlike the bot checks in /api/league-form which
// now flag rather than drop. The difference is who is present: a bad phone is
// caught while the person is still looking at the form and can fix it in five
// seconds. A silently discarded submission is a customer lost.

export interface PhoneResult {
  ok: boolean;
  /** Normalised as 631-831-4793 when ok; the original trimmed input when not. */
  value: string;
  /** Shown to the person who typed it. Empty when ok. */
  reason: string;
}

/**
 * Accepts what Americans actually type: 6318314793, 631-831-4793,
 * (631) 831-4793, 631.831.4793, +1 631 831 4793, and the same with a leading
 * 1. Everything is judged on the digits alone, so punctuation never matters.
 */
export function normalizePhone(raw: unknown): PhoneResult {
  const input = String(raw ?? "").trim();
  if (!input) return { ok: false, value: "", reason: "Enter a phone number." };

  const digits = input.replace(/\D/g, "");

  // A leading 1 is the country code, not part of the number.
  const core = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  if (core.length < 10) {
    return {
      ok: false,
      value: input,
      reason: `That is only ${core.length} digit${core.length === 1 ? "" : "s"}. A US number needs 10.`,
    };
  }
  if (core.length > 10) {
    return {
      ok: false,
      value: input,
      reason: `That is ${core.length} digits. A US number is 10, or 11 starting with 1.`,
    };
  }

  // The North American plan allows neither an area code nor an exchange
  // beginning 0 or 1. This is the rule that catches the real error: "1631…"
  // typed without punctuation reads as area code 163, which cannot exist.
  const area = core.slice(0, 3);
  const exch = core.slice(3, 6);
  if (area[0] === "0" || area[0] === "1") {
    return {
      ok: false,
      value: input,
      reason: `${area} is not a real area code. Check the number, and leave off any country code.`,
    };
  }
  if (exch[0] === "0" || exch[0] === "1") {
    return {
      ok: false,
      value: input,
      reason: "That does not look like a real number. Check the digits after the area code.",
    };
  }

  return {
    ok: true,
    value: `${area}-${exch}-${core.slice(6)}`,
    reason: "",
  };
}

/** Field names carrying a phone number, across every form on the platform. */
export const PHONE_FIELDS = [
  "phone",
  "asst_phone",
  "emergency_phone",
  "lead_phone",
] as const;

/** True when this field should be phone-checked. */
export function isPhoneField(name: string): boolean {
  return (PHONE_FIELDS as readonly string[]).includes(name);
}
