// DVSL-style scores page: heading + Scores|Schedule tabs + week
// selector + game cards grouped by day.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { GameCard, type GameCardTeam } from "@/components/GameCard";
import { computeWeeks, pickActiveWeek } from "@/lib/season-weeks";
import { computeStandings, type GameResult } from "@/lib/stats/shared";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { ScoresScheduleTabs, WeekRow, AgeFilterRow } from "./tabs-and-weeks";
import { buildAgeFilter } from "@/lib/age-filter";

export const dynamic = "force-dynamic";

interface ScoreGame {
  id: string;
  date: string;
  status: string;
  field: string | null;
  away_team_id: string;
  home_team_id: string;
  away_score: number;
  home_score: number;
}

export default async function ScoresPage({
  searchParams,
}: {
  searchParams?: { week?: string; age?: string };
}) {
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

  const { games, teams } = await loadScores(tenantId);
  const allFinal = games.filter(
    (g) => g.status === "final" || g.status === "approved",
  );

  // Age-group filter (COYBL). Scope before computing weeks so the week tabs
  // only show weeks with games for the selected age.
  const { selectedAge, ageOptions, ageOf } = buildAgeFilter(teams, searchParams?.age);
  const finalGames = selectedAge
    ? allFinal.filter((g) => ageOf(g.home_team_id, g.away_team_id) === selectedAge)
    : allFinal;

  const weeks = computeWeeks(finalGames);
  const activeStart = searchParams?.week ?? pickActiveWeek(weeks);
  const activeWeek = weeks.find((w) => w.startIso === activeStart) ?? null;
  const activeGames = activeWeek
    ? finalGames.filter((g) => activeWeek.dates.includes(g.date.slice(0, 10)))
    : [];

  const byDate = new Map<string, ScoreGame[]>();
  for (const g of activeGames) {
    const key = g.date.slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(g);
  }
  const dayGroups = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <main className="container py-10">
      <header className="mb-6">
        <h1 className="font-display" style={{ fontSize: "clamp(40px, 6vw, 64px)" }}>
          <span style={{ color: "var(--text-strong)" }}>Season</span>{" "}
          <span style={{ color: "var(--brand-primary)" }}>Scores</span>
        </h1>
        {config?.name && <p className="sec-eyebrow mt-1">{config.name}</p>}
      </header>

      <ScoresScheduleTabs active="scores" age={selectedAge ?? undefined} />
      <AgeFilterRow ages={ageOptions} basePath="/scores" />
      <WeekRow
        weeks={weeks.map((w) => ({ ...w, active: w.startIso === activeStart }))}
        basePath="/scores"
        age={selectedAge ?? undefined}
      />

      {dayGroups.length === 0 ? (
        <p className="mt-6" style={{ color: "var(--muted)" }}>
          No final games this week.
        </p>
      ) : (
        <div className="space-y-8 mt-6">
          {dayGroups.map(([date, list]) => (
            <section key={date}>
              <header className="mb-3 flex items-baseline gap-3">
                <h3 className="font-display" style={{ fontSize: 24 }}>
                  {formatDayHeading(date)}
                </h3>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {list.length} game{list.length === 1 ? "" : "s"}
                </span>
              </header>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {list.map((g) => (
                  <GameCard
                    key={g.id}
                    id={g.id}
                    date={g.date}
                    field={g.field}
                    status={g.status}
                    away={teamCardData(g.away_team_id, teams)}
                    home={teamCardData(g.home_team_id, teams)}
                    awayScore={g.away_score}
                    homeScore={g.home_score}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

interface TeamMeta {
  name: string;
  abbrev?: string;
  color?: string;
  logoUrl?: string | null;
  record?: string;
  ageGroup?: string;
}

async function loadScores(tenantId: string): Promise<{
  games: ScoreGame[];
  teams: Record<string, TeamMeta>;
}> {
  const db = getAdminDb();
  const [gamesSnap, teamsSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
  ]);

  const games: ScoreGame[] = gamesSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      date: data.date ? String(data.date) : "",
      status: String(data.status ?? "draft"),
      field: data.field ? String(data.field) : null,
      away_team_id: String(data.away_team_id ?? ""),
      home_team_id: String(data.home_team_id ?? ""),
      away_score: Number(data.away_score ?? 0),
      home_score: Number(data.home_score ?? 0),
    };
  });

  const standingsGames: GameResult[] = games.map((g) => ({
    home_team_id: g.home_team_id,
    away_team_id: g.away_team_id,
    home_score: g.home_score,
    away_score: g.away_score,
    status: g.status as GameResult["status"],
    date: g.date,
  }));
  const standings = computeStandings(standingsGames);
  const recordByTeam = new Map(
    standings.map((r) => [r.team_id, formatRecord(r.w, r.l, r.t)]),
  );

  const teams: Record<string, TeamMeta> = {};
  for (const d of teamsSnap.docs) {
    const data = d.data();
    teams[d.id] = {
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      color: data.color ? String(data.color) : undefined,
      logoUrl: data.logo_url ? String(data.logo_url) : null,
      record: recordByTeam.get(d.id),
      ageGroup: data.ageGroup ? String(data.ageGroup) : undefined,
    };
  }
  return { games, teams };
}

function teamCardData(id: string, teams: Record<string, TeamMeta>): GameCardTeam {
  const t = teams[id];
  return {
    team_id: id,
    name: t?.name ?? id,
    abbrev: t?.abbrev,
    color: t?.color,
    logoUrl: t?.logoUrl,
    record: t?.record,
  };
}

function formatDayHeading(yyyyMmDd: string): string {
  const d = new Date(yyyyMmDd + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatRecord(w: number, l: number, t: number): string {
  return t > 0 ? `(${w}-${l}-${t})` : `(${w}-${l})`;
}
