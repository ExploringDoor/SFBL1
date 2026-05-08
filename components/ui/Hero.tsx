// Homepage hero — verbatim port of DVSL `.hero`
// (~/Desktop/softball-site/index.html lines 820–842).
//
// Full-bleed banner on the homepage. Eyebrow pill ("SEASON 2026"),
// big uppercase title with one accent word, optional subtitle, and
// up to two CTA buttons (primary + outline).
//
// Caller controls everything — the hero is a pure presentation
// component. Pass `accentWord` to italicise/colour part of the title.
import Link from "next/link";
import "./Hero.css";

export interface HeroCta {
  label: string;
  href: string;
  variant?: "primary" | "outline";
}

export interface HeroProps {
  /** Small pill text above the title, e.g. "SEASON 2026". */
  pill?: string;
  /** Big title. Used as the visible heading when no `logoUrl` is set,
   *  and as the alt text for accessibility when a logo replaces it. */
  title: string;
  /** Optional word inside `title` to render in the cyan accent. */
  accentWord?: string;
  /** Subtitle line beneath title. */
  subtitle?: string;
  /** When set, the league's banner image renders in place of the
   *  big text title. Most leagues with a graphical wordmark want
   *  this — it's far more recognizable than `${SHORT} ${YEAR}`. */
  logoUrl?: string | null;
  ctas?: HeroCta[];
  /** Optional background image URL. */
  bgUrl?: string;
}

export function Hero({
  pill,
  title,
  accentWord,
  subtitle,
  logoUrl,
  ctas = [],
  bgUrl,
}: HeroProps) {
  // Logo mode = banner replaces the title text. The hero drops the
  // dark BG, gradient overlay, and subtitle so the league's banner
  // sits on the white page background with just the season pill.
  const isLogoMode = !!logoUrl;
  return (
    <section className={"le-hero" + (isLogoMode ? " logo-mode" : "")}>
      {!isLogoMode && (
        <>
          <div
            className="le-hero-bg"
            style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined}
          />
          <div className="le-hero-overlay" />
        </>
      )}

      {pill && <div className="le-hero-pill">{pill}</div>}

      {isLogoMode ? (
        <h1 className="le-hero-title le-hero-title-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl!} alt={title} className="le-hero-logo" />
        </h1>
      ) : (
        <h1 className="le-hero-title">{renderTitle(title, accentWord)}</h1>
      )}

      {!isLogoMode && subtitle && <p className="le-hero-sub">{subtitle}</p>}

      {ctas.length > 0 && (
        <div className="le-hero-cta">
          {ctas.map((cta) => (
            <Link
              key={cta.href + cta.label}
              href={cta.href}
              className={
                cta.variant === "outline"
                  ? "le-hero-btn-outline"
                  : "le-hero-btn-primary"
              }
            >
              {cta.label}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function renderTitle(title: string, accentWord?: string): React.ReactNode {
  if (!accentWord) return title;
  const idx = title.toLowerCase().indexOf(accentWord.toLowerCase());
  if (idx === -1) return title;
  return (
    <>
      {title.slice(0, idx)}
      <em>{title.slice(idx, idx + accentWord.length)}</em>
      {title.slice(idx + accentWord.length)}
    </>
  );
}
