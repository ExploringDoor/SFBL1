// Per-tenant sitemap.xml — lists every public URL for the active
// tenant so Google can crawl the league's pages efficiently.
//
// Includes: home, schedule, scores, standings, teams index, every
// individual team page, every player page, every game page, the
// content pages (rules, news, register, etc.).
//
// Excluded: /admin, /captain, /profile, /api, /print — same as
// robots.txt.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { parseHost, resolveTenant } from "@/lib/tenants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const h = headers();
  const host =
    h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  const tenant = await resolveTenant(parseHost(host));
  if (!tenant) {
    return new Response('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" />', {
      headers: { "content-type": "application/xml; charset=utf-8" },
    });
  }
  const tenantId = tenant.id;

  const db = getAdminDb();
  const [teams, players, games, pages] = await Promise.all([
    db.collection(`leagues/${tenantId}/teams`).get(),
    db.collection(`leagues/${tenantId}/players`).get(),
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/page_content`).get(),
  ]);

  const now = new Date().toISOString();
  type Url = { loc: string; lastmod?: string; changefreq?: string };
  const urls: Url[] = [];

  // Static high-traffic pages — daily refresh hint.
  for (const p of [
    "/",
    "/schedule",
    "/scores",
    "/standings",
    "/teams",
    "/players",
    "/photos",
    "/rules",
    "/history",
    "/fields",
    "/sfbl-info",
    "/player-registration",
    "/team-registration",
    "/team-waiver-form",
    "/umpire-evaluation-form",
  ]) {
    urls.push({ loc: `${origin}${p}`, lastmod: now, changefreq: "daily" });
  }

  // Team pages
  for (const d of teams.docs) {
    if (d.data().active === false) continue;
    urls.push({
      loc: `${origin}/teams/${d.id}`,
      lastmod: now,
      changefreq: "weekly",
    });
  }

  // Player pages — skip walk-ons until admin approves (avoids Google
  // indexing typo'd or rejected entries).
  for (const d of players.docs) {
    const data = d.data();
    if (data.active === false) continue;
    if (data.walk_on === true) continue;
    urls.push({
      loc: `${origin}/players/${d.id}`,
      lastmod: now,
      changefreq: "weekly",
    });
  }

  // Game pages — finals get higher priority, scheduled lower.
  for (const d of games.docs) {
    const status = String(d.data().status ?? "");
    if (status === "draft") continue;
    urls.push({
      loc: `${origin}/games/${d.id}`,
      lastmod: now,
      changefreq: status === "final" || status === "approved"
        ? "monthly"
        : "daily",
    });
  }

  // Custom pages — rules render at /rules (already in static list),
  // others at /content/{id}.
  for (const d of pages.docs) {
    if (d.id === "rules") continue;
    urls.push({
      loc: `${origin}/content/${d.id}`,
      lastmod:
        typeof d.data().updated_at === "string"
          ? String(d.data().updated_at)
          : now,
      changefreq: "monthly",
    });
  }

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map(
        (u) =>
          `  <url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}${u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : ""}</url>`,
      )
      .join("\n") +
    "\n</urlset>\n";

  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
