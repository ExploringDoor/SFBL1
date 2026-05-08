// Site-wide footer.
//
// Two layers:
//   1. Sponsor strip — per-league `sponsors` array on the config
//      doc. When populated, renders a horizontal row of logos at
//      the top of the footer. Each logo links out to the sponsor's
//      site in a new tab (rel=noopener for safety).
//   2. League info — name, copyright, helpful links. Renders even
//      when no sponsors are configured.
//
// Server component — reads tenant config from the request header
// (set by middleware). No JS shipped for this component itself.

import { headers } from "next/headers";
import Link from "next/link";
import type { PublicLeagueConfig } from "@/lib/tenants";
import "./SiteFooter.css";

export function SiteFooter() {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  const configRaw = h.get("x-tenant-config-json");
  if (!tenantId || !configRaw) return null;

  let config: PublicLeagueConfig | null = null;
  try {
    config = JSON.parse(configRaw) as PublicLeagueConfig;
  } catch {
    return null;
  }
  if (!config) return null;

  const sponsors = Array.isArray(config.sponsors) ? config.sponsors : [];
  const hasSponsors = sponsors.length > 0;

  return (
    <footer className="le-footer">
      {hasSponsors && (
        <div className="le-footer-sponsors">
          <div className="le-footer-sponsors-label">Our Sponsors</div>
          <div className="le-footer-sponsors-row">
            {sponsors.map((s, i) => {
              if (!s.logo_url) return null;
              const inner = (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={s.logo_url}
                  alt={s.name || "Sponsor"}
                  loading="lazy"
                />
              );
              return s.url ? (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={s.name}
                >
                  {inner}
                </a>
              ) : (
                <span key={i} title={s.name}>
                  {inner}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="le-footer-bar">
        <div className="le-footer-name">
          {config.name}
          {config.abbrev && config.abbrev !== config.name ? (
            <span className="le-footer-abbrev"> · {config.abbrev}</span>
          ) : null}
        </div>
        <nav className="le-footer-links">
          <Link href="/rules">Rules</Link>
          <Link href="/content/contact">Contact</Link>
          <Link href="/content/sponsors">Become a sponsor</Link>
          <Link href="/login">Sign in</Link>
        </nav>
        <div className="le-footer-copy">
          © {new Date().getFullYear()} {config.name}. Powered by{" "}
          <a
            href="https://leagueengine.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            LeagueEngine
          </a>
          .
        </div>
      </div>
    </footer>
  );
}
