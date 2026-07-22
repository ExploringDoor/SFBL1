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
const HEADER_SLUGS: Record<string, string[]> = {
  // Island Fastpitch. No playoffs banner: the only candidate was a Little
  // League BASEBALL image (boys in uniform, scoreboard reading "LITTLE LEAGUE")
  // left over from another build. Wrong sport and wrong league for a girls
  // fastpitch site. rules / fields / tournaments have no artwork yet either;
  // a slug with no file simply renders no banner.
  island: ["home", "scores", "schedule", "standings", "teams"],
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
  const slugs = HEADER_SLUGS[tenant];
  if (!slugs) return {};
  const map: Record<string, string> = {};
  for (const slug of slugs) map[slug] = `/${tenant}/headers/${slug}.jpg`;
  return map;
}
