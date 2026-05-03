import Link from "next/link";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

interface GameRow {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  status: string;
  date: string | null;
  field: string | null;
}

export default async function SchedulePage() {
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
      <Shell heading="Schedule">
        <p className="text-slate-700">
          Schedules are tenant-scoped. Visit a tenant subdomain.
        </p>
      </Shell>
    );
  }

  const { games, teamNames } = await loadSchedule(tenantId);
  const upcoming = games.filter(
    (g) => (g.status === "scheduled" || g.status === "draft") && g.date,
  );
  const recent = games.filter((g) => g.status === "final" || g.status === "approved");

  return (
    <Shell heading={config?.name ? `${config.name} — Schedule` : "Schedule"}>
      <section className="space-y-8">
        <div>
          <h2 className="mb-3 text-lg font-semibold text-slate-800">Upcoming</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing scheduled.</p>
          ) : (
            <GameList games={upcoming} teamNames={teamNames} mode="upcoming" />
          )}
        </div>
        <div>
          <h2 className="mb-3 text-lg font-semibold text-slate-800">Recent results</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-500">No results yet.</p>
          ) : (
            <GameList games={recent} teamNames={teamNames} mode="results" />
          )}
        </div>
      </section>
    </Shell>
  );
}

async function loadSchedule(tenantId: string) {
  const db = getAdminDb();
  const [gamesSnap, teamsSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
  ]);
  const games: GameRow[] = gamesSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        home_team_id: String(data.home_team_id ?? ""),
        away_team_id: String(data.away_team_id ?? ""),
        home_score: Number(data.home_score ?? 0),
        away_score: Number(data.away_score ?? 0),
        status: String(data.status ?? "draft"),
        date: data.date ? String(data.date) : null,
        field: data.field ? String(data.field) : null,
      };
    })
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });
  const teamNames: Record<string, string> = {};
  for (const d of teamsSnap.docs) {
    teamNames[d.id] = String(d.data().name ?? d.id);
  }
  return { games, teamNames };
}

function Shell({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
      </header>
      {children}
    </main>
  );
}

function GameList({
  games,
  teamNames,
  mode,
}: {
  games: GameRow[];
  teamNames: Record<string, string>;
  mode: "upcoming" | "results";
}) {
  // Group by date (YYYY-MM-DD) for visual chunking.
  const byDate = new Map<string, GameRow[]>();
  for (const g of games) {
    const key = g.date ? g.date.slice(0, 10) : "TBD";
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(g);
  }
  return (
    <div className="space-y-4">
      {[...byDate.entries()].map(([date, group]) => (
        <div key={date}>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {formatDateHeading(date)}
          </h3>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
            {group.map((g) => (
              <GameRow key={g.id} g={g} teamNames={teamNames} mode={mode} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function GameRow({
  g,
  teamNames,
  mode,
}: {
  g: GameRow;
  teamNames: Record<string, string>;
  mode: "upcoming" | "results";
}) {
  const home = teamNames[g.home_team_id] ?? g.home_team_id;
  const away = teamNames[g.away_team_id] ?? g.away_team_id;
  const time = g.date ? formatTime(g.date) : "TBD";
  const homeWon = g.home_score > g.away_score;
  const awayWon = g.away_score > g.home_score;
  const inner = (
    <>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className={awayWon ? "font-semibold text-slate-900" : "text-slate-700"}>
            {away}
          </span>
          <span className="text-slate-400">@</span>
          <span className={homeWon ? "font-semibold text-slate-900" : "text-slate-700"}>
            {home}
          </span>
        </div>
        {g.field && <span className="text-xs text-slate-500">{g.field}</span>}
      </div>
      <div className="text-right text-xs">
        {mode === "results" ? (
          <span className="font-mono text-slate-900">
            {g.away_score}–{g.home_score}
          </span>
        ) : (
          <span className="text-slate-600">{time}</span>
        )}
      </div>
    </>
  );
  return (
    <li>
      {mode === "results" ? (
        <Link
          href={`/games/${g.id}`}
          className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-slate-50"
        >
          {inner}
        </Link>
      ) : (
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          {inner}
        </div>
      )}
    </li>
  );
}

function formatDateHeading(yyyyMmDd: string): string {
  if (yyyyMmDd === "TBD") return "TBD";
  const d = new Date(yyyyMmDd + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
