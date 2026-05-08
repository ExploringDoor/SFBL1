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
    teams,
    scheme,
    leagueName,
    throughDate,
    teamCount,
    hasFinalGames,
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

      {hasFinalGames ? (
        <StandingsTable
          groups={divisionGroups}
          teamMeta={teams}
          pointsScheme={scheme}
          variant="full"
        />
      ) : (
        // Pre-launch / launch-day state: every row is 0-0 and looks
        // like the site is broken. Show a friendly placeholder
        // instead. As soon as the first game lands as final, the
        // table renders with real W-L-T and this branch goes away.
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
    hasFinalGames: finalDates.length > 0,
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
