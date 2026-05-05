// Per-tenant Web App Manifest. Served at /manifest.webmanifest.
//
// The browser fetches this when it sees `<link rel="manifest">` in
// the HTML head. Because each tenant has its own host (subdomain or
// custom domain), middleware injects `x-tenant-id` and
// `x-tenant-config-json` headers; we read those here and return a
// manifest customized to the league: name, short_name, theme color,
// icons, start_url. Result: when a captain installs the SFBL site,
// they get an SFBL-branded home-screen icon; KCSL captains get a
// KCSL-branded one — same code, different output per host.
//
// FUTURE: tenant config grows a `pwa_icon_url` (or we standardize
// `theme.logo_url` to be 512x512). For now we point at the tenant's
// logo_url and fall back to a generic asset if missing — bad-aspect
// or low-res icons will still install but look mediocre until the
// commissioner uploads proper PWA icons.

import { headers } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface TenantTheme {
  primary?: string;
  accent?: string;
  logo_url?: string;
}
interface TenantConfig {
  name?: string;
  abbrev?: string;
  short?: string;
  theme?: TenantTheme;
}

export function GET() {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  const configJson = h.get("x-tenant-config-json");
  let cfg: TenantConfig = {};
  if (configJson) {
    try {
      cfg = JSON.parse(configJson) as TenantConfig;
    } catch {
      /* fall through */
    }
  }

  const name = cfg.name ?? "League";
  const shortName = cfg.abbrev ?? cfg.short ?? tenantId ?? "League";
  const themeColor = cfg.theme?.primary ?? "#0a0e1c";
  const logoUrl = cfg.theme?.logo_url ?? "/logos/icon-512.png";

  const manifest = {
    name,
    short_name: shortName,
    description: `${name} — captain portal, schedule, scores, standings.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: themeColor,
    icons: [
      // Primary icon — used for the home-screen tile, splash screen,
      // task-switcher thumb. Browsers will scale this; ideally it's
      // a 512x512 PNG with the league logo on a brand-color
      // background.
      {
        src: logoUrl,
        sizes: "any",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
    categories: ["sports", "lifestyle"],
  };

  return NextResponse.json(manifest, {
    headers: {
      "content-type": "application/manifest+json",
      // Brief cache so a config change picks up within ~5 min on
      // installed PWAs without forcing reinstall.
      "cache-control": "public, max-age=300",
    },
  });
}
