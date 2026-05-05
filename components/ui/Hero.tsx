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
  /** Big title. */
  title: string;
  /** Optional word inside `title` to render in the cyan accent. */
  accentWord?: string;
  /** Subtitle line beneath title. */
  subtitle?: string;
  ctas?: HeroCta[];
  /** Optional background image URL. */
  bgUrl?: string;
}

export function Hero({
  pill,
  title,
  accentWord,
  subtitle,
  ctas = [],
  bgUrl,
}: HeroProps) {
  return (
    <section className="le-hero">
      <div
        className="le-hero-bg"
        style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined}
      />
      <div className="le-hero-overlay" />

      {pill && <div className="le-hero-pill">{pill}</div>}

      <h1 className="le-hero-title">{renderTitle(title, accentWord)}</h1>

      {subtitle && <p className="le-hero-sub">{subtitle}</p>}

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
