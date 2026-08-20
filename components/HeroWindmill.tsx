// Windmill-only homepage hero — a faithful port of the static windmill-site
// hero (windmill-site/index.html: full-bleed `.page-banner` photo + a dark
// `.hero-bar` carrying two CTAs and a four-item stat strip).
//
// The shared DvslHero renders a tenant banner in "logo-mode": bounded to
// max-width 1000px / max-height ~340px and centered on white, which is right
// for a compact wordmark but shrinks Windmill's 1942x660 cinematic photo into
// a small boxed card (Adam: "looks so much worse than before"). This restores
// the edge-to-edge hero he built. Windmill-gated in app/page.tsx; no other
// tenant renders it.
import Link from "next/link";
import "./HeroWindmill.css";

// The four facts from the static site's hero strip. Windmill-specific, so they
// live here rather than in the shared config.
const STATS: ReadonlyArray<{ n: string; k: string }> = [
  { n: "5", k: "Age Divisions" },
  { n: "10+", k: "Communities" },
  { n: "30th", k: "Annual Tournament" },
  { n: "1997", k: "Established" },
];

export function HeroWindmill({
  bannerUrl,
  seasonYear,
  registrationOpen = true,
}: {
  bannerUrl: string;
  seasonYear: string;
  registrationOpen?: boolean;
}) {
  return (
    <section className="wm-hero">
      {/* Full-bleed banner. width:100% / height:auto = the static site's
          `.page-banner`, so nothing is cropped and it spans the viewport.
          It's the LCP image, so hint the browser to prioritize it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="wm-hero-banner"
        src={bannerUrl}
        alt="Windmill Fastpitch Softball, Girls Youth Fastpitch, Lake Mills, Wisconsin"
        width={1942}
        height={660}
        fetchPriority="high"
        decoding="async"
      />
      <div className="wm-hero-bar">
        <div className="wm-hero-wrap">
          <div className="wm-hero-btns">
            {registrationOpen && (
              <Link className="wm-btn wm-btn-primary" href="/team-registration">
                Register for {seasonYear}
              </Link>
            )}
            <Link className="wm-btn wm-btn-ghost" href="/schedule">
              View Schedule
            </Link>
          </div>
          <div className="wm-hero-stats">
            {STATS.map((s) => (
              <div className="wm-stat" key={s.k}>
                <span className="wm-stat-n">{s.n}</span>
                <span className="wm-stat-k">{s.k}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
