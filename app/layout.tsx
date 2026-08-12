import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Barlow_Condensed, Inter, Oswald } from "next/font/google";
import { TenantProvider } from "@/lib/tenant-context";
import { Nav } from "@/components/ui/Nav";
import type { NavLink } from "@/components/ui/nav-links";
import { SiteFooter } from "@/components/ui/SiteFooter";
import { ProfileButton } from "@/components/ProfileButton";
import { PwaShell } from "@/components/PwaShell";
import { ViewTracker } from "@/components/ViewTracker";
import { PwaTabBar } from "@/components/ui/PwaTabBar";
import { PageBanner } from "@/components/PageBanner";
import {
  bannerCarriesTitle,
  bannerSlugFor,
  headerImagesFor,
  headerImagesSmallFor,
} from "@/lib/header-images";
import { TickerScrollHide } from "@/components/ui/TickerScrollHide";
import { TickerInputEnhancer } from "@/components/ui/TickerInputEnhancer";
import { SwVersionPill } from "@/components/ui/SwVersionPill";
import { SwNavigateListener } from "@/components/SwNavigateListener";
import { Ticker } from "@/components/ui/Ticker";
import { SiteFX } from "@/components/ui/SiteFX";
import { PageSlug } from "@/components/ui/PageSlug";
import { loadTickerGames } from "@/lib/site-data";
import "./globals.css";
import "./fx.css";
import "./island-theme.css";

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
  // metadataBase resolves relative og:image/twitter:image URLs (e.g.
  // "/coybl/og.png") to ABSOLUTE ones. Without it Next warns and falls back to
  // localhost, so a link shared from coybl.net previews with a broken/blank
  // image. Derive it from the actual request host (middleware sets
  // x-tenant-host) so every tenant's card points at its own domain.
  const host = h.get("x-tenant-host") || h.get("host") || "";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.");
  const metadataBase = host
    ? new URL(`${isLocal ? "http" : "https"}://${host}`)
    : undefined;
  const configJson = h.get("x-tenant-config-json");
  if (!configJson) {
    return {
      metadataBase,
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
      theme?: { logo_url?: string; og_image_url?: string };
      flags?: Record<string, boolean>;
    };
    const name = cfg.name ?? "League";
    const abbrev = cfg.abbrev;
    const sport = cfg.sport === "softball" ? "softball" : "baseball";
    // Stats-off leagues (Island) publish no player stats — saying "stats" in
    // the meta description advertises something the site doesn't have.
    const statsOff = cfg.flags?.stats_enabled === false;
    const description = statsOff
      ? `Schedule, scores, and standings for ${name}${
          abbrev && abbrev !== name ? ` (${abbrev})` : ""
        }. Live ${sport} updates, team pages, and coach tools.`
      : `Schedule, scores, standings, and stats for ${name}${
          abbrev && abbrev !== name ? ` (${abbrev})` : ""
        }. Live ${sport} updates, team rosters, and captain tools.`;
    // ONE share image for link previews (iMessage / FB / Twitter): the
    // purpose-built 1200×630 og-default.png. This used to ALSO include
    // the tenant logo as a second image, which made iMessage render the
    // banner twice in the preview card (Adam, 2026-06). Per-page
    // overrides (team / player pages) still set their own image in
    // their own generateMetadata.
    // Per-tenant share image for link previews (iMessage / FB / Twitter).
    //
    // /og-default.png is literally SFBL's logo, so ANY tenant without an
    // override texts out a South Florida Baseball League card. Adam hit this
    // sending an Island link (2026-07-22).
    //
    // Now config-driven: set theme.og_image_url and a tenant gets its own card
    // with no code change. COYBL's hardcoded path stays as a fallback because
    // its config predates the field and is not worth a reseed.
    const ogUrl =
      cfg.theme?.og_image_url ||
      (abbrev === "COYBL" ? "/coybl/og.png" : "/og-default.png");
    const ogImage = [
      {
        url: ogUrl,
        width: 1200,
        height: 630,
        alt: name,
      },
    ];

    return {
      metadataBase,
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
  // First path segment seeds the header-banner image for SSR (the client
  // PageBanner then tracks the route for in-app navigation).
  const pathname = h.get("x-pathname") ?? "/";
  const bannerSlug = pathname.split("/")[1] || "home";
  // The banner keys off a slightly different slug: CMS pages at /content/<id>
  // all share the first segment "content", so they resolve to "content-<id>".
  // data-page keeps the plain first segment, which existing CSS targets.
  const bannerImgSlug = bannerSlugFor(pathname);
  const configJson = h.get("x-tenant-config-json");
  let leagueName: string | null = null;
  let leagueAbbrev: string | undefined;
  let logoUrl: string | null = null;
  let themePrimary: string | undefined;
  let themeAccent: string | undefined;
  let themeSecondary: string | undefined;
  let navHideLabels: string[] = [];
  let navAddLinks: NavLink[] = [];
  // Shortcuts pinned to the top of the MOBILE menu, for links a tenant's
  // visitors reach for that would otherwise sit inside a dropdown.
  //
  // Island had Leagues + Tournaments pinned here on 2026-08-02, when both were
  // buried. Mike's reordering on 2026-08-03 puts them second and third in the
  // nav itself, so the mobile sheet already lists them right under Home and
  // the pins would just be the same two links twice. Dropped rather than kept
  // — the mechanism stays for the next tenant that needs it.
  const featuredNavLinks: NavLink[] = [];
  // Branded season year for the ticker (config.season_year); falls back to the
  // calendar year. COYBL registers the 2027 season during 2026.
  let seasonYear = new Date().getFullYear();
  // flags.ticker_scroll — opt-in marquee ticker (Island Fastpitch).
  let tickerScroll = false;
  // flags.banner_full_bleed — edge-to-edge page header banners (Island).
  let bannerFullBleed = false;
  // flags.banner_strip — slim super-wide fixed-ratio header band (LCYBL).
  let bannerStrip = false;
  // flags.motion_fx — opt-in motion layer (scroll reveals, count-ups, banner
  // push-in). OFF for every existing tenant, so their sites do not move.
  let motionFx = false;
  // flags.sticky_nav — keep the top nav pinned on scroll instead of sliding
  // the whole bar off-screen (the default DVSL behaviour). Its own flag rather
  // than riding on motion_fx, because "hide the top bar while scrolled" was a
  // deliberate call for the other tenants and enabling motion elsewhere must
  // not silently reverse it.
  let stickyNav = false;
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
        // `add` entries may carry `children` (a tenant-defined dropdown), so
        // this stays loose and `clean` below does the real validation.
        nav?: { hide?: string[]; add?: unknown[] };
        flags?: Record<string, boolean>;
        season_year?: number;
      };
      leagueName = cfg.name ?? null;
      leagueAbbrev = cfg.abbrev;
      if (typeof cfg.season_year === "number") seasonYear = cfg.season_year;
      logoUrl = cfg.theme?.logo_url ?? null;
      tickerScroll = cfg.flags?.ticker_scroll === true;
      bannerFullBleed = cfg.flags?.banner_full_bleed === true;
      bannerStrip = cfg.flags?.banner_strip === true;
      motionFx = cfg.flags?.motion_fx === true;
      stickyNav = cfg.flags?.sticky_nav === true;
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
      // Tenant-added nav links (e.g. COYBL "Pitch Counts" + "Power Rankings").
      if (Array.isArray(cfg.nav?.add)) {
        // Keep `children` — an added entry may itself be a dropdown (Island's
        // "Information" menu). A filter that only widened to {label, href}
        // would type-check fine and silently flatten the menu to a dead "#".
        const clean = (x: unknown): NavLink | null => {
          const l = x as { label?: unknown; href?: unknown; children?: unknown };
          if (!l || typeof l.label !== "string" || typeof l.href !== "string") {
            return null;
          }
          const kids = Array.isArray(l.children)
            ? l.children.map(clean).filter((c): c is NavLink => c !== null)
            : undefined;
          return kids?.length
            ? { label: l.label, href: l.href, children: kids }
            : { label: l.label, href: l.href };
        };
        navAddLinks = cfg.nav!.add!.map(clean).filter(
          (l): l is NavLink => l !== null,
        );
      }
    } catch {
      /* fall through */
    }
  }

  // Island's nav is spelled out in full rather than assembled from
  // DEFAULT_LINKS + config.nav.add, because Mike gave an exact ORDER (via
  // Adam, 2026-08-03) and the assembled version cannot express one: nav.add
  // entries are all injected at a single insertion point, ahead of the first
  // dropdown, so League and Tournaments could never sit second and third.
  //
  // His order: Home, League, Tournaments, Schedule, Scores, Teams,
  // Events & Clinics, Shop, Fields, Information, Contact.
  //
  // Three things are in here that he did not list, kept deliberately:
  //   • Standings — a league site without a standings link is not a thing he
  //     can have meant. Placed with Scores and Schedule, which keeps every
  //     pair he DID specify in his order.
  //   • Register — the site's main commercial job for the next two weeks, and
  //     the homepage CTA points at it.
  //   • Admin — the only way in for him and Adam.
  // Say the word and any of them move or go.
  //
  // "Shop" not "Store": his word, and what the old site called it.
  //
  // Umpire Evaluation and Admin fold into Information rather than keeping a
  // separate More menu, to buy back two slots on a bar that is already wide.
  const ISLAND_NAV: NavLink[] = [
    { label: "Home", href: "/" },
    { label: "League", href: "/content/leagues" },
    { label: "Tournaments", href: "/tournaments" },
    { label: "Schedule", href: "/schedule" },
    { label: "Scores", href: "/scores" },
    { label: "Standings", href: "/standings" },
    { label: "Teams", href: "/teams" },
    { label: "Events & Clinics", href: "/content/events-clinics" },
    { label: "Shop", href: "/store" },
    { label: "Fields", href: "/fields" },
    {
      label: "Information",
      href: "#",
      children: [
        { label: "Rules", href: "/rules" },
        { label: "Player Ads", href: "/player-ads" },
        // Summer League removed 2026-08-03 (Mike, via Adam): the League page
        // already links to it, so in the menu it was the same destination
        // twice. Still reachable from three places — the League page body, the
        // home page, and the "Summer League standings (USSSA)" button on
        // Standings — so nothing is orphaned by dropping the nav entry.
        { label: "Rainout Alerts", href: "/alerts" },
        // Past Seasons. Mike chose the archive option for the Fall rollover
        // (via Adam, 2026-08-11): Scores, Schedule and Standings clear down to
        // Fall, and Spring 2026 lives on here instead of disappearing. Fed by
        // data/island/historical-standings.json + season-games-2026.json,
        // which are static files, so this page keeps working after the live
        // teams and games collections are cleared.
        { label: "Past Seasons", href: "/history" },
        { label: "Sponsors", href: "/sponsors" },
        { label: "Umpire Evaluation", href: "/umpire-evaluation-form" },
        { label: "Coach Login", href: "/captain" },
        { label: "Admin", href: "/admin" },
      ],
    },
    { label: "Contact", href: "/content/contact" },
    {
      label: "Register",
      href: "#",
      children: [
        { label: "Team Registration", href: "/team-registration" },
        { label: "Team Waiver", href: "/team-waiver-form" },
      ],
    },
  ];

  const tickerGames = tenantId ? await loadTickerGames(tenantId) : [];

  // Tenant overrides become inline custom-properties on <html>. CSS
  // throughout the app uses `var(--brand-primary, fallback)` so any
  // not-overridden var lands on the :root default in globals.css.
  const themeStyle = [
    themePrimary ? `--brand-primary: ${themePrimary};` : "",
    themeAccent ? `--brand-accent: ${themeAccent};` : "",
    themeSecondary ? `--brand-secondary: ${themeSecondary};` : "",
    // (--muted now meets WCAG AA for every tenant via the :root default.)
  ].join(" ");

  return (
    <html
      lang="en"
      // First path segment, so CSS can style one page differently (Island's
      // navy scores page). SSR value avoids a first-paint flash; <PageSlug />
      // keeps it correct after client-side navigation, where this would
      // otherwise stay stuck on the page that was server-rendered.
      data-page={bannerSlug}
      // Set when the header artwork already reads "Tournaments" / "Teams" /
      // etc., so the page's own <h1> would say it twice. The heading is hidden
      // visually but kept for screen readers and the document outline.
      data-banner-titled={
        bannerCarriesTitle(tenantId, bannerImgSlug) ? "1" : undefined
      }
      className={`${inter.variable} ${barlow.variable} ${oswald.variable}${
        motionFx ? " fx-on" : ""
      }${stickyNav ? " nav-sticky" : ""}${
        tenantId ? ` tenant-${tenantId}` : ""
      }`}
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
        {leagueAbbrev === "COYBL" ? (
          <>
            <link rel="icon" type="image/png" sizes="32x32" href="/coybl/favicon-32.png" />
            <link rel="icon" type="image/png" sizes="16x16" href="/coybl/favicon-16.png" />
            <link rel="apple-touch-icon" href="/coybl/apple-touch-icon.png" />
            <link rel="icon" type="image/png" sizes="192x192" href="/coybl/icon-192.png" />
            <link rel="icon" type="image/png" sizes="512x512" href="/coybl/icon-512.png" />
          </>
        ) : leagueAbbrev === "LCYBL" ? (
          <>
            <link rel="icon" type="image/png" sizes="32x32" href="/lcybl/favicon-32.png" />
            <link rel="icon" type="image/png" sizes="16x16" href="/lcybl/favicon-16.png" />
            <link rel="apple-touch-icon" href="/lcybl/apple-touch-icon.png" />
            <link rel="icon" type="image/png" sizes="192x192" href="/lcybl/icon-192.png" />
            <link rel="icon" type="image/png" sizes="512x512" href="/lcybl/icon-512.png" />
          </>
        ) : (
          <>
            <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
            <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
            <link rel="icon" type="image/png" sizes="512x512" href="/icons/icon-512.png" />
          </>
        )}
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
        {/* Keeps <html data-page> correct after client-side navigation. Mounted
            at body level, not inside the ticker block below, so it runs on
            every page regardless of tenant chrome. */}
        <PageSlug tenant={tenantId} />
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
                seasonYear={seasonYear}
                // COYBL (youth baseball) shows a baseball in place of the
                // generic hexagon mark. (Adam, 2026-07.)
                mark={leagueAbbrev === "COYBL" ? "⚾" : "⬡"}
                logoUrl={logoUrl}
                // SFBL: drop the big wordmark in the top-left so the
                // ticker is all scores (Adam, 2026-05-18). Branding
                // still lives in the nav + homepage Hero.
                // Island + LCYBL: the crest moved into the nav, so drop the
                // ticker's left tile entirely rather than fall back to its
                // "IFP 2026" / "LCYBL 2026" text, which would duplicate the
                // branding again. (The age filter lives in TickerTrack, not
                // this label, so hiding the label leaves it in place.)
                hideLabel={
                  leagueAbbrev === "SFBL" ||
                  tenantId === "island" ||
                  tenantId === "lcybl"
                }
                // Opt-in marquee. Only tenants that set flags.ticker_scroll
                // get the animated strip; everyone else keeps the manual pan.
                scroll={tickerScroll}
              />
              <TickerScrollHide />
              <TickerInputEnhancer />
              {motionFx && <SiteFX />}
            </>
          )}
          {tenantId ? (
            // Nav brand is normally the tenant short TEXT, not the logo, so the
            // league banner doesn't appear three times in the top stack (ticker
            // tile + nav + homepage hero). Adam called that out 2026-05-14.
            //
            // Island is the exception as of 2026-07-29: he wanted the logo in
            // the nav beside "Home" instead of the "IFP" text, and the ticker's
            // own logo tile removed (hideLabel below), so the mark still shows
            // exactly once in the top stack.
            <Nav
              tenantShort={leagueAbbrev ?? leagueName ?? "League"}
              // Island uses a dedicated nav mark (Adam's "Logo small", alpha-
              // cropped) rather than theme.logo_url, so the nav can carry a
              // tighter lockup than the wide banner logo without affecting
              // anything else that reads the theme value.
              // LCYBL: the crest (Adam's own art, background removed) sits in
              // the nav — the home banner carries the wordmark, so the emblem
              // shows once here instead of the plain "LCYBL" text.
              logoUrl={
                tenantId === "island"
                  ? "/island/logo-nav.png"
                  : tenantId === "lcybl"
                    ? "/lcybl/logo.png"
                    : null
              }
              // Island supplies its whole nav, in Mike's order. hide/add are
              // dropped with it — they only exist to patch DEFAULT_LINKS, and
              // re-applying them here would inject Fields, Events & Clinics
              // and Information a second time.
              links={tenantId === "island" ? ISLAND_NAV : undefined}
              hideLabels={tenantId === "island" ? undefined : navHideLabels}
              addLinks={tenantId === "island" ? undefined : navAddLinks}
              featuredLinks={featuredNavLinks}
              rightSlot={<ProfileButton tenantId={tenantId} />}
            />
          ) : null}
          {/* Per-page header photo (COYBL). Picks the image by route; renders
              nothing for tenants without public/<tenant>/headers/ images. */}
          {tenantId && (
            <PageBanner
              images={headerImagesFor(tenantId)}
              imagesSmall={headerImagesSmallFor(tenantId)}
              initialSlug={bannerImgSlug}
              fullBleed={bannerFullBleed}
              strip={bannerStrip}
              leagueName={leagueName ?? ""}
              tenantId={tenantId}
            />
          )}
          <div className="site-content">{children}</div>
          {modal}
          {tenantId ? <SiteFooter /> : null}
          {/* PWA bottom tab bar — gates itself on standalone display
              mode (regular browser tabs see nothing). DVSL pattern. */}
          {tenantId ? (
            <PwaTabBar
              links={tenantId === "island" ? ISLAND_NAV : undefined}
              hideLabels={tenantId === "island" ? undefined : navHideLabels}
              addLinks={tenantId === "island" ? undefined : navAddLinks}
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
