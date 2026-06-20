import type { Metadata } from "next";
import { headers } from "next/headers";
import { Barlow_Condensed, Inter, Oswald } from "next/font/google";
import { TenantProvider } from "@/lib/tenant-context";
import { SiteHeader } from "@/components/SiteHeader";
import { PageBanner } from "@/components/PageBanner";
import { headerImagesFor } from "@/lib/header-images";
import { Ticker, type AgeTicker, type TickerGame } from "@/components/Ticker";
import { loadAgeGroupTickers, loadTickerGames } from "@/lib/site-data";
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

export async function generateMetadata(): Promise<Metadata> {
  const configJson = headers().get("x-tenant-config-json");
  let name: string | null = null;
  if (configJson) {
    try {
      name = (JSON.parse(configJson) as { name?: string }).name ?? null;
    } catch {
      /* ignore */
    }
  }
  return name
    ? {
        title: { default: name, template: `%s · ${name}` },
        description: `${name} — schedules, standings, scores, and more.`,
      }
    : {
        title: "League Platform",
        description: "Multi-tenant SaaS for amateur sports leagues.",
      };
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
  // Per-page header banner images for this tenant (public/<tenant>/headers/).
  // Empty for leagues with none; the client PageBanner picks one by route.
  const headerImages = headerImagesFor(tenantId);
  let leagueName: string | null = null;
  let leagueAbbrev: string | undefined;
  let logoUrl: string | null = null;
  let themePrimary: string | undefined;
  let themeAccent: string | undefined;
  let statsEnabled = true;
  let showTournaments = false;
  let showPitchCounts = false;
  let showPowerRankings = false;
  let tickerByAge = false;
  let registrationOpen = false;
  if (configJson) {
    try {
      const cfg = JSON.parse(configJson) as {
        name?: string;
        abbrev?: string;
        theme?: { primary?: string; accent?: string; logo_url?: string };
        flags?: Record<string, boolean>;
      };
      leagueName = cfg.name ?? null;
      leagueAbbrev = cfg.abbrev;
      logoUrl = cfg.theme?.logo_url ?? null;
      themePrimary = cfg.theme?.primary;
      themeAccent = cfg.theme?.accent;
      // Stats-off tenants set flags.stats_enabled = false. Default on.
      statsEnabled = cfg.flags?.stats_enabled !== false;
      // Tournaments link is opt-in per tenant.
      showTournaments = cfg.flags?.show_tournaments === true;
      // Pitch-count eligibility tracker is opt-in per tenant.
      showPitchCounts = cfg.flags?.show_pitch_counts === true;
      // RPI power rankings page is opt-in per tenant.
      showPowerRankings = cfg.flags?.show_power_rankings === true;
      // Registration CTA shows when the season's registration is open.
      registrationOpen = cfg.flags?.registration_open === true;
      // Big youth leagues use an age-group-tabbed ticker instead of a noisy
      // league-wide one.
      tickerByAge = cfg.flags?.ticker_by_age === true;
    } catch {
      /* fall through */
    }
  }

  let tickerGames: TickerGame[] = [];
  let ageTickers: AgeTicker[] = [];
  if (tenantId) {
    if (tickerByAge) ageTickers = await loadAgeGroupTickers(tenantId);
    else tickerGames = await loadTickerGames(tenantId);
  }

  const themeStyle = [
    themePrimary ? `--brand-primary: ${themePrimary};` : "",
    themeAccent ? `--brand-accent: ${themeAccent};` : "",
  ].join(" ");

  return (
    <html
      lang="en"
      className={`${inter.variable} ${barlow.variable} ${oswald.variable}`}
      style={
        themeStyle ? ({ ...parseStyle(themeStyle) } as React.CSSProperties) : undefined
      }
    >
      <body className="site-shell antialiased">
        <TenantProvider tenantId={tenantId} configJson={configJson}>
          {tenantId && (
            <Ticker
              games={tickerByAge ? undefined : tickerGames}
              byAge={tickerByAge ? ageTickers : undefined}
            />
          )}
          {tenantId ? (
            <SiteHeader
              tenantId={tenantId}
              leagueName={leagueName ?? "League"}
              leagueAbbrev={leagueAbbrev}
              logoUrl={logoUrl}
              showStats={statsEnabled}
              showTournaments={showTournaments}
              showPitchCounts={showPitchCounts}
              showPowerRankings={showPowerRankings}
              registrationOpen={registrationOpen}
            />
          ) : null}
          {tenantId && <PageBanner images={headerImages} />}
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
