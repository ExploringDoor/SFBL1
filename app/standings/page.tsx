// Standings page: two-tone heading, year tab, points rubric (when the
// league uses points scoring), column legend, then per-division
// StandingsTable in full mode. Age-grouped tenants (COYBL) get age-group
// jump tabs + a section per age; flat tenants (SFBL) get one section.
// All grouping logic lives in lib/standings.ts.

import { headers } from "next/headers";
import { loadStandingsSections } from "@/lib/standings";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { StandingsTable } from "@/components/StandingsTable";

export const dynamic = "force-dynamic";

export default async function StandingsPage() {
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

  const { ageSections, teams, scheme, throughDate, teamCount } =
    await loadStandingsSections(tenantId, config);
  const leagueName = config?.name ?? null;
  const year = String(new Date().getFullYear());
  const grouped = ageSections.length > 0 && ageSections[0]?.ageGroup != null;

  return (
    <main className="container py-10">
      <header className="mb-6">
        <h1 className="font-display" style={{ fontSize: "clamp(40px, 6vw, 64px)" }}>
          <span style={{ color: "var(--text-strong)" }}>Season</span>{" "}
          <span style={{ color: "var(--brand-primary)" }}>Standings</span>
        </h1>
        {leagueName && <p className="sec-eyebrow mt-1">{leagueName}</p>}
      </header>

      <div className="year-tabs mb-6">
        <button className="yr-tab active">{year}</button>
      </div>

      <header className="mb-3">
        <h2 className="font-display" style={{ fontSize: 38 }}>
          {year}
        </h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Current Standings · {teamCount} Teams · Through {throughDate}
        </p>
      </header>

      {scheme && (
        <div className="mb-4">
          <div className="pts-rubric">
            <span className="pr-label">Points</span>
            <span className="pr-chip">
              <b>{scheme.win}</b> Win
            </span>
            <span className="pr-chip">
              <b>{scheme.tie}</b> Tie
            </span>
            <span className="pr-chip">
              <b>{scheme.loss}</b> Loss
            </span>
            <span style={{ marginLeft: 6 }}>
              — {leagueName ?? "this league"}'s primary standings determinant
            </span>
          </div>
        </div>
      )}

      <div className="legend mb-4">
        {scheme && (
          <span>
            <b>PTS</b> Total Points
          </span>
        )}
        <span>
          <b>W</b> Wins
        </span>
        <span>
          <b>L</b> Losses
        </span>
        <span>
          <b>T</b> Ties
        </span>
        <span>
          <b>PCT</b> Win %
        </span>
        <span>
          <b>GB</b> Games Behind
        </span>
        <span>
          <b>RS</b> Runs Scored
        </span>
        <span>
          <b>RA</b> Runs Allowed
        </span>
        <span>
          <b>DIFF</b> Differential
        </span>
        <span>
          <b>STRK</b> Streak
        </span>
      </div>

      {grouped && ageSections.length > 1 && (
        <nav
          aria-label="Jump to age group"
          style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}
        >
          {ageSections.map((s) => (
            <a
              key={s.ageGroup}
              href={`#age-${s.ageGroup}`}
              style={{
                display: "inline-block",
                padding: "6px 14px",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--brand-primary)",
                fontWeight: 800,
                fontSize: 13,
                letterSpacing: "0.04em",
                textDecoration: "none",
              }}
            >
              {s.ageGroup}
            </a>
          ))}
        </nav>
      )}

      {ageSections.map((section) => (
        <section
          key={section.ageGroup ?? "all"}
          id={section.ageGroup ? `age-${section.ageGroup}` : undefined}
          style={{ marginBottom: section.ageGroup ? 36 : 0, scrollMarginTop: 16 }}
        >
          {section.ageGroup && (
            <h2
              className="font-display"
              style={{
                fontSize: 30,
                marginBottom: 14,
                color: "var(--brand-primary)",
                borderBottom: "3px solid var(--brand-primary)",
                paddingBottom: 6,
              }}
            >
              {section.ageGroup}
            </h2>
          )}
          <StandingsTable
            groups={section.groups}
            teamMeta={teams}
            pointsScheme={scheme}
            variant="full"
          />
        </section>
      ))}
    </main>
  );
}
