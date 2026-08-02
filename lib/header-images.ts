// Map of page-slug -> public src for a tenant's header banner image. The
// image files live at public/<tenant>/headers/<slug>.jpg and are served by
// the CDN.
//
// IMPORTANT: this is a STATIC slug list, not a runtime fs scan. The previous
// version used fs.readdirSync(public/<tenant>/headers) — which works in local
// dev but returns nothing on Vercel serverless functions (they don't ship the
// public/ folder on disk), so every header banner silently disappeared on the
// deployed site. Driving it from a list keeps SSR identical everywhere.
//
// To add/remove a tenant's header banners: drop the <slug>.jpg into
// public/<tenant>/headers/ and update its entry here.
//
// An entry is either "slug" (file is <slug>.jpg) or ["slug", "file"] when one
// piece of artwork serves several routes. Island's "Information" dropdown is
// not a page of its own, so its banner is aliased onto the real pages that
// live under it.
type HeaderEntry = string | [slug: string, file: string];

const HEADER_SLUGS: Record<string, HeaderEntry[]> = {
  // Island Fastpitch. No playoffs banner: the only candidate was a Little
  // League BASEBALL image (boys in uniform, scoreboard reading "LITTLE LEAGUE")
  // left over from another build. Wrong sport and wrong league for a girls
  // fastpitch site. A slug with no file simply renders no banner.
  island: [
    "home",
    "scores",
    "schedule",
    "standings",
    "teams",
    "fields",
    "tournaments",
    "team-registration",
    "content-events-clinics",
    ["rules", "information"],
    ["player-ads", "information"],
    ["summer-league", "information"],
  ],
  coybl: [
    "home",
    "scores",
    "schedule",
    "standings",
    "teams",
    "tournaments",
    "eligibility",
    "power-rankings",
    "rules",
    "team-registration",
  ],
};

export function headerImagesFor(tenant: string | null): Record<string, string> {
  if (!tenant) return {};
  const entries = HEADER_SLUGS[tenant];
  if (!entries) return {};
  const map: Record<string, string> = {};
  for (const entry of entries) {
    const [slug, file] = typeof entry === "string" ? [entry, entry] : entry;
    map[slug] = `/${tenant}/headers/${file}.jpg`;
  }
  return map;
}

// Which banner a pathname asks for. Normally the first path segment, so /teams
// -> "teams". The exception is the CMS route /content/<pageId>, where the first
// segment is the same "content" for every page — those get "content-<pageId>"
// so each CMS page can carry its own artwork. Keep this in sync with the
// lookups in components/PageBanner.tsx.
export function bannerSlugFor(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "content" && parts[1]) return `content-${parts[1]}`;
  return parts[0] ?? "home";
}
