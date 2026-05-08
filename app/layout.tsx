import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Barlow_Condensed, Inter, Oswald } from "next/font/google";
import { TenantProvider } from "@/lib/tenant-context";
import { Nav } from "@/components/ui/Nav";
import { SiteFooter } from "@/components/ui/SiteFooter";
import { ProfileButton } from "@/components/ProfileButton";
import { PwaShell } from "@/components/PwaShell";
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
    const logo = cfg.theme?.logo_url;
    // OG image priority:
    //   1. /og-default.png — purpose-built 1200×630 share image
    //      (banner on navy gradient). Best aspect for FB / iMessage /
    //      Twitter previews.
    //   2. Tenant logo_url — fallback for tenants without a custom
    //      OG image. Aspect ratio may not be ideal but better than
    //      nothing.
    // Tenants who want their own per-page OG image override
    // generateMetadata in their page.tsx (e.g. team / player pages
    // do this with the team logo).
    const ogImage = [
      {
        url: "/og-default.png",
        width: 1200,
        height: 630,
        alt: `${name} — South Florida Baseball League`,
      },
      ...(logo ? [{ url: logo, alt: `${name} logo` }] : []),
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
      };
      leagueName = cfg.name ?? null;
      leagueAbbrev = cfg.abbrev;
      logoUrl = cfg.theme?.logo_url ?? null;
      themePrimary = cfg.theme?.primary;
      themeAccent = cfg.theme?.accent;
      themeSecondary = cfg.theme?.secondary;
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
          {tenantId && (
            <>
              <Ticker
                games={tickerGames}
                tenantShort={leagueAbbrev ?? leagueName ?? "League"}
                seasonYear={new Date().getFullYear()}
                logoUrl={logoUrl}
              />
              <TickerScrollHide />
              <TickerInputEnhancer />
            </>
          )}
          {tenantId ? (
            <Nav
              tenantShort={leagueAbbrev ?? leagueName ?? "League"}
              logoUrl={logoUrl}
              rightSlot={<ProfileButton tenantId={tenantId} />}
            />
          ) : null}
          <div className="site-content">{children}</div>
          {modal}
          {tenantId ? <SiteFooter /> : null}
          {/* PWA bottom tab bar — gates itself on standalone display
              mode (regular browser tabs see nothing). DVSL pattern. */}
          {tenantId ? <PwaTabBar /> : null}
          {/* Service-worker version pill — bottom-right debug stamp.
              Invaluable when triaging "I don't see your fix" reports:
              we ask the user to read off the version. Hides itself
              when there's no controlling SW. */}
          {tenantId ? <SwVersionPill /> : null}
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
