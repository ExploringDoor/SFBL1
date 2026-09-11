// DVSL-style standings page: two-tone heading, year tabs (single year
// for SFBL until historical data lands), points rubric (when league
// uses points scoring), column legend, then per-division StandingsTable
// in full mode.

import { headers } from "next/headers";
import { DemoDataBanner } from "@/components/ui/DemoDataBanner";
import Link from "next/link";
import {
  getCachedGamesSnap,
  getCachedTeamsSnap,
} from "@/lib/league-cache";
import { teamLogoSrc } from "@/lib/team-logo";
import {
  computeStandings,
  sortByPoints,
  type GameResult,
  type StandingsRow,
  computeStandingsWithExtraGameRule,
  seedStandingsWithAllTeams,
  scoreOrNull,
} from "@/lib/stats/shared";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { scoreLabels } from "@/lib/sport-labels";
import {
  StandingsTable,
  type DivisionGroup,
  type TeamMeta,
} from "@/components/ui/StandingsTable";
import {
  buildAgeSections,
  recordsToStandings,
  useStoredRecords,
} from "@/lib/age-standings";

export const dynamic = "force-dynamic";

// Per-page title -> "Standings · <abbrev>" via the layout template (was just
// the bare league name on every page).
export const metadata = { title: "Standings" };


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
    forgaveALoss,
    ageSections,
    hasAge,
    teams,
    scheme,
    throughDate,
    hasFinalGames,
    storedRecordsMode,
  } = await loadStandings(tenantId, config);

  // The league's configured season, not the calendar year. Cleared last
  // season and it still read "Summer 2026" in August of 2026, while the rest
  // of the site already said 2027.
  const year = String(config?.season_year ?? new Date().getFullYear());

  return (
    <main className="container py-10">
    <DemoDataBanner
      show={config?.flags?.demo_data === true}
      note={config?.demo_note}
    />
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
          {config?.season_label ?? seasonLabel(year)}
        </h1>
        <p
          style={{
            marginTop: 8,
            fontSize: 14,
            color: "var(--muted)",
            fontFamily: "var(--font-inter), sans-serif",
          }}
        >
          {/* No team count. Mike asked for it out (2026-09-08): the number is
              already obvious from the table underneath, and a raw count reads
              like a target the league is short of rather than a fact. The
              pre-season line matches the homepage word for word so the two
              pages plainly agree. */}
          {hasFinalGames
            ? `Through ${throughDate}`
            : "Everyone starts at 0-0. Records update after the first game is final."}
        </p>

        {/* Island's Summer League runs through USSSA, so its standings live on
            their own page rather than in this table. The nav carries it under
            Information, but that is two clicks deep and easy to miss — someone
            already looking at standings is exactly who wants it. */}
        {tenantId === "island" && (
          <Link
            href="/summer-league"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              marginTop: 14,
              padding: "9px 16px",
              borderRadius: 999,
              fontSize: 14,
              fontWeight: 700,
              textDecoration: "none",
              color: "var(--brand-accent, #35afea)",
              border:
                "1px solid color-mix(in srgb, var(--brand-accent, #35afea) 45%, transparent)",
              background:
                "color-mix(in srgb, var(--brand-accent, #35afea) 12%, transparent)",
            }}
          >
            Summer League standings (USSSA)
            <span aria-hidden>→</span>
          </Link>
        )}
      </header>

      {divisionGroups.every((g) => g.rows.length === 0) ? (
        // Only when there is genuinely nothing to show, i.e. no teams at all.
        //
        // This used to trigger on "no finals yet", on the reasoning that a
        // table of 0-0 rows looks broken. Adam overruled it on 2026-09-08:
        // the homepage shows the teams at 0-0, so /standings hiding them made
        // the two pages contradict each other, which looks far more broken
        // than a column of zeros. They are seeded from the same helper now.
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
            <nav aria-label="Jump to age group" className="le-agejump">
              <span className="le-agejump-label">Jump to</span>
              {ageSections.map((s) => (
                <a
                  key={s.ageGroup}
                  href={`#age-${s.ageGroup}`}
                  className="le-agejump-btn"
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
              style={{
              marginBottom: 36,
              // The nav is sticky, so a bare 16 put the age heading UNDER it after
              // an age-jump — on a phone you tapped "12U" and landed on rows with
              // no idea which group you were in.
              scrollMarginTop:
                "calc(var(--header-height, 62px) + 16px + env(safe-area-inset-top, 0px))",
            }}
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
                showExtras={!storedRecordsMode}
                showRecentForm={false}
                scoreLabels={scoreLabels(config?.sport)}
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
          showExtras={!storedRecordsMode}
          showRecentForm={config?.abbrev !== "SFBL" && tenantId !== "sfbl"}
          scoreLabels={scoreLabels(config?.sport)}
        />
      )}

      {forgaveALoss && (
        <p
          style={{
            margin: "14px 0 0",
            fontSize: 13,
            lineHeight: 1.6,
            color: "var(--muted)",
          }}
        >
          Where a division could not be split evenly, one team was scheduled an
          extra game. That team has one loss dropped from its record, so every
          team is judged over the same number of games. A win in the extra game
          still counts.
        </p>
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
//
// A month heuristic cannot be right for every league. Island opens Fall
// registration in August and plays from September, so in August this returned
// "Summer 2026" over a page advertising the Fall season. Tenants that need to
// say otherwise set config.season_label, which wins.
function seasonLabel(year: string): string {
  const m = new Date().getMonth();
  if (m >= 2 && m <= 4) return `Spring ${year}`;
  if (m >= 5 && m <= 7) return `Summer ${year}`;
  if (m >= 8 && m <= 10) return `Fall ${year}`;
  return `Winter ${year}`;
}

async function loadStandings(tenantId: string, config: PublicLeagueConfig | null) {
  const [gamesSnap, teamsSnap] = await Promise.all([
    getCachedGamesSnap(tenantId),
    getCachedTeamsSnap(tenantId),
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
    // Deactivated teams drop out of the table. Their games are untouched and
    // still render on Scores and Schedule — the admin's own confirm text draws
    // that line: gone from roster lists, history intact.
    if (data.active === false) continue;
    teams[d.id] = {
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      color: data.color ? String(data.color) : undefined,
      // Reads zero base64 today only because the teams holding logos have no
      // games and so never reach a standings row. Fall play starts 2026-09-12
      // and that accident expires. Route the bytes now.
      logoUrl: teamLogoSrc(tenantId, d.id, data.logo_url),
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
      home_score: scoreOrNull(data.home_score),
      away_score: scoreOrNull(data.away_score),
      status: (data.status ?? "draft") as GameResult["status"],
      date: data.date ? String(data.date) : undefined,
    };
  });

  // Stats-off leagues (COYBL) display the EXACT stored league records —
  // the source site flags which games count, so recomputing from the
  // seeded games (which include cross-division play) would be wrong.
  const storedRecordsMode = useStoredRecords(config, records);
  let standings: StandingsRow[] = storedRecordsMode
    ? recordsToStandings(records)
    : computeStandingsWithExtraGameRule(games, {
        enabled: config?.standings?.drop_extra_game_loss,
        divisionOf: (id) => teams[id]?.division ?? "",
        tiebreaker: config?.standings?.tiebreaker,
      });
  // Every team gets a row before a ball is thrown, exactly as the homepage
  // does. These two must agree: a parent who sees 0-0 on the home page and an
  // empty /standings assumes the site is broken, and they would be half right.
  standings = seedStandingsWithAllTeams(standings, Object.keys(teams));
  const scheme = config?.standings?.points_per ?? null;
  const usePoints = config?.standings?.scoring === "points" && !!scheme;
  if (usePoints && scheme) {
    standings = sortByPoints(
      standings,
      scheme,
      config?.standings?.tiebreaker ?? "rd",
      games,
    );
  }

  // Divisions a tenant never shows a standings table for (e.g. Windmill's 8U
  // Machine, which keeps no score — blind-draw tournament seeding). Config-driven
  // so it's not a hardcoded tenant check.
  const excludeDivisions = new Set(
    (config?.standings?.exclude_divisions ?? []).map(String),
  );
  if (excludeDivisions.size) {
    standings = standings.filter(
      (r) => !excludeDivisions.has(teams[r.team_id]?.division ?? ""),
    );
  }

  // Did the rule actually forgive anything? Only say so when it did. A note
  // explaining an adjustment that has not happened is noise on every other
  // page view, and the note is the difference between a coach understanding
  // their 3-0 and ringing the league about it.
  const forgaveALoss =
    !!config?.standings?.drop_extra_game_loss &&
    (() => {
      const plain = computeStandings(games);
      const byId = new Map(plain.map((r) => [r.team_id, r]));
      return standings.some((r) => (byId.get(r.team_id)?.l ?? r.l) > r.l);
    })();

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
    forgaveALoss,
    ageSections,
    hasAge,
    teams,
    scheme: usePoints ? scheme : null,
    leagueName: config?.name ?? null,
    throughDate,
    teamCount: teamsSnap.size,
    // With stored records, standings come from the teams (not games), so
    // "has standings" means teams exist — not that games are final.
    hasFinalGames: storedRecordsMode
      ? standings.length > 0
      : finalDates.length > 0,
    storedRecordsMode,
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
