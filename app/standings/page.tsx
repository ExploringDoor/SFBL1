// DVSL-style standings page: two-tone heading, year tabs (single year
// for SFBL until historical data lands), points rubric (when league
// uses points scoring), column legend, then per-division StandingsTable
// in full mode.
//
// Tenants WITHOUT an age-group hierarchy (e.g. SFBL) keep the original
// behavior exactly: global standings, bucketed by a flat `division`
// string. Tenants WITH `ageGroup` on their team docs (e.g. COYBL, a
// youth league) get a two-level Age Group -> Division hierarchy, and
// each division's standings are computed from that division's games
// alone (so W/L, GB, and rank are correct per division).

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
} from "@/components/StandingsTable";

export const dynamic = "force-dynamic";

interface AgeSection {
  ageGroup: string | null;
  groups: DivisionGroup[];
}

type TeamMetaPlus = TeamMeta & { ageGroup?: string };

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

  const { ageSections, teams, scheme, leagueName, throughDate, teamCount } =
    await loadStandings(tenantId, config);

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
        {/* Only the current season for now; historical snapshots come later. */}
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

      {/* Age-group jump tabs (youth leagues with many age groups). */}
      {grouped && ageSections.length > 1 && (
        <nav
          aria-label="Jump to age group"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 22,
          }}
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

async function loadStandings(tenantId: string, config: PublicLeagueConfig | null) {
  const db = getAdminDb();
  const [gamesSnap, teamsSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
  ]);

  const teams: Record<string, TeamMetaPlus> = {};
  for (const d of teamsSnap.docs) {
    const data = d.data();
    teams[d.id] = {
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      color: data.color ? String(data.color) : undefined,
      logoUrl: data.logo_url ? String(data.logo_url) : null,
      division: data.division ? String(data.division) : undefined,
      ageGroup: data.ageGroup ? String(data.ageGroup) : undefined,
    };
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

  const usePoints =
    config?.standings?.scoring === "points" && !!config?.standings?.points_per;
  const scheme = usePoints ? config!.standings!.points_per! : null;
  const tiebreaker = config?.standings?.tiebreaker ?? "rd";

  const rank = (subset: GameResult[]): StandingsRow[] => {
    let rows = computeStandings(subset);
    if (usePoints && scheme) rows = sortByPoints(rows, scheme, tiebreaker);
    return rows;
  };

  const hasAgeGroups = Object.values(teams).some((t) => t.ageGroup);

  let ageSections: AgeSection[];

  if (hasAgeGroups) {
    // Two-level hierarchy: Age Group -> Division. Each division's standings
    // are computed from games among that division's teams only.
    const byAge = new Map<string, Map<string, string[]>>();
    for (const [id, t] of Object.entries(teams)) {
      const ageGroup = t.ageGroup ?? "Other";
      const division = t.division ?? "Division";
      if (!byAge.has(ageGroup)) byAge.set(ageGroup, new Map());
      const divMap = byAge.get(ageGroup)!;
      if (!divMap.has(division)) divMap.set(division, []);
      divMap.get(division)!.push(id);
    }

    ageSections = [...byAge.entries()]
      .sort(([a], [b]) => ageOrder(a) - ageOrder(b))
      .map(([ageGroup, divMap]) => {
        const groups: DivisionGroup[] = [...divMap.entries()]
          .sort(([a], [b]) => divOrder(a) - divOrder(b))
          .map(([division, ids]) => {
            const idSet = new Set(ids);
            const divGames = games.filter(
              (g) => idSet.has(g.home_team_id) && idSet.has(g.away_team_id),
            );
            return { division, rows: rank(divGames) };
          });
        return { ageGroup, groups };
      });
  } else {
    // Flat fallback (SFBL behavior, unchanged): global standings bucketed
    // by a flat division string.
    const standings = rank(games);
    ageSections = [{ ageGroup: null, groups: groupByDivision(standings, teams) }];
  }

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
    ageSections,
    teams,
    scheme,
    leagueName: config?.name ?? null,
    throughDate,
    teamCount: teamsSnap.size,
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
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([division, rows]) => ({ division, rows }));
}

// "7U" -> 7, "10U" -> 10, "14U" -> 14. Unknown sorts last.
function ageOrder(ageGroup: string): number {
  const m = ageGroup.match(/\d+/);
  return m ? parseInt(m[0], 10) : 999;
}

// "Division 1" -> 1, "Division 5A" -> 5.01, "Division 5B" -> 5.02.
// Keeps numbered tiers in order and A/B splits adjacent. Unknown sorts last.
function divOrder(division: string): number {
  const m = division.match(/(\d+)\s*([A-Za-z]?)/);
  if (!m || m[1] == null) return 999;
  const n = parseInt(m[1], 10);
  const sub = m[2] ? (m[2].toUpperCase().charCodeAt(0) - 64) / 100 : 0;
  return n + sub;
}
