// DVSL-style standings page: two-tone heading, year tabs (single year
// for SFBL until historical data lands), points rubric (when league
// uses points scoring), column legend, then per-division StandingsTable
// in full mode.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { loadGamesAndTeamsSnaps } from "@/lib/league-cache";
import {
  computeStandings,
  sortByPoints,
  type GameResult,
  type StandingsRow,
} from "@/lib/stats/shared";
import { captainNoun, type PublicLeagueConfig } from "@/lib/tenants";
import {
  loadSeasonConfig,
  resolveActiveSeason,
  publicSeasons,
  inSeason,
} from "@/lib/season";
import { formatGameDate } from "@/lib/format-time";
import {
  StandingsTable,
  type DivisionGroup,
  type TeamMeta,
} from "@/components/ui/StandingsTable";

export const dynamic = "force-dynamic";

// Tenant-neutral: the layout's title template appends "· <League>".
export const metadata = {
  title: "Standings",
  description: "Current league standings by division.",
};

export default async function StandingsPage({
  searchParams,
}: {
  searchParams?: { season?: string };
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
  const captain = captainNoun(config);

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
  } = await loadStandings(tenantId, config, searchParams?.season);

  // Season switcher data. Renders nothing until a league has 2+ seasons
  // configured (i.e. after the first season flip), so it's invisible while
  // a league is still on a single season.
  const seasonNav = await loadSeasonConfig(getAdminDb(), tenantId);
  const activeSeason = resolveActiveSeason(searchParams?.season, seasonNav);
  const seasonTabs = publicSeasons(seasonNav);

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

      {seasonTabs.length >= 2 ? (
        <nav
          className="font-barlow"
          aria-label="Season"
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginTop: -18,
            marginBottom: 26,
          }}
        >
          {seasonTabs.map((s) => {
            const on = s.id === activeSeason;
            return (
              <a
                key={s.id}
                href={`/standings?season=${encodeURIComponent(s.id)}`}
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  padding: "6px 13px",
                  borderRadius: 999,
                  textDecoration: "none",
                  border: "1px solid var(--border, rgba(0,0,0,0.12))",
                  background: on ? "var(--brand-primary)" : "transparent",
                  color: on ? "#fff" : "var(--text-strong)",
                }}
              >
                {s.label}
              </a>
            );
          })}
        </nav>
      ) : null}

      {hasFinalGames ? (
        <StandingsTable
          groups={divisionGroups}
          teamMeta={teams}
          pointsScheme={scheme}
          variant="full"
          // SFBL hides the last-5 colored-dot form sparkline (Adam,
          // 2026-06). Other leagues keep it.
          showRecentForm={
            config?.abbrev !== "SFBL" && tenantId !== "sfbl"
          }
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
            {captain}s submit final box scores after games; standings
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
        </a>{" "}
        ·{" "}
        <a
          href="/print/standings"
          style={{
            color: "var(--brand-primary)",
            fontWeight: 700,
            textDecoration: "underline",
          }}
        >
          🖨 Print standings
        </a>
      </p>
    </main>
  );
}

// Season header label. Deliberately just "<year> Season": the old
// month-derived guess ("Summer 2026") invented seasons the league
// doesn't have — SFBL plays Spring and Fall, and a Spring season
// running into July rendered as "Summer" (audit 2026-07). The real
// name belongs on league config (current_season) once the
// commissioner supplies it; until then say only what we know.
function seasonLabel(year: string): string {
  return `${year} Season`;
}

async function loadStandings(
  tenantId: string,
  config: PublicLeagueConfig | null,
  requestedSeason?: string,
) {
  const db = getAdminDb();
  const { gamesSnap, teamsSnap } = await loadGamesAndTeamsSnaps(db, tenantId);
  const seasonCfg = await loadSeasonConfig(db, tenantId);
  const activeSeason = resolveActiveSeason(requestedSeason, seasonCfg);
  const seasonDocs = gamesSnap.docs.filter((d) =>
    inSeason(d.data().season, activeSeason),
  );

  const teams: Record<string, TeamMeta> = {};
  for (const d of teamsSnap.docs) {
    const data = d.data();
    // Skip placeholder teams like "TBD" (bracket scheduling) — never a
    // standings team (Nelson, 2026-07).
    if (data.placeholder === true) continue;
    teams[d.id] = {
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      color: data.color ? String(data.color) : undefined,
      logoUrl: data.logo_url ? String(data.logo_url) : null,
      division: data.division ? String(data.division) : undefined,
    };
  }

  const games: GameResult[] = seasonDocs.flatMap((d) => {
    const data = d.data();
    // M7: a final game with missing scores must not be coerced to a 0-0
    // tie. Skip games whose scores aren't both present (matches
    // app/print/standings). computeStandings still applies its status filter.
    const homeScore = Number(data.home_score);
    const awayScore = Number(data.away_score);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return [];
    return [
      {
        home_team_id: String(data.home_team_id ?? ""),
        away_team_id: String(data.away_team_id ?? ""),
        home_score: homeScore,
        away_score: awayScore,
        status: (data.status ?? "draft") as GameResult["status"],
        date: data.date ? String(data.date) : undefined,
        is_playoff: data.is_playoff === true,
      },
    ];
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
  // Parse via formatGameDate (calendar-day safe) so the subtitle doesn't
  // slip to the prior day on a UTC server for a date-only string.
  const throughDate =
    formatGameDate(lastDate, null, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) || "today";

  return {
    divisionGroups,
    teams,
    scheme: usePoints ? scheme : null,
    leagueName: config?.name ?? null,
    throughDate,
    teamCount: teamsSnap.docs.filter((d) => d.data().placeholder !== true)
      .length,
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
