import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Barlow_Condensed, Inter, Oswald } from "next/font/google";
import { TenantProvider } from "@/lib/tenant-context";
import { Nav } from "@/components/ui/Nav";
import { SiteFooter } from "@/components/ui/SiteFooter";
import { ProfileButton } from "@/components/ProfileButton";
import { PwaShell } from "@/components/PwaShell";
import { ViewTracker } from "@/components/ViewTracker";
import { PwaTabBar } from "@/components/ui/PwaTabBar";
import { TickerScrollHide } from "@/components/ui/TickerScrollHide";
import { TickerInputEnhancer } from "@/components/ui/TickerInputEnhancer";
import { SwVersionPill } from "@/components/ui/SwVersionPill";
import { SwNavigateListener } from "@/components/SwNavigateListener";
import { Ticker } from "@/components/ui/Ticker";
import { loadTickerGames } from "@/lib/site-data";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const barlow = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["300", "400", "600", "700", "800", "900"],
  variable: "--font-barlow",
  display: "swap",
});
const oswald = Oswald({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-oswald",
  display: "swap",
});

// Per-tenant metadata. Reads the tenant config from middleware-set
// headers and produces a title / description / openGraph / twitter
// payload that's specific to the league being viewed. Without this,
// shares on iMessage / WhatsApp / X show the generic platform copy
// — a launch-day footgun for a tenant trying to look professional.
//
// Viewport — explicit so iOS Safari respects all the bits we want.
//   - width=device-width: scale to actual device width
//   - initial-scale=1: render 1:1 by default
//   - maximumScale=5 + userScalable=yes: keep accessibility pinch-
//     zoom available (HIG requirement)
//   - viewportFit=cover: enables `env(safe-area-inset-*)` so content
//     extends behind the iPhone notch and home indicator without
//     rendering under them (CSS in globals.css claims the bottom inset)
//   - themeColor: tints iOS Safari's status bar / address bar.
//     Static fallback here; we override per-tenant in the <head>
//     below using the league's primary color.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: "#0c2340",
};

// Per-page generateMetadata (in app/teams/[slug]/page.tsx, etc.) can
// override these for richer previews on specific pages.
export async function generateMetadata(): Promise<Metadata> {
  const h = headers();
  const configJson = h.get("x-tenant-config-json");
  if (!configJson) {
    return {
      title: "LeagueEngine",
      description:
        "Multi-tenant platform for amateur sports leagues — schedules, standings, stats, and captain tools.",
    };
  }
  try {
    const cfg = JSON.parse(configJson) as {
      name?: string;
      abbrev?: string;
      sport?: string;
      theme?: { logo_url?: string };
    };
    const name = cfg.name ?? "League";
    const abbrev = cfg.abbrev;
    const sport = cfg.sport === "softball" ? "softball" : "baseball";
    const description = `Schedule, scores, standings, and stats for ${name}${
      abbrev && abbrev !== name ? ` (${abbrev})` : ""
    }. Live ${sport} updates, team rosters, and captain tools.`;
    // ONE share image for link previews (iMessage / FB / Twitter): the
    // purpose-built 1200×630 og-default.png. This used to ALSO include
    // the tenant logo as a second image, which made iMessage render the
    // banner twice in the preview card (Adam, 2026-06). Per-page
    // overrides (team / player pages) still set their own image in
    // their own generateMetadata.
    const ogImage = [
      {
        url: "/og-default.png",
        width: 1200,
        height: 630,
        alt: name,
      },
    ];

    return {
      title: { default: name, template: `%s · ${abbrev ?? name}` },
      description,
      openGraph: {
        title: name,
        description,
        siteName: name,
        type: "website",
        images: ogImage,
      },
      twitter: {
        card: "summary_large_image",
        title: name,
        description,
        images: ogImage,
      },
    };
  } catch {
    return {
      title: "LeagueEngine",
      description: "Schedule, scores, standings, and stats.",
    };
  }
}

