import Link from "next/link";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  computeStandings,
  sortByPoints,
  type GameResult,
  type StandingsRow,
} from "@/lib/stats/shared";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { GameCard, type GameCardTeam } from "@/components/GameCard";
import {
  StandingsTable,
  type DivisionGroup,
  type TeamMeta,
} from "@/components/StandingsTable";

export const dynamic = "force-dynamic";

interface ScheduleItem {
  id: string;
  date: string;
  field: string | null;
  status: string;
  away_team_id: string;
  home_team_id: string;
  away_score: number;
  home_score: number;
}

export default async function HomePage() {
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

  if (!tenantId) return <BareApex />;

  const { upcoming, recent, teams, divisionGroups, scheme, leagueName } =
    await loadHomeData(tenantId, config);

  return (
    <main>
      <Hero
        leagueName={leagueName}
        leagueAbbrev={config?.abbrev}
        season={String(new Date().getFullYear())}
      />

      <section className="sec">
        <div className="container">
          <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
            {/* MAIN COLUMN: recent scores + upcoming schedule */}
            <div className="space-y-12">
              {recent.length > 0 && (
                <div>
                  <SectionHead
                    eyebrow={`${currentSeasonLabel()} Season`}
                    title="Recent Scores"
                    rightLink={{ href: "/scores", label: "All scores →" }}
                  />
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {recent.map((g) => (
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
                </div>
              )}

              <div>
                <SectionHead
                  eyebrow={`${currentSeasonLabel()} Season`}
                  title="Upcoming Schedule"
                  rightLink={{ href: "/schedule", label: "Full schedule →" }}
                />
                {upcoming.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">No upcoming games.</p>
                ) : (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {upcoming.map((g) => (
                      <GameCard
                        key={g.id}
                        id={g.id}
                        date={g.date}
                        field={g.field}
                        status={g.status}
                        away={teamCardData(g.away_team_id, teams)}
                        home={teamCardData(g.home_team_id, teams)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* SIDEBAR: standings */}
            <aside>
              <header className="mb-3 flex items-baseline justify-between">
                <h3
                  className="font-barlow"
                  style={{
                    fontSize: 20,
                    fontWeight: 900,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--text-strong)",
                  }}
                >
                  Standings
                </h3>
                <Link
                  href="/standings"
                  className="font-barlow"
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    color: "var(--brand-primary)",
                  }}
                >
                  Full →
                </Link>
              </header>
              <StandingsTable
                groups={divisionGroups}
                teamMeta={teams}
                pointsScheme={scheme}
                variant="compact"
              />
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}

function SectionHead({
  eyebrow,
  title,
  rightLink,
}: {
  eyebrow: string;
  title: string;
  rightLink?: { href: string; label: string };
}) {
  return (
    <header className="flex items-end justify-between">
      <div>
        <p className="sec-eyebrow">{eyebrow}</p>
        <h2 className="sec-title mt-1">{title}</h2>
      </div>
      {rightLink && (
        <Link
          href={rightLink.href}
          className="font-barlow"
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "var(--brand-primary)",
          }}
        >
          {rightLink.label}
        </Link>
      )}
    </header>
  );
}

function Hero({
  leagueName,
  leagueAbbrev,
  season,
}: {
  leagueName: string;
  leagueAbbrev?: string;
  season: string;
}) {
  const big = leagueAbbrev ?? deriveAbbrev(leagueName);
  return (
    <section className="hero">
      <div className="hero-bg" />
      <div className="hero-overlay" />
      <div className="hero-content">
        <span className="hero-pill">⚾ {season} Regular Season</span>
        <h1 className="hero-title">
          {big} <em>{season}</em>
        </h1>
        <p className="hero-sub">{leagueName}</p>
      </div>
    </section>
  );
}

function deriveAbbrev(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 4);
}

async function loadHomeData(tenantId: string, config: PublicLeagueConfig | null) {
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

  const allGameItems: ScheduleItem[] = gamesSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      date: data.date ? String(data.date) : "",
      field: data.field ? String(data.field) : null,
      status: String(data.status ?? "draft"),
      home_team_id: String(data.home_team_id ?? ""),
      away_team_id: String(data.away_team_id ?? ""),
      home_score: Number(data.home_score ?? 0),
      away_score: Number(data.away_score ?? 0),
    };
  });

  const allGameResults: GameResult[] = allGameItems.map((g) => ({
    home_team_id: g.home_team_id,
    away_team_id: g.away_team_id,
    home_score: g.home_score,
    away_score: g.away_score,
    status: g.status as GameResult["status"],
    date: g.date,
  }));

  let standings: StandingsRow[] = computeStandings(allGameResults);
  const scheme = config?.standings?.points_per ?? null;
  const usePoints = config?.standings?.scoring === "points" && !!scheme;
  const tiebreaker = config?.standings?.tiebreaker ?? "rd";
  if (usePoints && scheme) {
    standings = sortByPoints(standings, scheme, tiebreaker);
  }
  const divisionGroups = groupByDivision(standings, teams);

  // Records by team for game cards.
  const recordByTeam = new Map(
    standings.map((r) => [r.team_id, formatRecord(r.w, r.l, r.t)]),
  );

  // Recent: most recent 4 finals, oldest first within the slice.
  const recent = allGameItems
    .filter((g) => g.status === "final" || g.status === "approved")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4)
    .reverse();

  // Upcoming: next 6 scheduled.
  const upcoming = allGameItems
    .filter((g) => g.status === "scheduled" && g.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);

  // Attach records to teams meta so GameCard's record sub-line shows.
  for (const id of Object.keys(teams)) {
    (teams[id] as TeamMeta & { record?: string }).record = recordByTeam.get(id);
  }

  return {
    upcoming,
    recent,
    teams,
    divisionGroups,
    scheme: usePoints ? scheme : null,
    leagueName: config?.name ?? "League",
  };
}

function teamCardData(id: string, teams: Record<string, TeamMeta>): GameCardTeam {
  const t = teams[id] as TeamMeta & { record?: string };
  return {
    team_id: id,
    name: t?.name ?? id,
    abbrev: t?.abbrev,
    color: t?.color,
    logoUrl: t?.logoUrl,
    record: t?.record,
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

function formatRecord(w: number, l: number, t: number): string {
  return t > 0 ? `(${w}-${l}-${t})` : `(${w}-${l})`;
}

function currentSeasonLabel(): string {
  return String(new Date().getFullYear());
}

function BareApex() {
  return (
    <main className="container py-16">
      <h1 className="font-display text-4xl">League Platform</h1>
      <p className="mt-2 text-slate-600">
        Multi-tenant SaaS for amateur sports leagues.
      </p>
    </main>
  );
}
