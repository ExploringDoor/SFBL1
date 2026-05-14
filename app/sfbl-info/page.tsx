// "About the league" page. Originally hardcoded SFBL content; now
// tenant-aware: reads `/leagues/<id>/page_content/sfbl-info` when set
// and renders that, otherwise falls back to the SFBL prose below.
//
// The route is still `/sfbl-info` for back-compat with existing
// inbound links; the heading and link label become "About <league>"
// based on tenant config.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { markdownToHtml } from "@/lib/markdown";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { PageContentEditor } from "@/components/PageContentEditor";

export const dynamic = "force-dynamic";

export default async function SfblInfoPage() {
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

  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

  const leagueName = config?.name ?? "the league";
  const abbrev = config?.abbrev;
  const heading = `About ${abbrev ?? leagueName}`;

  // Prefer tenant-edited content (admin → Pages → "sfbl-info") when
  // present. Falls through to the SFBL fallback content for tenants
  // that haven't published anything custom.
  const db = getAdminDb();
  const docSnap = await db
    .doc(`leagues/${tenantId}/page_content/sfbl-info`)
    .get();
  const data = docSnap.exists ? docSnap.data() ?? {} : {};
  const cachedHtml =
    typeof data.html === "string" && data.html ? String(data.html) : "";
  const markdown = String(data.markdown ?? "");
  const html =
    cachedHtml || (markdown ? markdownToHtml(markdown) : "");
  const updatedAt = data.updated_at as string | undefined;

  // SFBL has been served by the hardcoded fallback for months — keep
  // that path live so the public site doesn't go blank if the doc
  // ever gets deleted.
  const isSfbl = tenantId === "sfbl" || abbrev === "SFBL";

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
          {heading}
        </h1>
        <p style={{ marginTop: 8, color: "var(--muted)" }}>
          Everything new players and teams should know.
        </p>
        {updatedAt && (
          <p
            style={{
              marginTop: 4,
              fontSize: 12,
              color: "var(--muted)",
            }}
          >
            Last updated{" "}
            {new Date(updatedAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        )}
      </header>

      {html ? (
        <article
          className="prose"
          style={proseStyle}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : isSfbl ? (
        <SfblFallback />
      ) : (
        <div
          style={{
            padding: "24px 18px",
            background: "rgba(0,0,0,0.03)",
            border: "1px dashed rgba(0,0,0,0.12)",
            borderRadius: 12,
            color: "var(--muted)",
            lineHeight: 1.55,
          }}
        >
          <strong style={{ color: "var(--brand-primary)" }}>
            This page hasn't been written yet.
          </strong>
          <p style={{ marginTop: 8 }}>
            Sign in as a league administrator and click <b>Edit</b> below
            to add an About page for {leagueName}.
          </p>
        </div>
      )}

      <PageContentEditor
        tenantId={tenantId}
        pageId="sfbl-info"
        initialMarkdown={markdown}
        editHeading="Edit About page (markdown)"
      />

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

// Original hardcoded SFBL prose. Kept as a fallback for the SFBL
// tenant in case the page_content/sfbl-info doc gets deleted —
// guarantees no blank page for the legacy production site.
function SfblFallback() {
  return (
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
  );
}

const proseStyle: React.CSSProperties = {
  color: "var(--text-strong)",
  lineHeight: 1.65,
  fontSize: 16,
};
