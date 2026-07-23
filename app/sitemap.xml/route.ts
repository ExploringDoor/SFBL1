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
  const cfg = tenant.config;
  const statsOn = cfg.flags?.stats_enabled !== false;
  // Stats-off tenants (COYBL) emit no player URLs, so skip the (potentially
  // large — LBDC had ~1100 docs) players read entirely instead of fetching
  // it and discarding every row.
  const [teams, players, games, pages] = await Promise.all([
    db.collection(`leagues/${tenantId}/teams`).get(),
    statsOn ? db.collection(`leagues/${tenantId}/players`).get() : Promise.resolve(null),
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/page_content`).get(),
  ]);

  const now = new Date().toISOString();
  type Url = { loc: string; lastmod?: string; changefreq?: string };
  const urls: Url[] = [];

  // Static pages — tenant-aware so we don't list routes a tenant hides
  // (COYBL drops stats/photos/history/etc.) or omit its real pages
  // (Pitch Counts, Power Rankings, Tournaments). Mirrors the nav config.
  const navHide = new Set(
    (cfg.nav?.hide ?? [])
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.toLowerCase()),
  );
  const isSfbl = tenantId === "sfbl";

  const staticPages: string[] = ["/", "/schedule", "/scores", "/standings", "/teams"];
  if (statsOn) staticPages.push("/players");
  // Optional pages, each gated by its nav-hide label.
  const optional: [string, string][] = [
    ["/photos", "photos"],
    ["/rules", "rules"],
    ["/history", "history"],
    ["/player-registration", "player registration"],
    ["/team-registration", "team registration"],
    ["/team-waiver-form", "team waiver"],
    ["/umpire-evaluation-form", "umpire evaluation"],
  ];
  for (const [href, label] of optional) {
    if (!navHide.has(label)) staticPages.push(href);
  }
  // SFBL-only league-info pages.
  if (isSfbl) staticPages.push("/fields", "/sfbl-info");
  // Tenant-added nav links (COYBL: /eligibility, /power-rankings, /rules).
  // Walk children too. A tenant-added entry can be a dropdown (Island's
  // "Information" holds /player-ads and /rules), and a top-level-only walk
  // would quietly drop every page inside it from the sitemap. Parents use
  // href "#", which is skipped.
  const addHrefs = (links: Array<{ href?: string; children?: unknown }>) => {
    for (const l of links) {
      if (l?.href && l.href !== "#" && !staticPages.includes(l.href)) {
        staticPages.push(l.href);
      }
      if (Array.isArray(l?.children)) {
        addHrefs(l.children as Array<{ href?: string; children?: unknown }>);
      }
    }
  };
  addHrefs(cfg.nav?.add ?? []);
  // Tournaments page when the tenant lists events.
  if ((cfg.tournaments?.events?.length ?? 0) > 0 && !staticPages.includes("/tournaments")) {
    staticPages.push("/tournaments");
  }
  for (const p of staticPages) {
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

  // Player pages — `players` is null for stats-off tenants (we skipped the
  // read), so this loop no-ops there. Otherwise skip walk-ons until admin
  // approves (avoids indexing typo'd entries).
  for (const d of players?.docs ?? []) {
    const data = d.data();
    if (data.active === false) continue;
    if (data.walk_on === true) continue;
    // Audit H8: LBDC migration orphans (~1100 docs: status:"unknown"
    // / orphan:true, no `active` field) were sailing into the
    // sitemap, so Google would index thousands of stub
    // "player not found" pages. Same predicate as audit C1/H7 —
    // missing status still passes (SFBL legacy).
    if (data.orphan === true) continue;
    if (data.status && data.status !== "active") continue;
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

  // Custom pages render at /content/{id}, EXCEPT those with a dedicated
  // top-level route (rules -> /rules, fields -> /fields, player-ads ->
  // /player-ads). Emitting /content/{those} produced duplicate URLs for the
  // same content with no canonical. Also dedupe against anything already
  // listed (a nav.add entry like /content/events-clinics was appearing twice).
  const DEDICATED_ROUTE_SLUGS = new Set(["rules", "fields", "player-ads"]);
  const seen = new Set(urls.map((u) => u.loc));
  for (const d of pages.docs) {
    if (DEDICATED_ROUTE_SLUGS.has(d.id)) continue;
    const loc = `${origin}/content/${d.id}`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    urls.push({
      loc,
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
