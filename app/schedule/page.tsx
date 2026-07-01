// DVSL-style schedule page: same heading + tab pattern as /scores, but
// shows upcoming games only. No Recap/Box Score buttons, just Preview.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { PreviewCard, type PreviewCardTeam } from "@/components/ui/PreviewCard";
import { GameCard, type GameCardTeam } from "@/components/ui/GameCard";
import { computeWeeks, pickActiveWeek } from "@/lib/season-weeks";
import { computeStandings, type GameResult } from "@/lib/stats/shared";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { ScoresScheduleTabs, WeekRow } from "../scores/tabs-and-weeks";
import { SubscribeCalendar } from "@/components/SubscribeCalendar";
import { DivisionFilter } from "@/components/ui/DivisionFilter";
import { AgeFilter } from "@/components/ui/AgeFilter";
import { combineDateTime } from "@/lib/format-time";

export const dynamic = "force-dynamic";

interface ScheduleGame {
  id: string;
  date: string;
  // Separate `time` field when Firestore stores date+time apart
  // (ScheduleEditor's two-column shape). Empty when the time is
  // embedded in `date` as an ISO datetime, or when the game has no
  // posted time yet.
  time: string;
  status: string;
  field: string | null;
  away_team_id: string;
  home_team_id: string;
  division: string | null;
  away_score: number;
  home_score: number;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams?: { week?: string; div?: string; age?: string };
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

  const { games, teams } = await loadSchedule(tenantId);
  // Show every game in the season — scheduled, final, postponed,
  // cancelled — so the schedule page is a real season-long calendar
  // instead of just "the 1 game still on the books." Cards render
  // status badges (FINAL / POSTPONED / etc.) so users always know
  // which games actually happened. Excluded: status === "draft"
  // (admin work-in-progress not yet published).
  const allUpcoming = games.filter((g) => g.status !== "draft");

  // ── Age / Division filter ───────────────────────────────────────
  // Age-grouped tenants (COYBL, 7U-14U) filter by age group — the axis
  // a parent cares about; division is a sub-tier within an age. Flat
  // multi-division leagues (SFBL 18+/28+/35+) keep the division filter.
  // Same ?param UX; age comes off the teams map (games store division).
  const hasAge = Object.values(teams).some((t) => t.ageGroup);
  const ageOfGame = (g: ScheduleGame): string | null =>
    teams[g.home_team_id]?.ageGroup ?? teams[g.away_team_id]?.ageGroup ?? null;
  const allAges = Array.from(
    new Set(
      Object.values(teams)
        .map((t) => t.ageGroup)
        .filter((a): a is string => !!a),
    ),
  ).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
  const allDivisions = Array.from(
    new Set(
      allUpcoming
        .map((g) => g.division)
        .filter((d): d is string => !!d),
    ),
  ).sort();
  const activeAge = hasAge ? searchParams?.age ?? null : null;
  const activeDivision = !hasAge ? searchParams?.div ?? null : null;
  const upcoming = hasAge
    ? activeAge && activeAge !== "all"
      ? allUpcoming.filter((g) => ageOfGame(g) === activeAge)
      : allUpcoming
    : activeDivision && activeDivision !== "all"
      ? allUpcoming.filter((g) => g.division === activeDivision)
      : allUpcoming;

  const weeks = computeWeeks(upcoming);
  const activeStart = searchParams?.week ?? pickActiveWeek(weeks);
  const activeWeek = weeks.find((w) => w.startIso === activeStart) ?? null;
  const activeGames = activeWeek
    ? upcoming.filter((g) => activeWeek.dates.includes(g.date.slice(0, 10)))
    : [];

