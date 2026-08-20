// Shorten a full field/location string to just its venue name for compact
// display, e.g. "Ihde Field 810 Morgan St. Clyman, WI 53016" -> "Ihde Field".
// Windmill's schedule stores the whole address in one `field` value; on the
// schedule + preview cards we show only the venue name (linked to the field
// directory, where the full address + directions live). Entries that are an
// address with no venue name fall back to the segment before the first comma.
export function shortFieldName(full: string | null | undefined): string {
  if (!full) return full ?? "";
  let s = full.trim();
  // "Concord Field: W1240 Concord Center Dr." -> "Concord Field"
  const colon = s.indexOf(":");
  if (colon > 0) s = s.slice(0, colon);
  // Venue name = text before the first street-number token.
  const m = s.match(/^(.+?)[,\s]+\d/);
  let name = (m?.[1] ?? s).replace(/[,\s]+$/, "").trim();
  // Address-only (starts with a street number or directional like "N123"):
  // no venue name to pull, so use the leading segment before the first comma.
  if (!name || /^\d/.test(name) || /^[NSEW]\d/.test(name)) {
    name = (s.split(",")[0] ?? "").trim();
  }
  return name || full;
}
