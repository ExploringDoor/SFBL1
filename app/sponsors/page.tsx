// Public sponsors page.
//
// Two jobs: show the leagues's current sponsors, and give a business a reason
// and a way to become one. Mike asked for this for Island (via Adam,
// 2026-08-02).
//
// A real route rather than a /content/sponsors CMS page. The CMS version is
// what DEFAULT_LINKS points at, but it needs a page_content doc authored in
// Firestore before it renders anything, and this needs to work for a league
// that has no sponsors yet — which is exactly the league that needs the pitch.
//
// Deliberately makes NO claim about price, tiers, or placements beyond the one
// placement that actually exists today (the footer strip, rendered by
// SiteFooter from config.sponsors). Inventing a rate card would put numbers on
// the site that the league never agreed to.

import Link from "next/link";
import { headers } from "next/headers";
import type { PublicLeagueConfig } from "@/lib/tenants";
import "./sponsors.css";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sponsors" };

interface Sponsor {
  name: string;
  logo_url?: string;
  url?: string;
}

export default async function SponsorsPage() {
  const h = headers();
  const config = (() => {
    const raw = h.get("x-tenant-config-json");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicLeagueConfig;
    } catch {
      return null;
    }
  })();

  const leagueName = config?.name ?? "the league";
  const sponsors: Sponsor[] = Array.isArray(config?.sponsors)
    ? (config!.sponsors as Sponsor[])
    : [];

  return (
    <main className="container py-10">
      <header className="mb-6">
        {/* Hidden by the theme on tenants whose banner art names the page; kept
            for screen readers and the document outline. */}
        <h1
          className="font-display"
          style={{
            fontSize: "clamp(40px, 6vw, 64px)",
            lineHeight: 0.95,
            color: "var(--text-strong)",
            margin: "0 0 10px",
          }}
        >
          Sponsors
        </h1>
        <p className="spn-intro">
          {leagueName} is run by the families who play in it. Sponsors keep
          fees down and put something back into the fields, the equipment and
          the awards the girls take home.
        </p>
      </header>

      {sponsors.length > 0 && (
        <section className="spn-current">
          <h2 className="spn-h2">Our sponsors</h2>
          <p className="spn-thanks">
            Thank you to the businesses supporting {leagueName} this season.
          </p>
          <div className="spn-grid">
            {sponsors.map((s, i) => {
              const card = (
                <>
                  {s.logo_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={s.logo_url} alt={s.name} className="spn-logo" />
                  ) : null}
                  <span className="spn-name">{s.name}</span>
                </>
              );
              return s.url ? (
                <a
                  key={`${s.name}-${i}`}
                  className="spn-card"
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {card}
                </a>
              ) : (
                <div key={`${s.name}-${i}`} className="spn-card">
                  {card}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="spn-pitch">
        <h2 className="spn-h2">Become a sponsor</h2>
        <p className="spn-body">
          Sponsoring {leagueName} puts your business in front of the coaches,
          parents and families who follow the league all season, on the page
          they check for scores and schedules every week.
        </p>
        <p className="spn-body">
          Your logo runs in the footer of every page on this site, linking
          straight to your own, for as long as you are a sponsor.
        </p>
        <p className="spn-body">
          Packages and pricing are set by the league office. Get in touch and
          we will put together something that fits.
        </p>
        {/* Points at the Contact page rather than a mailto. The league office
            address is not on PublicLeagueConfig, and the Contact page already
            carries the right name, email and phone for every tenant, so this
            cannot go stale the way a second copy of the address would. */}
        <Link className="spn-cta" href="/content/contact">
          Contact the league office
        </Link>
      </section>
    </main>
  );
}