  // Split games into upcoming vs already-played so the page reads
  // top-down "what's next" → "what happened" instead of a single
  // chronological run. Adam's call: he wants to land on /schedule
  // and see future Sundays first, with past results below as
  // reference. Within each section we group by day.
  function groupByDate(
    list: ScheduleGame[],
    asc: boolean,
  ): [string, ScheduleGame[]][] {
    const byDate = new Map<string, ScheduleGame[]>();
    for (const g of list) {
      const key = g.date.slice(0, 10);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(g);
    }
    // Within each day, sort by start time ascending so a 9:30 AM
    // game appears before a 12:00 PM game. The sort key falls back
    // to `date` (covers the ISO-datetime storage shape) and finally
    // doc id so the order stays stable when nothing has a time.
    for (const [, dayList] of byDate) {
      dayList.sort((a, b) => {
        const ka = a.time || a.date.slice(11) || a.id;
        const kb = b.time || b.date.slice(11) || b.id;
        return ka.localeCompare(kb);
      });
    }
    return [...byDate.entries()].sort(([a], [b]) =>
      asc ? a.localeCompare(b) : b.localeCompare(a),
    );
  }
  const upcomingGames = activeGames.filter(
    (g) => g.status !== "final" && g.status !== "approved",
  );
  const pastGames = activeGames.filter(
    (g) => g.status === "final" || g.status === "approved",
  );
  // Upcoming asc (earliest day first); past desc (most recent
  // result first, so it sits right under the upcoming list).
  const upcomingDayGroups = groupByDate(upcomingGames, true);
  const pastDayGroups = groupByDate(pastGames, false);
  const dayGroups = [...upcomingDayGroups, ...pastDayGroups];

