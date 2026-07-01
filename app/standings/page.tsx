// DVSL-style standings page: two-tone heading, year tabs (single year
// for SFBL until historical data lands), points rubric (when league
// uses points scoring), column legend, then per-division StandingsTable
// in full mode.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  computeStandings,
  sortByPoints,
  type GameResult,
  type StandingsRow,
} from "@/lib/stats/shared";
import type { PublicLeagueConfig } from "@/lib/tenants";
import {
  StandingsTable,
  type DivisionGroup,
  type TeamMeta,
} from "@/components/ui/StandingsTable";
import { buildAgeSections, recordsToStandings } from "@/lib/age-standings";

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

  const {
    divisionGroups,
    ageSections,
    hasAge,
    teams,
    scheme,
    throughDate,
    teamCount,
    hasFinalGames,
    useStoredRecords,
  } = await loadStandings(tenantId, config);

  const year = String(new Date().getFullYear());

  return (
    <main className="container py-10">
      <header className="mb-8">
        <p
          className="font-barlow"
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--brand-primary)",
            marginBottom: 6,
          }}
        >
          Standings
        </p>
        <h1
          className="font-barlow"
          style={{
            fontSize: "clamp(36px, 5vw, 54px)",
            fontWeight: 900,
            textTransform: "uppercase",
            lineHeight: 0.95,
            letterSpacing: "-0.01em",
            color: "var(--text-strong)",
            margin: 0,
          }}
        >
          {seasonLabel(year)}
        </h1>
        <p
          style={{
            marginTop: 8,
            fontSize: 14,
            color: "var(--muted)",
            fontFamily: "var(--font-inter), sans-serif",
          }}
        >
          {hasFinalGames
            ? `Through ${throughDate} · ${teamCount} teams`
            : `${teamCount} team${teamCount === 1 ? "" : "s"} · season starts soon`}
        </p>
      </header>

      {!hasFinalGames ? (
        // Pre-launch / launch-day state: every row is 0-0 and looks
        // like the site is broken. Show a friendly placeholder instead.
        <div
          style={{
            padding: "32px 24px",
            background: "rgba(0,0,0,0.03)",
            border: "1px dashed rgba(0,0,0,0.12)",
            borderRadius: 12,
            textAlign: "center",
            color: "var(--muted)",
            lineHeight: 1.55,
          }}
        >
          <strong style={{ color: "var(--brand-primary)", fontSize: 16 }}>
            Standings will appear after the first game is final.
          </strong>
          <p style={{ margin: "8px 0 0", fontSize: 14 }}>
            Captains submit final box scores after games; standings
            recalculate automatically.
          </p>
        </div>
      ) : hasAge ? (
        // Age-grouped (COYBL): a jump nav + a section per age group, each
        // with its own divisions.
        <>
          {ageSections.length > 1 && (
            <nav
              aria-label="Jump to age group"
              style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}
            >
              {ageSections.map((s) => (
                <a
                  key={s.ageGroup}
                  href={`#age-${s.ageGroup}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    minHeight: 44,
                    boxSizing: "border-box",
                    padding: "6px 14px",
                    borderRadius: 999,
                    border: "1px solid rgba(0,0,0,0.12)",
                    background: "#fff",
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
          {ageSections.map((s) => (
            <section
              key={s.ageGroup}
              id={`age-${s.ageGroup}`}
              style={{ marginBottom: 36, scrollMarginTop: 16 }}
            >
              <h2
                className="font-barlow"
                style={{
                  fontSize: 28,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  color: "var(--brand-primary)",
                  borderBottom: "3px solid var(--brand-primary)",
                  paddingBottom: 6,
                  marginBottom: 14,
                }}
              >
                {s.ageGroup}
              </h2>
              <StandingsTable
                groups={s.divisionGroups}
                teamMeta={teams}
                pointsScheme={scheme}
                variant="full"
                showExtras={!useStoredRecords}
                showRecentForm={false}
              />
            </section>
          ))}
        </>
      ) : (
        <StandingsTable
          groups={divisionGroups}
          teamMeta={teams}
          pointsScheme={scheme}
          variant="full"
          showExtras={!useStoredRecords}
          showRecentForm={config?.abbrev !== "SFBL" && tenantId !== "sfbl"}
        />
      )}

      {/* Footer CTA: surface the league archive at the bottom of the
          standings page since users who care about today's standings
          are exactly the ones likely to want past-season comparisons.
          /history renders an empty-state message for tenants without
          archived data, so this link is harmless in that case. */}
      <p
        style={{
          marginTop: 24,
          fontSize: 13,
          color: "var(--muted)",
          textAlign: "center",
        }}
      >
        Looking for past seasons?{" "}
        <a
          href="/history"
          style={{
            color: "var(--brand-primary)",
            fontWeight: 700,
            textDecoration: "underline",
          }}
        >
          View league history →
        </a>
      </p>
    </main>
  );
}

// "Spring 2026" / "Summer 2026" — picked from the current month so
// the standings header reads like a real season label.
function seasonLabel(year: string): string {
  const m = new Date().getMonth();
  if (m >= 2 && m <= 4) return `Spring ${year}`;
  if (m >= 5 && m <= 7) return `Summer ${year}`;
  if (m >= 8 && m <= 10) return `Fall ${year}`;
  return `Winter ${year}`;
}

async function loadStandings(tenantId: string, config: PublicLeagueConfig | null) {
  const db = getAdminDb();
  const [gamesSnap, teamsSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
  ]);

  const teams: Record<string, TeamMeta> = {};
  // Parallel age map for COYBL's Age Group -> Division hierarchy (kept off
  // TeamMeta since that type is shared with the flat-division StandingsTable).
  const teamExtra: Record<
    string,
    { ageGroup?: string; ageOrder: number; divOrder: number }
  > = {};
  // Stored league records (stats-off leagues like COYBL): the exact W-L
  // from the source site, since it can't be recomputed from the games.
  const records: Record<string, { w: number; l: number; t: number }> = {};
  for (const d of teamsSnap.docs) {
    const data = d.data();
    teams[d.id] = {
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      color: data.color ? String(data.color) : undefined,
      logoUrl: data.logo_url ? String(data.logo_url) : null,
      division: data.division ? String(data.division) : undefined,
    };
    teamExtra[d.id] = {
      ageGroup: data.ageGroup ? String(data.ageGroup) : undefined,
      ageOrder: typeof data.ageOrder === "number" ? data.ageOrder : 999,
      divOrder: typeof data.divOrder === "number" ? data.divOrder : 999,
    };
    if (typeof data.w === "number" && typeof data.l === "number") {
      records[d.id] = {
        w: data.w,
        l: data.l,
        t: typeof data.t === "number" ? data.t : 0,
      };
    }
  }

  const games: GameResult[] = gamesSnap.docs.map((d) => {
    const data = d.data();
    return {
      home_team_id: String(data.home_team_id ?? ""),
      away_team_id: String(data.away_team_id ?? ""),
      home_score: Number(data.home_score ?? 0),
      away_score: Number(data.away_score ?? 0),
      status: (data.status ?? "draft") as GameResult["status"],
      date: data.date ? String(data.date) : undefined,
    };
  });

  // Stats-off leagues (COYBL) display the EXACT stored league records —
  // the source site flags which games count, so recomputing from the
  // seeded games (which include cross-division play) would be wrong.
  const useStoredRecords =
    config?.flags?.stats_enabled === false && Object.keys(records).length > 0;
  let standings: StandingsRow[] = useStoredRecords
    ? recordsToStandings(records)
    : computeStandings(games);
  const scheme = config?.standings?.points_per ?? null;
  const usePoints = config?.standings?.scoring === "points" && !!scheme;
  if (usePoints && scheme) {
    standings = sortByPoints(
      standings,
      scheme,
      config?.standings?.tiebreaker ?? "rd",
    );
  }

  const divisionGroups = groupByDivision(standings, teams);
  // Age-grouped tenants (COYBL): build Age Group -> Division sections. Flat
  // tenants (SFBL/LBDC) have no team.ageGroup, so hasAge is false.
  const hasAge = Object.values(teamExtra).some((t) => t.ageGroup);
  const ageSections = hasAge
    ? buildAgeSections(standings, teams, teamExtra)
    : [];

  // Latest game date — drives "Through Mar 29, 2026" subtitle.
  const finalDates = games
    .filter((g) => g.status === "final" || g.status === "approved")
    .map((g) => g.date ?? "")
    .filter(Boolean)
    .sort();
  const lastDate = finalDates[finalDates.length - 1];
  const throughDate = lastDate
    ? new Date(lastDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "today";

  return {
    divisionGroups,
    ageSections,
    hasAge,
    teams,
    scheme: usePoints ? scheme : null,
    leagueName: config?.name ?? null,
    throughDate,
    teamCount: teamsSnap.size,
    // With stored records, standings come from the teams (not games), so
    // "has standings" means teams exist — not that games are final.
    hasFinalGames: useStoredRecords
      ? standings.length > 0
      : finalDates.length > 0,
    useStoredRecords,
  };
}

function groupByDivision(
  rows: StandingsRow[],
  teamMeta: Record<string, TeamMeta>,
): DivisionGroup[] {
  const anyDivision = rows.some((r) => teamMeta[r.team_id]?.division);
  if (!anyDivision) return [{ division: null, rows }];
  const buckets = new Map<string, StandingsRow[]>();
  for (const r of rows) {
    const div = teamMeta[r.team_id]?.division ?? "Other";
    if (!buckets.has(div)) buckets.set(div, []);
    buckets.get(div)!.push(r);
  }
  // Sort key: Saturday-style "main" divisions ALWAYS render first,
  // even when alphabetical ordering would slot them after another
  // division (e.g. "Boomers 60/70" sorts before "Saturday Division"
  // by default). Adam's LBDC convention is Saturday → Boomers, so
  // we encode that here. Anything that doesn't start with
  // "Saturday" / "Main" falls back to alphabetical.
  return [...buckets.entries()]
    .sort(([a], [b]) => divisionSortKey(a).localeCompare(divisionSortKey(b)))
    .map(([division, rows]) => ({ division, rows }));
}

function divisionSortKey(div: string): string {
  if (/^saturday/i.test(div)) return "0_" + div;
  if (/^main/i.test(div)) return "0_" + div;
  return "1_" + div;
}
