import type { Metadata } from "next";
import { headers } from "next/headers";
import { Barlow_Condensed, Inter, Oswald } from "next/font/google";
import { TenantProvider } from "@/lib/tenant-context";
import { SiteHeader } from "@/components/SiteHeader";
import { Ticker } from "@/components/Ticker";
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
  if (configJson) {
    try {
      const cfg = JSON.parse(configJson) as {
        name?: string;
        abbrev?: string;
        theme?: { primary?: string; accent?: string; logo_url?: string };
      };
      leagueName = cfg.name ?? null;
      leagueAbbrev = cfg.abbrev;
      logoUrl = cfg.theme?.logo_url ?? null;
      themePrimary = cfg.theme?.primary;
      themeAccent = cfg.theme?.accent;
    } catch {
      /* fall through */
    }
  }

  const tickerGames = tenantId ? await loadTickerGames(tenantId) : [];

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
          {tenantId && <Ticker games={tickerGames} />}
          {tenantId ? (
            <SiteHeader
              tenantId={tenantId}
              leagueName={leagueName ?? "League"}
              leagueAbbrev={leagueAbbrev}
              logoUrl={logoUrl}
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
