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

  // Footer social icons — config-driven (per-tenant). Only platforms
  // with a configured URL render. SVG glyphs (no emoji per house
  // style); each opens in a new tab, rel=noopener for safety.
  const social = config.social ?? {};
  const socialLinks: { key: string; label: string; url: string }[] = [
    { key: "facebook", label: "Facebook", url: social.facebook ?? "" },
    { key: "instagram", label: "Instagram", url: social.instagram ?? "" },
    { key: "x", label: "X", url: social.x ?? "" },
    { key: "youtube", label: "YouTube", url: social.youtube ?? "" },
    { key: "tiktok", label: "TikTok", url: social.tiktok ?? "" },
  ].filter((s) => /^https?:\/\//i.test(s.url));

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

      {socialLinks.length > 0 && (
        <div className="le-footer-social">
          {socialLinks.map((s) => (
            <a
              key={s.key}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.label}
              title={s.label}
            >
              <SocialIcon platform={s.key} />
            </a>
          ))}
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

// Monochrome brand glyphs (currentColor) so they tint with the
// footer palette + hover state. 24×24 viewBox, sized via CSS.
function SocialIcon({ platform }: { platform: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "currentColor",
    "aria-hidden": true,
    focusable: false,
  } as const;
  switch (platform) {
    case "facebook":
      return (
        <svg {...common}>
          <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z" />
        </svg>
      );
    case "instagram":
      return (
        <svg {...common}>
          <path d="M12 2.2c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.43.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.43-.36-1.06-.41-2.23C2.21 15.58 2.2 15.2 2.2 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.43-.16 1.06-.36 2.23-.41C8.42 2.21 8.8 2.2 12 2.2zm0 1.8c-3.15 0-3.5.01-4.74.07-.9.04-1.38.19-1.7.32-.43.17-.74.36-1.06.68-.32.32-.51.63-.68 1.06-.13.32-.28.8-.32 1.7C3.21 8.5 3.2 8.85 3.2 12s.01 3.5.07 4.74c.04.9.19 1.38.32 1.7.17.43.36.74.68 1.06.32.32.63.51 1.06.68.32.13.8.28 1.7.32 1.24.06 1.59.07 4.74.07s3.5-.01 4.74-.07c.9-.04 1.38-.19 1.7-.32.43-.17.74-.36 1.06-.68.32-.32.51-.63.68-1.06.13-.32.28-.8.32-1.7.06-1.24.07-1.59.07-4.74s-.01-3.5-.07-4.74c-.04-.9-.19-1.38-.32-1.7a2.86 2.86 0 0 0-.68-1.06 2.86 2.86 0 0 0-1.06-.68c-.32-.13-.8-.28-1.7-.32C15.5 4.01 15.15 4 12 4zm0 3.06A4.94 4.94 0 1 1 7.06 12 4.94 4.94 0 0 1 12 7.06zm0 1.8A3.14 3.14 0 1 0 15.14 12 3.14 3.14 0 0 0 12 8.86zm5.14-2.32a1.15 1.15 0 1 1-1.15 1.15 1.15 1.15 0 0 1 1.15-1.15z" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.22-6.82-5.97 6.82H1.66l7.73-8.84L1.16 2.25h6.83l4.71 6.23 5.54-6.23zm-1.16 17.52h1.83L7.01 4.13H5.05l12.03 15.64z" />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...common}>
          <path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5 2.59 2.59 0 1 1 .76-5.06v-3.1a5.66 5.66 0 0 0-.76-.05 5.68 5.68 0 1 0 5.68 5.68V9.01a7.35 7.35 0 0 0 4.29 1.37V7.3a4.29 4.29 0 0 1-3.23-1.48z" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...common}>
          <path d="M23.5 6.2a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.51A3.02 3.02 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3.02 3.02 0 0 0 2.12 2.14c1.88.51 9.38.51 9.38.51s7.5 0 9.38-.51a3.02 3.02 0 0 0 2.12-2.14A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z" />
        </svg>
      );
    default:
      return null;
  }
}
