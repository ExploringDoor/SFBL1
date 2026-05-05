import type { Metadata } from "next";
import { headers } from "next/headers";
import { Barlow_Condensed, Inter, Oswald } from "next/font/google";
import { TenantProvider } from "@/lib/tenant-context";
import { Nav } from "@/components/ui/Nav";
import { ProfileButton } from "@/components/ProfileButton";
import { PwaShell } from "@/components/PwaShell";
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

export const metadata: Metadata = {
  title: "League Platform",
  description: "Multi-tenant SaaS for amateur sports leagues.",
};

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
        {/* Per-tenant PWA manifest. Served by /app/manifest.webmanifest/route.ts
            which reads the tenant config from headers and customizes name +
            theme + icons. Browsers re-fetch on each page load when scoped
            to "" or referenced relatively, so config changes propagate
            without forcing reinstall. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        {themePrimary && (
          <meta name="theme-color" content={themePrimary} />
        )}
        {/* iOS — recognized only by older Safari but doesn't hurt newer
            ones. apple-touch-icon falls back to logo_url; ideally a
            512x512 PNG with the league logo on a brand-color square. */}
        {logoUrl && <link rel="apple-touch-icon" href={logoUrl} />}
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
            <Ticker
              games={tickerGames}
              tenantShort={leagueAbbrev ?? leagueName ?? "League"}
              seasonYear={new Date().getFullYear()}
            />
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
