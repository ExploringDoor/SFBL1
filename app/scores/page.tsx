// DVSL-style scores page: heading + Scores|Schedule tabs + week
// selector + game cards grouped by day.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { loadGamesAndTeamsSnaps } from "@/lib/league-cache";
import { GameCard, type GameCardTeam } from "@/components/ui/GameCard";
import { computeWeeks, pickActiveWeek } from "@/lib/season-weeks";
import { computeStandings, type GameResult } from "@/lib/stats/shared";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { ScoresScheduleTabs, WeekRow } from "./tabs-and-weeks";
import { DivisionFilter } from "@/components/ui/DivisionFilter";
import { TeamFilter } from "@/components/ui/TeamFilter";
import { combineDateTime } from "@/lib/format-time";

export const dynamic = "force-dynamic";

// Tenant-neutral: the layout's title template appends "· <League>".
export const metadata = {
  title: "Scores",
  description: "Final scores from around the league, week by week.",
  // Self-canonical so the ?week=/?div=/?team= filter variants don't
  // compete as near-duplicates in search (audit 2026-07).
  alternates: { canonical: "/scores" },
};

interface ScoreGame {
  id: string;
  date: string;
  status: string;
  field: string | null;
  away_team_id: string;
  home_team_id: string;
  away_score: number;
  home_score: number;
  division: string | null;
  is_playoff: boolean;
}

