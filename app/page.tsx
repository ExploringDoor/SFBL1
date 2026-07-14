import Link from "next/link";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  computeStandings,
  sortByPoints,
  type GameResult,
  type StandingsRow,
} from "@/lib/stats/shared";
import { captainNoun, type PublicLeagueConfig } from "@/lib/tenants";
import { combineDateTime } from "@/lib/format-time";
import { GameCard, type GameCardTeam } from "@/components/ui/GameCard";
import { PreviewCard, type PreviewCardTeam } from "@/components/ui/PreviewCard";
import { Hero as DvslHero } from "@/components/ui/Hero";
import { HomepageBanner } from "@/components/ui/HomepageBanner";
import { HomepageLiveGames } from "@/components/ui/HomepageLiveGames";
import { HomepageNews } from "@/components/ui/HomepageNews";
import {
  StandingsTable,
  type DivisionGroup,
  type TeamMeta,
} from "@/components/ui/StandingsTable";

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
  is_playoff: boolean;
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

  const captain = captainNoun(config);

  const {
    upcoming,
    recent,
    teams,
    divisionGroups,
    scheme,
    leagueName,
    seasonStats,
  } = await loadHomeData(tenantId, config);

  const season = String(new Date().getFullYear());
  const big = config?.abbrev ?? deriveAbbrev(leagueName);

  return (
    <main>
      {/* No `pill` — the "⚾ {YEAR} Regular Season" tag sat awkwardly
          above the hero banner and Adam asked to drop it (2026-05-14).
          Leaving the prop optional in the component so we can pass it
          again on a different surface if we ever want it.

          Hero image priority: theme.banner_url (the wide / hero
          banner) when set, otherwise fall back to theme.logo_url
          (the small ticker icon). LBDC uses two distinct assets —
          /lbdc/hero.jpg as the wide banner and /lbdc/logo.png as
          the square ticker icon. SFBL has only logo_url today, so
          falls through to it for parity. */}
      <DvslHero
        title={`${big} ${season}`}
        accentWord={season}
        subtitle={leagueName}
        logoUrl={
          config?.theme?.banner_url ?? config?.theme?.logo_url ?? null
        }
      />
      {/* "PLAYERS — JOIN THE LIST" registration alert now sits
          UNDER the hero — matches LBDC's existing site layout
          (Adam 2026-05-14). Renders nothing when the tenant
          hasn't published a banner doc. */}
      <HomepageBanner leagueId={tenantId} />
      {/* Live games strip — appears below the hero whenever any
          game in the league is in progress. Subscribes via
          onSnapshot so scores update in real time as the field-side
          scorekeeper taps. Hidden when no games are live. */}
      <HomepageLiveGames
        leagueId={tenantId}
        teamLabels={teamLabelsForLive(teams)}
      />

      {/* From-the-commissioner News & Events strip. Renders nothing
          when the league has no posts (no empty state). Pinned
          posts hoist to the top. Admin posts live at
          /leagues/<id>/news. */}
      <HomepageNews leagueId={tenantId} />

      {/* Season highlights strip (Games / Runs / Teams / Top team)
          was removed per Adam — too noisy on the homepage, doesn't
          add information beyond what /standings already shows. The
          season-stats computation is still done up in loadHomeData
          because other call sites in this file reference it; just
          not rendered. */}

      <section className="sec">
        <div className="le-home-grid">
          {/* MAIN COLUMN: recent scores + upcoming schedule */}
          <div className="le-home-main">
            {/* Launch-day fallback: when there's nothing to show in the
                main column (no recent, no upcoming), avoid an empty
                column. Standings sidebar may still render zeros, but
                we explain why below. Captains hit Friday morning with
                the league freshly provisioned and games scheduled but
                not yet final — this is expected, not broken. */}
            {recent.length === 0 && upcoming.length === 0 && (
              <div className="le-home-launch">
                <p className="le-home-launch-eyebrow">
                  {currentSeasonLabel()} season
                </p>
                <h2 className="le-home-launch-title">
                  Season starts soon
                </h2>
                <p className="le-home-launch-body">
                  Schedule, scores, and standings will appear here once
                  games are scheduled and played. If you're a {captain},{" "}
                  <a href="/captain">sign in</a> to manage your roster
                  and submit scores.
                </p>
              </div>
            )}
            {recent.length > 0 && (
              <div>
                <p
                  className="font-barlow"
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: "var(--brand-primary)",
                    marginBottom: 4,
                  }}
                >
                  Latest Scores
                </p>
                <h2
                  className="font-barlow"
                  style={{
                    fontSize: "clamp(32px, 4vw, 44px)",
                    fontWeight: 900,
                    textTransform: "uppercase",
                    lineHeight: 0.95,
                    margin: 0,
                  }}
                >
                  Recent Results
                </h2>
                <div className="le-home-scores-grid">
                  {recent.map((g) => (
                    <GameCard
                      key={g.id}
                      gameId={g.id}
                      date={g.date}
                      away={teamCardData(g.away_team_id, teams, g.away_score)}
                      home={teamCardData(g.home_team_id, teams, g.home_score)}
                      isPlayoff={g.is_playoff}
                    />
                  ))}
                </div>
              </div>
            )}

            {upcoming.length > 0 && (
              <div style={{ marginTop: 36 }}>
                <SectionHead
                  eyebrow={`${currentSeasonLabel()} Season`}
                  title="Upcoming Schedule"
                  rightLink={{ href: "/schedule", label: "Full schedule →" }}
                />
                <div className="le-preview-grid">
                  {upcoming.map((g, i) => (
                    <PreviewCard
                      key={g.id}
                      gameId={g.id}
                      date={g.date}
                      field={g.field}
                      away={previewTeamData(g.away_team_id, teams)}
                      home={previewTeamData(g.home_team_id, teams)}
                      isNext={i === 0}
                      isPlayoff={g.is_playoff}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* SIDEBAR: standings — full table with logos + all columns. */}
          <aside className="le-home-aside">
            <p
              className="font-barlow"
              style={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "var(--brand-primary)",
                marginBottom: 4,
              }}
            >
              Standings
            </p>
            <h2
              className="font-barlow"
              style={{
                fontSize: "clamp(28px, 3vw, 36px)",
                fontWeight: 900,
                textTransform: "uppercase",
                lineHeight: 0.95,
                margin: 0,
              }}
            >
              {currentSeasonLabel()}
            </h2>
            <p
              style={{
                marginTop: 6,
                marginBottom: 18,
                fontSize: 13,
                color: "var(--muted)",
              }}
            >
              Through{" "}
              {new Date().toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
            {standingsHasGames(divisionGroups) ? (
              <StandingsTable
                groups={divisionGroups}
                teamMeta={teams}
                /* Always render PTS on the homepage. Falls back to the
                   standard 2-1-0 (W-T-L) scheme for tenants that don't
                   explicitly configure points. */
                pointsScheme={scheme ?? { win: 2, tie: 1, loss: 0 }}
                variant="full"
                showExtras={false}
              />
            ) : (
              <p
                style={{
                  fontSize: 13,
                  color: "var(--muted)",
                  padding: "16px 14px",
                  background: "rgba(0,0,0,0.03)",
                  borderRadius: 8,
                  lineHeight: 1.55,
                  margin: 0,
                }}
              >
                Standings will appear here after the first game is
                final.
              </p>
            )}
          </aside>
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
    // Combine separate date + time fields so the Preview/Game cards
    // render the real start time. Without this the homepage preview
    // shows "12:00 AM" for games that posted e.g. 9:05.
    const combinedDate = combineDateTime(
      data.date ? String(data.date) : null,
      data.time ? String(data.time) : null,
    );
    return {
      id: d.id,
      date: combinedDate,
      field: data.field ? String(data.field) : null,
      status: String(data.status ?? "draft"),
      home_team_id: String(data.home_team_id ?? ""),
      away_team_id: String(data.away_team_id ?? ""),
      home_score: Number(data.home_score ?? 0),
      away_score: Number(data.away_score ?? 0),
      is_playoff: data.is_playoff === true,
    };
  });

  const allGameResults: GameResult[] = allGameItems.map((g) => ({
    home_team_id: g.home_team_id,
    away_team_id: g.away_team_id,
    home_score: g.home_score,
    away_score: g.away_score,
    status: g.status as GameResult["status"],
    date: g.date,
    is_playoff: g.is_playoff,
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

  // Season-wide stats for the homepage highlights strip. Only counts
  // final/approved games — scheduled games' 0-0 placeholders would
  // pollute the totals.
  const finals = allGameItems.filter(
    (g) => g.status === "final" || g.status === "approved",
  );
  const totalRuns = finals.reduce(
    (n, g) => n + g.away_score + g.home_score,
    0,
  );
  // Best record: max(W) team, breaking ties by highest pct.
  let topTeam: { name: string; record: string } | null = null;
  if (standings.length > 0) {
    const best = [...standings].sort(
      (a, b) => b.w - a.w || b.pct - a.pct,
    )[0]!;
    if (best.gp > 0) {
      topTeam = {
        name: teams[best.team_id]?.name ?? best.team_id,
        record: formatRecord(best.w, best.l, best.t),
      };
    }
  }
  const seasonStats = {
    gamesPlayed: finals.length,
    totalRuns,
    teamCount: Object.keys(teams).length,
    topTeam,
  };

  return {
    upcoming,
    recent,
    teams,
    divisionGroups,
    scheme: usePoints ? scheme : null,
    leagueName: config?.name ?? "League",
    seasonStats,
  };
}

function Stat({
  label,
  value,
  isWide,
}: {
  label: string;
  value: string;
  isWide?: boolean;
}) {
  return (
    <div
      className={"le-home-stat" + (isWide ? " wide" : "")}
      role="group"
    >
      <div className="le-home-stat-val">{value}</div>
      <div className="le-home-stat-lbl">{label}</div>
    </div>
  );
}

function teamCardData(
  id: string,
  teams: Record<string, TeamMeta>,
  score: number,
): GameCardTeam {
  const t = teams[id] as TeamMeta & { record?: string };
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

function previewTeamData(
  id: string,
  teams: Record<string, TeamMeta>,
): PreviewCardTeam {
  const t = teams[id] as TeamMeta & { record?: string };
  return {
    team_id: id,
    name: t?.name ?? id,
    abbrev: t?.abbrev,
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
  // Saturday-style divisions render first (LBDC convention: Saturday →
  // Boomers, not alphabetical). See app/standings/page.tsx for the
  // matching key.
  return [...buckets.entries()]
    .sort(([a], [b]) => divisionSortKey(a).localeCompare(divisionSortKey(b)))
    .map(([division, rows]) => ({ division, rows }));
}

function divisionSortKey(div: string): string {
  if (/^saturday/i.test(div)) return "0_" + div;
  if (/^main/i.test(div)) return "0_" + div;
  return "1_" + div;
}

function formatRecord(w: number, l: number, t: number): string {
  // Bare record — UI components add the surrounding parens.
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function currentSeasonLabel(): string {
  return String(new Date().getFullYear());
}

// Are any games actually counted in the standings yet? Used to gate
// the homepage standings table — on launch day every row is 0-0
// which looks like a broken site rather than a fresh one. We hide
// the table and show "Standings will appear after the first game
// is final" instead until the first W/L/T lands.
function standingsHasGames(groups: DivisionGroup[]): boolean {
  for (const g of groups) {
    for (const r of g.rows) {
      if (r.w > 0 || r.l > 0 || r.t > 0) return true;
    }
  }
  return false;
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

// Reduce the rich TeamMeta map to the subset HomepageLiveGames needs
// — keeps the props surface narrow so the client component doesn't
// pull a giant blob into its bundle.
function teamLabelsForLive(
  teams: Record<string, TeamMeta>,
): Record<string, { name: string; abbrev?: string }> {
  const out: Record<string, { name: string; abbrev?: string }> = {};
  for (const id of Object.keys(teams)) {
    const t = teams[id];
    if (!t) continue;
    out[id] = { name: t.name, abbrev: t.abbrev };
  }
  return out;
}
