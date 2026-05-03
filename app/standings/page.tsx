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
} from "@/components/StandingsTable";

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

  const { divisionGroups, teams, scheme, leagueName, throughDate, teamCount } =
    await loadStandings(tenantId, config);

  const year = String(new Date().getFullYear());

  return (
    <main className="container py-10">
      <header className="mb-6">
        <h1 className="font-display" style={{ fontSize: "clamp(40px, 6vw, 64px)" }}>
          <span style={{ color: "var(--text-strong)" }}>Season</span>{" "}
          <span style={{ color: "var(--brand-primary)" }}>Standings</span>
        </h1>
        {leagueName && (
          <p className="sec-eyebrow mt-1">{leagueName}</p>
        )}
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

      <StandingsTable
        groups={divisionGroups}
        teamMeta={teams}
        pointsScheme={scheme}
        variant="full"
      />
    </main>
  );
}

async function loadStandings(tenantId: string, config: PublicLeagueConfig | null) {
  const db = getAdminDb();
  const [gamesSnap, teamsSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
  ]);

  const teams: Record<string, TeamMeta> = {};
  for (const d of teamsSnap.docs) {
    const data = d.data();
    teams[d.id] = {
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      color: data.color ? String(data.color) : undefined,
      logoUrl: data.logo_url ? String(data.logo_url) : null,
      division: data.division ? String(data.division) : undefined,
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

  let standings: StandingsRow[] = computeStandings(games);
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
    teams,
    scheme: usePoints ? scheme : null,
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