export default async function RootLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  const configJson = h.get("x-tenant-config-json");
  let leagueName: string | null = null;
  let leagueAbbrev: string | undefined;
  let logoUrl: string | null = null;
  let themePrimary: string | undefined;
  let themeAccent: string | undefined;
  let themeSecondary: string | undefined;
  let navHideLabels: string[] = [];
  if (configJson) {
    try {
      const cfg = JSON.parse(configJson) as {
        name?: string;
        abbrev?: string;
        theme?: {
          primary?: string;
          accent?: string;
          secondary?: string;
          logo_url?: string;
        };
        nav?: { hide?: string[] };
      };
      leagueName = cfg.name ?? null;
      leagueAbbrev = cfg.abbrev;
      logoUrl = cfg.theme?.logo_url ?? null;
      themePrimary = cfg.theme?.primary;
      themeAccent = cfg.theme?.accent;
      themeSecondary = cfg.theme?.secondary;
      // Tenant can hide specific nav labels — e.g. LBDC doesn't use
      // a /news page so it sets nav.hide = ["News"]. Hidden labels
      // are matched case-insensitively against the link's label.
      if (Array.isArray(cfg.nav?.hide)) {
        navHideLabels = cfg.nav!.hide!
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.toLowerCase());
      }
    } catch {
      /* fall through */
    }
  }

  const tickerGames = tenantId ? await loadTickerGames(tenantId) : [];

  // Tenant overrides become inline custom-properties on <html>. CSS
  // throughout the app uses `var(--brand-primary, fallback)` so any
  // not-overridden var lands on the :root default in globals.css.
  const themeStyle = [
    themePrimary ? `--brand-primary: ${themePrimary};` : "",
    themeAccent ? `--brand-accent: ${themeAccent};` : "",
    themeSecondary ? `--brand-secondary: ${themeSecondary};` : "",
  ].join(" ");

  return (
    <html
      lang="en"
      className={`${inter.variable} ${barlow.variable} ${oswald.variable}`}
      style={
        themeStyle ? ({ ...parseStyle(themeStyle) } as React.CSSProperties) : undefined
      }
    >
      <head>
        {/* DNS prefetch + preconnect for Firebase services. The first
            Firestore read pays a TCP + TLS handshake otherwise; doing
            it during the browser's idle bytes after HTML parse means
            the handshake is already warm by the time client-side
            Firestore SDK fires.
              - firestore.googleapis.com  — Firestore REST/gRPC
              - firebaseinstallations.googleapis.com — Auth state
              - fcm.googleapis.com — Push subscribe path
            crossOrigin="" is critical: preconnect without it doesn't
            actually warm the TLS session, just DNS. */}
        <link rel="preconnect" href="https://firestore.googleapis.com" crossOrigin="" />
        <link rel="preconnect" href="https://firebaseinstallations.googleapis.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://fcm.googleapis.com" />
        <link rel="dns-prefetch" href="https://identitytoolkit.googleapis.com" />

        {/* Per-tenant PWA manifest. Served by /app/manifest.webmanifest/route.ts
            which reads the tenant config from headers and customizes name +
            theme + icons. Browsers re-fetch on each page load when scoped
            to "" or referenced relatively, so config changes propagate
            without forcing reinstall. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        {themePrimary && (
          <meta name="theme-color" content={themePrimary} />
        )}
        {/* iOS — Safari uses apple-touch-icon for the home-screen tile.
            We always serve the prebuilt 180x180 (square, brand-bg)
            icon rather than the tenant's banner logo_url, because
            wide banners get distorted into the rounded-square iOS
            tile. Generated alongside the manifest icons by
            scripts/build-pwa-icons.js. */}
        {/* Per-tenant browser-tab favicon. The PNG icons below are
            built from the SFBL brand, so every tenant was showing the
            SFBL icon in the tab. LBDC gets its own letters-only SVG
            favicon; an SVG `<link rel="icon">` takes priority over the
            PNGs in modern browsers, so the tab shows "LBDC" while the
            PNGs stay as the PWA / older-browser fallback. (Adam,
            2026-05-18.) Add a tenant here as each gets its own mark. */}
        {leagueAbbrev === "LBDC" && (
          <link rel="icon" type="image/svg+xml" href="/lbdc/favicon.svg" />
        )}
        {leagueAbbrev === "SFBL" && (
          <link rel="icon" type="image/svg+xml" href="/sfbl/favicon.svg" />
        )}
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icons/icon-512.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        {leagueName && (
          <meta name="apple-mobile-web-app-title" content={leagueName} />
        )}
      </head>
      <body className="site-shell antialiased">
        <TenantProvider tenantId={tenantId} configJson={configJson}>
          {/* SW NAVIGATE listener — handles push-tap when the PWA is
              already open. Mounted at the layout level so every page
              has it. See components/SwNavigateListener.tsx for why
              this matters more on App Router than vanilla DVSL. */}
          <SwNavigateListener />
          {/* Service-worker registration + install prompt. Independent
              of push-enable so PWA install works for users who don't
              opt into pushes. */}
          <PwaShell />
          {/* Site-visit counter — counts a visit per browser session on
              public pages (skips admin/captain), read on the admin
              Health tab. (Adam, 2026-06.) */}
          {tenantId && <ViewTracker />}
          {tenantId && (
            <>
              <Ticker
                games={tickerGames}
                tenantShort={leagueAbbrev ?? leagueName ?? "League"}
                seasonYear={new Date().getFullYear()}
                logoUrl={logoUrl}
                // SFBL: drop the big wordmark in the top-left so the
                // ticker is all scores (Adam, 2026-05-18). Branding
                // still lives in the nav + homepage Hero.
                hideLabel={leagueAbbrev === "SFBL"}
              />
              <TickerScrollHide />
              <TickerInputEnhancer />
            </>
          )}
          {tenantId ? (
            // Nav brand intentionally rendered as the tenant short
            // text (no logoUrl passed) so the league banner doesn't
            // show up twice in the top stack — the ticker already
            // shows it on its leftmost tile, and the homepage Hero
            // shows it full-width. Three identical banners felt
            // redundant; Adam called this out 2026-05-14.
            <Nav
              tenantShort={leagueAbbrev ?? leagueName ?? "League"}
              logoUrl={null}
              hideLabels={navHideLabels}
              rightSlot={<ProfileButton tenantId={tenantId} />}
            />
          ) : null}
          <div className="site-content">{children}</div>
          {modal}
          {tenantId ? <SiteFooter /> : null}
          {/* PWA bottom tab bar — gates itself on standalone display
              mode (regular browser tabs see nothing). DVSL pattern. */}
          {tenantId ? (
            <PwaTabBar
              hideLabels={navHideLabels}
              tenantShort={leagueAbbrev ?? leagueName ?? undefined}
            />
          ) : null}
          {/* Service-worker version pill removed — Adam saw it as
              user-visible noise. Re-mount during debug if needed:
              {tenantId ? <SwVersionPill /> : null} */}
        </TenantProvider>
      </body>
    </html>
  );
}

function parseStyle(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of s.split(";")) {
    const trimmed = decl.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}
