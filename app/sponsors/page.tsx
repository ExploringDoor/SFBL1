// Public sponsors page.
//
// Three jobs: show who already sponsors the league, sell the packages, and
// give a business a way to get in touch. Mike asked for this for Island (via
// Adam, 2026-08-02) and supplied his 2026 rate card and his first partner.
//
// A real route rather than a /content/sponsors CMS page. The CMS version is
// what DEFAULT_LINKS points at, but it needs a page_content doc authored in
// Firestore before it renders anything, and this had to work for a league with
// nothing authored.
//
// Every number here is Mike's own, off his flyer — prices, reach, impression
// estimates — not a figure invented for the page. A tenant with no
// island-sponsors.json entry falls back to the tier-free pitch.

import Link from "next/link";
import { headers } from "next/headers";
import type { PublicLeagueConfig } from "@/lib/tenants";
import islandSponsors from "./island-sponsors.json";
import lcyblSponsors from "./lcybl-sponsors.json";
import "./sponsors.css";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sponsors" };

interface Sponsor {
  name: string;
  logo_url?: string;
  url?: string;
}

interface Tier {
  name: string;
  price: string;
  popular?: boolean;
  impressions?: string;
  benefits: string[];
}

interface Partner {
  name: string;
  company?: string;
  tier?: string;
  role?: string;
  tagline?: string;
  quote?: string;
  email?: string;
  phone?: string;
  url?: string;
  logo?: string | null;
}

interface SponsorData {
  duration?: string | null;
  intro?: string;
  reach?: { stat: string; label: string }[];
  tiers?: Tier[];
  partners?: Partner[];
}

const CHECK =
  "M20 6.5L9.2 17.3 4 12.1";

function Check() {
  return (
    <svg
      className="spn-check"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={CHECK} />
    </svg>
  );
}

export default async function SponsorsPage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
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
  const data: SponsorData =
    tenantId === "island"
      ? (islandSponsors as SponsorData)
      : tenantId === "lcybl"
        ? (lcyblSponsors as SponsorData)
        : {};
  const tiers = data.tiers ?? [];
  const partners = data.partners ?? [];
  const reach = data.reach ?? [];

  // Logos uploaded through Admin > Sponsors. Shown alongside the named
  // partners below, so a logo added in the admin appears here without anyone
  // touching island-sponsors.json.
  const logoSponsors: Sponsor[] = Array.isArray(config?.sponsors)
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
          {data.intro ?? (
            <>
              Put your business in front of thousands of Long Island families,
              athletes and coaches. {leagueName} reaches them every month
              through tournaments, live streams and social, and every
              sponsorship goes straight back into the fields, the equipment and
              the awards the girls take home.
            </>
          )}
        </p>
      </header>

      {reach.length > 0 && (
        <section className="spn-reach">
          {reach.map((r) => (
            <div key={r.label} className="spn-reach-item">
              <span className="spn-reach-stat">{r.stat}</span>
              <span className="spn-reach-label">{r.label}</span>
            </div>
          ))}
        </section>
      )}

      {partners.length > 0 && (
        <section className="spn-current">
          <h2 className="spn-h2">Our partners</h2>
          {partners.map((p) => (
            <article key={p.name} className="spn-partner">
              <div className="spn-partner-head">
                {p.logo && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={p.logo}
                    alt={p.company ?? p.name}
                    className="spn-partner-logo"
                  />
                )}
                <div>
                  {p.tier && <span className="spn-partner-tier">{p.tier}</span>}
                  <h3 className="spn-partner-name">
                    {p.name}
                    {p.company ? ` · ${p.company}` : ""}
                  </h3>
                  {p.role && <p className="spn-partner-role">{p.role}</p>}
                </div>
              </div>

              {p.quote && <blockquote className="spn-quote">{p.quote}</blockquote>}
              {p.tagline && <p className="spn-partner-tagline">{p.tagline}</p>}

              <div className="spn-partner-contact">
                {p.email && <a href={`mailto:${p.email}`}>{p.email}</a>}
                {p.phone && <a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}>{p.phone}</a>}
                {p.url && (
                  <a href={p.url} target="_blank" rel="noopener noreferrer">
                    Visit site
                  </a>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      {logoSponsors.length > 0 && (
        <section className="spn-current">
          <h2 className="spn-h2">Also supporting {leagueName}</h2>
          <div className="spn-grid">
            {logoSponsors.map((s, i) => {
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

      {tiers.length > 0 && (
        <section className="spn-tiers-wrap">
          <h2 className="spn-h2">Sponsorship packages</h2>
          <div className="spn-tiers">
            {tiers.map((t) => (
              <article
                key={t.name}
                className={"spn-tier" + (t.popular ? " spn-tier-pop" : "")}
              >
                {t.popular && <span className="spn-tier-flag">Most popular</span>}
                <h3 className="spn-tier-name">{t.name}</h3>
                <p className="spn-tier-price">{t.price}</p>
                <ul className="spn-tier-list">
                  {t.benefits.map((b) => (
                    <li key={b}>
                      <Check />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                {t.impressions && (
                  <p className="spn-tier-impressions">{t.impressions}</p>
                )}
                {data.duration && (
                  <p className="spn-tier-impressions">Duration: {data.duration}</p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="spn-pitch">
        <h2 className="spn-h2">Reserve your sponsorship spot</h2>
        <p className="spn-body">
          Sponsoring {leagueName} puts your business in front of the coaches,
          parents and families who follow the league all season, on the page
          they check for scores and schedules every week.
        </p>
        <p className="spn-body">
          Your logo also runs in the footer of every page on this site, linking
          straight to your own, for as long as you are a sponsor.
        </p>
        <p className="spn-body">
          Sponsorships are limited. Get in touch and we will put together
          something that fits.
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
