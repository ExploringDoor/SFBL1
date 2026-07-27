// Clean 2-3 letter initials from a team NAME. COYBL's scraped `abbrev` field
// is unreliable (some teams have the record there, e.g. "0-4-0", others have
// garbage like "MWWWM"), so badges derive from the name instead:
//   "MIDWEST MARLINS"      -> "MM"
//   "OLENTANGY STIX"       -> "OS"
//   "HILLIARD COLTS RED"   -> "HCR"
//   "BJE - LEMLE"          -> "BL"
export function initialsFromName(name: string | null | undefined): string {
  const words = String(name ?? "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
