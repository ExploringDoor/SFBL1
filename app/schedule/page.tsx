// DVSL-style schedule page: same heading + tab pattern as /scores, but
// shows upcoming games only. No Recap/Box Score buttons, just Preview.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { PreviewCard, type PreviewCardTeam } from "@/components/ui/PreviewCard";
import { computeWeeks, pickActiveWeek } from "@/lib/season-weeks";
import { computeStandings, type GameResult } from "@/lib/stats/shared";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { ScoresScheduleTabs, WeekRow } from "../scores/tabs-and-weeks";
import { SubscribeCalendar } from "@/components/SubscribeCalendar";

export const dynamic = "force-dynamic";

interface ScheduleGame {
  id: string;
  date: string;
  status: string;
  field: string | null;
  away_team_id: string;
  home_team_id: string;
  division: string | null;
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams?: { week?: string; div?: string };
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
  const allUpcoming = games.filter((g) => g.status === "scheduled");

  // ── Division filter ─────────────────────────────────────────────
  // Multi-division leagues (SFBL has 18+, 28+, 35+) want a quick way
  // to drill into "just my division." Pulled from the games' own
  // division field — top-level grouping, not the 35+ Am/Nat sub-
  // division split (which is a teams-only attribute today). URL is
  // `?div=18%2B` etc. — empty / missing = all divisions.
  const allDivisions = Array.from(
    new Set(
      allUpcoming
        .map((g) => g.division)
        .filter((d): d is string => !!d),
    ),
  ).sort();
  const activeDivision = searchParams?.div ?? null;
  const upcoming =
    activeDivision && activeDivision !== "all"
      ? allUpcoming.filter((g) => g.division === activeDivision)
      : allUpcoming;

  const weeks = computeWeeks(upcoming);
  const activeStart = searchParams?.week ?? pickActiveWeek(weeks);
  const activeWeek = weeks.find((w) => w.startIso === activeStart) ?? null;
  const activeGames = activeWeek
    ? upcoming.filter((g) => activeWeek.dates.includes(g.date.slice(0, 10)))
    : [];

  const byDate = new Map<string, ScheduleGame[]>();
  for (const g of activeGames) {
    const key = g.date.slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(g);
  }
  const dayGroups = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <main className="container py-10">
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display" style={{ fontSize: "clamp(40px, 6vw, 64px)" }}>
            <span style={{ color: "var(--text-strong)" }}>Season</span>{" "}
            <span style={{ color: "var(--brand-primary)" }}>Schedule</span>
          </h1>
          {config?.name && <p className="sec-eyebrow mt-1">{config.name}</p>}
        </div>
        <SubscribeCalendar />
      </header>

      <ScoresScheduleTabs active="schedule" />

      {allDivisions.length > 1 && (
        <DivisionFilter
          divisions={allDivisions}
          active={activeDivision}
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
              <div className="le-preview-grid">
                {list.map((g, idx) => (
                  <PreviewCard
                    key={g.id}
                    gameId={g.id}
                    date={g.date}
                    field={g.field}
                    away={teamCardData(g.away_team_id, teams)}
                    home={teamCardData(g.home_team_id, teams)}
                    isNext={idx === 0 && date === dayGroups[0]?.[0]}
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
      status: String(data.status ?? "draft"),
      field: data.field ? String(data.field) : null,
      away_team_id: String(data.away_team_id ?? ""),
      home_team_id: String(data.home_team_id ?? ""),
      division: data.division ? String(data.division) : null,
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

// ── Division filter chip strip ──────────────────────────────────
//
// Renders a row of chips: "All" + one per league division. Clicking
// reloads the page with `?div=<value>` so the active week + filter
// persist via the URL. Defined inline rather than imported because
// the schedule page is the only consumer today (scores will likely
// want the same UI; lift then).

function DivisionFilter({
  divisions,
  active,
}: {
  divisions: string[];
  active: string | null;
}) {
  const activeKey = active ?? "all";
  return (
    <div
      className="flex flex-wrap items-center gap-2 mt-6 mb-2"
      role="tablist"
      aria-label="Filter schedule by division"
    >
      <span
        className="font-barlow"
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--muted)",
          marginRight: 4,
        }}
      >
        Division:
      </span>
      <DivisionChip label="All" value="all" isActive={activeKey === "all"} />
      {divisions.map((d) => (
        <DivisionChip
          key={d}
          label={d}
          value={d}
          isActive={activeKey === d}
        />
      ))}
    </div>
  );
}

function DivisionChip({
  label,
  value,
  isActive,
}: {
  label: string;
  value: string;
  isActive: boolean;
}) {
  // "all" maps to no `div` param; everything else URL-encodes the
  // raw division string ("18+" → "18%2B"). Going to /schedule with
  // no query is the implicit "all".
  const href = value === "all" ? "/schedule" : `/schedule?div=${encodeURIComponent(value)}`;
  return (
    <a
      href={href}
      role="tab"
      aria-selected={isActive}
      style={{
        padding: "6px 14px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 700,
        textDecoration: "none",
        background: isActive ? "var(--brand-primary)" : "var(--card)",
        color: isActive ? "white" : "var(--text-strong)",
        border: `1px solid ${isActive ? "var(--brand-primary)" : "var(--border)"}`,
        transition: "all 0.15s ease",
      }}
    >
      {label}
    </a>
  );
}
