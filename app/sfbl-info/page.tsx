// Static "About SFBL" page. Mirrors the content of sfbl.com/sfbl-info/.
// Plain server component — no Firestore fetch — since the league
// description, fees, and contact info don't change often. When they
// do, edit this file directly.

import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export default function SfblInfoPage() {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

  return (
    <main className="container py-10" style={{ maxWidth: 760 }}>
      <header className="mb-8">
        <p className="sec-eyebrow" style={{ color: "var(--brand-primary)" }}>
          About
        </p>
        <h1
          className="font-display"
          style={{
            fontSize: "clamp(40px, 6vw, 64px)",
            color: "var(--text-strong)",
            margin: 0,
            lineHeight: 0.95,
          }}
        >
          SFBL Info
        </h1>
        <p style={{ marginTop: 8, color: "var(--muted)" }}>
          Everything new players and teams should know.
        </p>
      </header>

      <section className="prose" style={proseStyle}>
        <h2>The League</h2>
        <p>
          The South Florida Baseball League is one of the premier adult
          baseball organizations in Florida, operating in Miami-Dade,
          Broward, and Palm Beach counties. SFBL is a wood-bat league
          for adult men, split into three age divisions: 18+, 28+, and
          35+.
        </p>

        <h2>Seasons</h2>
        <p>
          We run two seasons per year — Spring and Fall — each with 12
          regular-season games plus postseason. Games are on Sundays,
          mornings and afternoons. SFBL is now in its 34th year of
          operation and 65th consecutive season of baseball.
        </p>

        <h2>Membership &amp; Cost</h2>
        <ul>
          <li>
            <strong>Player fee: $280 per season.</strong> Covers field
            rentals, umpire services, equipment, insurance, website +
            stats software, championship events, and admin.
          </li>
          <li>
            <strong>Uniforms:</strong> separate, $25–$45 depending on
            team selection.
          </li>
          <li>
            <strong>Championship prizes:</strong> $1,000 cash plus
            trophies and branded apparel for division winners.
          </li>
        </ul>

        <h2>Competition</h2>
        <p>
          SFBL emphasizes competitive parity through draft systems and
          player-pool assignments. Skill levels span former minor
          leaguers to dedicated recreational players. League-specific
          rules prioritize safety and sportsmanship.
        </p>

        <h2>Contact</h2>
        <ul>
          <li>
            Phone: <a href="tel:+17863720034">786-372-0034</a>
          </li>
          <li>
            Email:{" "}
            <a href="mailto:playball@sfbl.com">playball@sfbl.com</a>
          </li>
        </ul>

        <h2>Get Started</h2>
        <p style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a className="le-info-cta" href="/player-registration">
            Player Registration →
          </a>
          <a className="le-info-cta" href="/team-registration">
            Team Registration →
          </a>
          <a className="le-info-cta" href="/team-waiver-form">
            Team Waiver →
          </a>
          <a className="le-info-cta" href="/fields">
            Fields →
          </a>
        </p>
      </section>

      <style>{`
        .le-info-cta {
          display: inline-block;
          padding: 10px 18px;
          background: var(--brand-primary);
          color: white;
          border-radius: 999px;
          font-weight: 700;
          font-size: 13px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          text-decoration: none;
          transition: filter 0.15s ease;
        }
        .le-info-cta:hover {
          filter: brightness(1.1);
        }
      `}</style>
    </main>
  );
}

const proseStyle: React.CSSProperties = {
  color: "var(--text-strong)",
  lineHeight: 1.65,
  fontSize: 16,
};