export default async function ScoresPage({
  searchParams,
}: {
  searchParams?: { week?: string; div?: string; team?: string };
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

  // Division filter — same UX as /schedule. Options come from the
  // TEAMS' divisions (the same labels standings show), and a game
  // matches when EITHER team is in the division. The old approach
  // filtered on the games' free-text division field, which drifted
  // ("35+" vs "35+ American"/"35+ National") until picking the
  // standings-advertised label hid most of a season (audit 2026-07);
  // team divisions can't drift and interleague games show up for
  // both sides' fans.
  const allDivisions = Array.from(
    new Set(
      Object.values(teams)
        .map((t) => t.division)
        .filter((d): d is string => !!d),
    ),
  ).sort();
  const activeDivision = searchParams?.div ?? null;
  const inDivision = (g: ScoreGame) =>
    teams[g.away_team_id]?.division === activeDivision ||
    teams[g.home_team_id]?.division === activeDivision;
  const finalGames =
    activeDivision && activeDivision !== "all"
      ? allFinal.filter(inDivision)
      : allFinal;

  // Team filter — pick a team to see all the games they played this
  // season (Adam, 2026-06). Overrides the week view: every final game
  // for that team, chronologically. Options = every team with a final.
  const activeTeam = searchParams?.team ?? null;
  const teamOptions = Array.from(
    new Set(allFinal.flatMap((g) => [g.away_team_id, g.home_team_id])),
  )
    .map((id) => ({ id, name: teams[id]?.name ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const activeTeamName = activeTeam
    ? teams[activeTeam]?.name ?? activeTeam
    : null;

  const weeks = computeWeeks(finalGames);
  const activeStart = searchParams?.week ?? pickActiveWeek(weeks);
  const activeWeek = weeks.find((w) => w.startIso === activeStart) ?? null;
  const activeGames = activeTeam
    ? allFinal
        .filter(
          (g) => g.away_team_id === activeTeam || g.home_team_id === activeTeam,
        )
        .sort((a, b) => a.date.localeCompare(b.date))
    : activeWeek
      ? finalGames.filter((g) => activeWeek.dates.includes(g.date.slice(0, 10)))
      : [];

  const byDate = new Map<string, ScoreGame[]>();
  for (const g of activeGames) {
    const key = g.date.slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(g);
  }
  const dayGroups = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));

  // Week summary stats — total games, total runs, biggest blowout,
  // closest game. Surfaces editorial flavor for the active week
  // without making the page noisy when nothing notable happened.
  const weekSummary = activeTeam
    ? null
    : (() => {
    if (activeGames.length === 0) return null;
    let totalRuns = 0;
    let biggestMargin = -1;
    let biggestGameId: string | null = null;
    let closestMargin = Number.POSITIVE_INFINITY;
    let closestGameId: string | null = null;
    let highestCombined = -1;
    let highestGameId: string | null = null;
    for (const g of activeGames) {
      const margin = Math.abs(g.away_score - g.home_score);
      const total = g.away_score + g.home_score;
      totalRuns += total;
      if (margin > biggestMargin) {
        biggestMargin = margin;
        biggestGameId = g.id;
      }
      if (margin < closestMargin) {
        closestMargin = margin;
        closestGameId = g.id;
      }
      if (total > highestCombined) {
        highestCombined = total;
        highestGameId = g.id;
      }
    }
    return {
      gamesPlayed: activeGames.length,
      totalRuns,
      biggestGameId,
      biggestMargin,
      closestGameId,
      closestMargin,
      highestGameId,
      highestCombined,
    };
  })();

  // Build a per-game highlight map for the cards (closest / blowout
  // / shootout badges). Each game gets at most one badge — preferred
  // ordering: closest > blowout > shootout. Suppress badges when
  // there are fewer than 2 games in the active week (no comparison).
  const highlights = new Map<string, "closest" | "blowout" | "shootout">();
  if (weekSummary && activeGames.length >= 2) {
    if (weekSummary.closestGameId) {
      highlights.set(weekSummary.closestGameId, "closest");
    }
    if (
      weekSummary.biggestGameId &&
      !highlights.has(weekSummary.biggestGameId) &&
      weekSummary.biggestMargin >= 5
    ) {
      highlights.set(weekSummary.biggestGameId, "blowout");
    }
    if (
      weekSummary.highestGameId &&
      !highlights.has(weekSummary.highestGameId) &&
      weekSummary.highestCombined >= 15
    ) {
      highlights.set(weekSummary.highestGameId, "shootout");
    }
  }

  return (
    <main className="container py-10">
      <header className="mb-6">
        <h1 className="font-display" style={{ fontSize: "clamp(40px, 6vw, 64px)" }}>
          <span style={{ color: "var(--text-strong)" }}>Season</span>{" "}
          <span style={{ color: "var(--brand-primary)" }}>Scores</span>
        </h1>
        {config?.name && <p className="sec-eyebrow mt-1">{config.name}</p>}
      </header>

      <ScoresScheduleTabs active="scores" />

      {allDivisions.length > 1 && (
        <DivisionFilter
          divisions={allDivisions}
          active={activeDivision}
          basePath="/scores"
        />
      )}
      {teamOptions.length > 0 && (
        <TeamFilter
          teams={teamOptions}
          active={activeTeam}
          basePath="/scores"
        />
      )}

      {weeks.length === 0 ? (
        // No final games anywhere in the season yet — likely launch
        // day. Skip the week selector + day groups entirely; show a
        // friendly "season hasn't started" message instead of a blank
        // page that looks broken.
        <div
          className="mt-6"
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
          <strong style={{ color: "var(--brand-primary)" }}>
            No game results yet.
          </strong>
          <p style={{ margin: "8px 0 0", fontSize: 14 }}>
            Scores will appear here after the first games are played
            and captains submit final box scores.
          </p>
        </div>
      ) : (
        <>
          {activeTeam ? (
            <p
              className="font-barlow mb-2 mt-2"
              style={{
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "var(--muted)",
              }}
            >
              {activeTeamName} · {activeGames.length} game
              {activeGames.length === 1 ? "" : "s"} this season
            </p>
          ) : (
            <WeekRow
              weeks={weeks.map((w) => ({
                ...w,
                active: w.startIso === activeStart,
              }))}
              basePath="/scores"
            />
          )}

          {weekSummary && weekSummary.gamesPlayed > 0 && (
            <div className="scores-week-summary">
              <div className="scores-week-summary-stat">
                <span className="scores-week-summary-num">
                  {weekSummary.gamesPlayed}
                </span>
                <span className="scores-week-summary-lbl">
                  Game{weekSummary.gamesPlayed === 1 ? "" : "s"} this week
                </span>
              </div>
              <div className="scores-week-summary-stat">
                <span className="scores-week-summary-num">
                  {weekSummary.totalRuns}
                </span>
                <span className="scores-week-summary-lbl">
                  Total runs scored
                </span>
              </div>
              {weekSummary.gamesPlayed >= 2 && (
                <>
                  <div className="scores-week-summary-stat">
                    <span className="scores-week-summary-num">
                      {weekSummary.biggestMargin}
                    </span>
                    <span className="scores-week-summary-lbl">
                      Biggest margin
                    </span>
                  </div>
                  <div className="scores-week-summary-stat">
                    <span className="scores-week-summary-num">
                      {weekSummary.closestMargin === 0
                        ? "Tie"
                        : `${weekSummary.closestMargin}`}
                    </span>
                    <span className="scores-week-summary-lbl">
                      Closest margin
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {dayGroups.length === 0 ? (
            <p className="mt-6" style={{ color: "var(--muted)" }}>
              {activeTeam
                ? `No final games for ${activeTeamName} yet.`
                : "No final games this week — pick a different week above."}
            </p>
          ) : (
        <div className="space-y-8 mt-6">
          {dayGroups.map(([date, list]) => (
            <section key={date}>
              <header className="mb-3 flex items-baseline gap-3">
                <h2 className="font-display" style={{ fontSize: 24 }}>
                  {formatDayHeading(date)}
                </h2>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {list.length} game{list.length === 1 ? "" : "s"}
                </span>
              </header>
              <div className="le-gc-cards-grid">
                {list.map((g) => (
                  <GameCard
                    key={g.id}
                    gameId={g.id}
                    date={g.date}
                    away={teamCardData(g.away_team_id, teams, g.away_score)}
                    home={teamCardData(g.home_team_id, teams, g.home_score)}
                    badge={badgeFor(highlights.get(g.id))}
                    isPlayoff={g.is_playoff}
                  />
                ))}
              </div>
            </section>
          ))}
            </div>
          )}
        </>
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
  division?: string | null;
}

async function loadScores(tenantId: string): Promise<{
  games: ScoreGame[];
  teams: Record<string, TeamMeta>;
}> {
  const db = getAdminDb();
  const { gamesSnap, teamsSnap } = await loadGamesAndTeamsSnaps(db, tenantId);

  const games: ScoreGame[] = gamesSnap.docs.map((d) => {
    const data = d.data();
    // Combine date + time so preview cards show real start times
    // for not-yet-played games (same fix as /schedule, ticker,
    // homepage). When date already has a T, combineDateTime is
    // a no-op.
    const combinedDate = combineDateTime(
      data.date ? String(data.date) : null,
      data.time ? String(data.time) : null,
    );
    return {
      id: d.id,
      date: combinedDate,
      status: String(data.status ?? "draft"),
      field: data.field ? String(data.field) : null,
      away_team_id: String(data.away_team_id ?? ""),
      home_team_id: String(data.home_team_id ?? ""),
      away_score: Number(data.away_score ?? 0),
      home_score: Number(data.home_score ?? 0),
      division: data.division ? String(data.division) : null,
      is_playoff: data.is_playoff === true,
    };
  });

  const standingsGames: GameResult[] = games.map((g) => ({
    home_team_id: g.home_team_id,
    away_team_id: g.away_team_id,
    home_score: g.home_score,
    away_score: g.away_score,
    status: g.status as GameResult["status"],
    date: g.date,
    is_playoff: g.is_playoff,
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
      division: data.division ? String(data.division) : null,
    };
  }
  return { games, teams };
}

function teamCardData(
  id: string,
  teams: Record<string, TeamMeta>,
  score: number,
): GameCardTeam {
  const t = teams[id];
  return {
    team_id: id,
    name: t?.name ?? id,
    abbrev: t?.abbrev,
    color: t?.color,
    logoUrl: t?.logoUrl,
    record: t?.record,
    score,
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
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

// Map highlight type to a badge config the GameCard renders. Keep
// labels short — they appear in the card header next to the FINAL
// pill, so anything over 12 chars wraps awkwardly on mobile.
function badgeFor(
  highlight: "closest" | "blowout" | "shootout" | undefined,
): { emoji: string; label: string } | null {
  if (!highlight) return null;
  if (highlight === "closest") return { emoji: "🔥", label: "NAIL-BITER" };
  if (highlight === "blowout") return { emoji: "⚾", label: "BLOWOUT" };
  if (highlight === "shootout") return { emoji: "🏏", label: "SHOOTOUT" };
  return null;
}
