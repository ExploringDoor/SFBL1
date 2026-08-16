/** Display a phone number as 614-507-6721.
 *
 *  Coaches type whatever they like. COYBL's contacts alone hold
 *  "614-507-6721", "6145787335", "+1 (614) 557-5015", "14192100938" and a
 *  bare "0", so the list read as a jumble.
 *
 *  Deliberately conservative: only US-shaped numbers are reformatted.
 *  Anything else is returned UNCHANGED rather than mangled — a genuine
 *  international number or an extension is better shown as the coach wrote it
 *  than chopped to fit a pattern it does not follow.
 */
export function formatPhone(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";

  const digits = s.replace(/\D/g, "");

  // 11 digits starting with 1 is the same number with a country code.
  const local =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  if (local.length !== 10) return s; // leave anything unexpected alone
  return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
}

/** Digits only, for a tel: href. Keeps a leading + so international numbers
 *  still dial. */
export function telHref(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return (s.startsWith("+") ? "+" : "") + s.replace(/\D/g, "");
}