  return (
    <main className="container py-10">
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        {!config?.flags?.hide_page_titles ? (
          <div>
            <h1 className="font-display" style={{ fontSize: "clamp(40px, 6vw, 64px)" }}>
              <span style={{ color: "var(--text-strong)" }}>Season</span>{" "}
              <span style={{ color: "var(--brand-primary)" }}>Schedule</span>
            </h1>
            {config?.name && <p className="sec-eyebrow mt-1">{config.name}</p>}
          </div>
        ) : (
          <div />
        )}
        <div className="flex flex-col items-end gap-2">
          <SubscribeCalendar />
          {/* Flat CSV of the whole schedule — opens straight in Excel /
              Sheets. For the umpire assigner etc. (Adam, 2026-06). */}
          <a
            href="/api/schedule.csv"
            className="font-barlow text-xs font-bold uppercase tracking-wider hover:underline"
            style={{ color: "var(--brand-primary)" }}
          >
            ⬇ Download for Excel (CSV)
          </a>
        </div>
      </header>

      <ScoresScheduleTabs active="schedule" />

      {hasAge
        ? allAges.length > 1 && (
            <AgeFilter ages={allAges} active={activeAge} basePath="/schedule" />
          )
        : allDivisions.length > 1 && (
            <DivisionFilter
              divisions={allDivisions}
              active={activeDivision}
              basePath="/schedule"
            />
          )}

      {weeks.length === 0 ? (
        // No scheduled games anywhere. Likely launch day before the
        // schedule has been imported, or post-season. Show a clear
        // placeholder rather than an empty week selector + blank
        // body.
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
            Schedule coming soon.
          </strong>
          <p style={{ margin: "8px 0 0", fontSize: 14 }}>
            Games will appear here once the league posts the season
            schedule.
          </p>
        </div>
      ) : (
        <>
          <WeekRow
            weeks={weeks.map((w) => ({
              ...w,
              active: w.startIso === activeStart,
            }))}
            basePath="/schedule"
          />

          {dayGroups.length === 0 ? (
            <p className="mt-6" style={{ color: "var(--muted)" }}>
              No games this week — pick a different week above.
            </p>
          ) : (
        <div className="space-y-8 mt-6">
          {/* Upcoming first (chronological), then a divider, then
              played games (most recent first). Each section omits
              its header when the other side is empty so the page
              isn't littered with "PLAYED (0)" labels off-season. */}
          {upcomingDayGroups.length > 0 && pastDayGroups.length > 0 && (
            <div
              className="font-barlow"
              style={{
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--muted)",
                paddingBottom: 4,
                borderBottom: "1px solid rgba(0,0,0,0.08)",
              }}
            >
              Upcoming
            </div>
          )}
          {upcomingDayGroups.map(([date, list]) => (
            <DaySection
              key={`u-${date}`}
              date={date}
              list={list}
              teams={teams}
              isFirstUpcomingDay={date === upcomingDayGroups[0]?.[0]}
            />
          ))}
          {upcomingDayGroups.length > 0 && pastDayGroups.length > 0 && (
            <div
              className="font-barlow"
              style={{
                marginTop: 16,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--muted)",
                paddingBottom: 4,
                borderBottom: "1px solid rgba(0,0,0,0.08)",
              }}
            >
              Played
            </div>
          )}
          {pastDayGroups.map(([date, list]) => (
            <DaySection
              key={`p-${date}`}
              date={date}
              list={list}
              teams={teams}
              isFirstUpcomingDay={false}
            />
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
  ageGroup?: string;
}

async function loadSchedule(tenantId: string): Promise<{
  games: ScheduleGame[];
  teams: Record<string, TeamMeta>;
}> {
  const db = getAdminDb();
  const [gamesSnap, teamsSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
  ]);

  const games: ScheduleGame[] = gamesSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      date: data.date ? String(data.date) : "",
      time: data.time ? String(data.time) : "",
      status: String(data.status ?? "draft"),
      field: data.field ? String(data.field) : null,
      away_team_id: String(data.away_team_id ?? ""),
      home_team_id: String(data.home_team_id ?? ""),
      division: data.division ? String(data.division) : null,
      away_score: Number(data.away_score ?? 0),
      home_score: Number(data.home_score ?? 0),
    };
  });

  // Records for the team-row subtitles on cards.
  const standingsGames: GameResult[] = gamesSnap.docs.map((d) => {
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

function teamCardData(
  id: string,
  teams: Record<string, TeamMeta>,
): PreviewCardTeam {
  const t = teams[id];
  return {
    team_id: id,
    name: t?.name ?? id,
    abbrev: t?.abbrev,
    logoUrl: t?.logoUrl,
    record: t?.record,
  };
}

function teamGameCardData(
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

// (DivisionFilter moved to components/ui/DivisionFilter.tsx — used
// by both /scores and /schedule. Linked from the imports above.)

// Single day block — header (Sunday, May 18) + game grid. Pulled
// out so the upcoming-vs-past split above doesn't have to duplicate
// the rendering. `isFirstUpcomingDay` is true on exactly one day —
// the very first upcoming day — so its first scheduled card can
// render with the "NEXT" pill.
function DaySection({
  date,
  list,
  teams,
  isFirstUpcomingDay,
}: {
  date: string;
  list: ScheduleGame[];
  teams: Record<string, TeamMeta>;
  isFirstUpcomingDay: boolean;
}) {
  return (
    <section>
      <header className="mb-3 flex items-baseline gap-3">
        <h3 className="font-display" style={{ fontSize: 24 }}>
          {formatDayHeading(date)}
        </h3>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {list.length} game{list.length === 1 ? "" : "s"}
        </span>
      </header>
      <div className="le-preview-grid">
        {list.map((g, idx) => {
          // Past finals render as a GameCard (with score); scheduled
          // / postponed / cancelled get the PreviewCard with a
          // status badge.
          if (g.status === "final" || g.status === "approved") {
            return (
              <GameCard
                key={g.id}
                gameId={g.id}
                date={g.date}
                away={teamGameCardData(g.away_team_id, teams, g.away_score)}
                home={teamGameCardData(g.home_team_id, teams, g.home_score)}
                ageGroup={
                  teams[g.home_team_id]?.ageGroup ??
                  teams[g.away_team_id]?.ageGroup
                }
              />
            );
          }
          // PreviewCard's time label parses the date string. If the
          // doc stored date + time separately, stitch them into a
          // single ISO so "TBD" doesn't show up for games that
          // actually have a posted time.
          const dateLabel = combineDateTime(g.date, g.time);
          return (
            <PreviewCard
              key={g.id}
              gameId={g.id}
              date={dateLabel}
              field={g.field}
              away={teamCardData(g.away_team_id, teams)}
              home={teamCardData(g.home_team_id, teams)}
              isNext={isFirstUpcomingDay && idx === 0 && g.status === "scheduled"}
              status={g.status}
              ageGroup={
                teams[g.home_team_id]?.ageGroup ??
                teams[g.away_team_id]?.ageGroup
              }
            />
          );
        })}
      </div>
    </section>
  );
}
