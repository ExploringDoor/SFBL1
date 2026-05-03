import Link from "next/link";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

interface FinalGame {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  date: string | null;
  field: string | null;
}

export default async function ScoresPage() {
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
      <Shell heading="Scores">
        <p className="text-slate-700">Scores are tenant-scoped.</p>
      </Shell>
    );
  }

  const { games, teamNames } = await loadScores(tenantId);

  return (
    <Shell heading={config?.name ? `${config.name} — Scores` : "Scores"}>
      {games.length === 0 ? (
        <p className="text-slate-600">No final scores yet.</p>
      ) : (
        <ScoresList games={games} teamNames={teamNames} />
      )}
    </Shell>
  );
}

async function loadScores(tenantId: string) {
  const db = getAdminDb();
  const [gamesSnap, teamsSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
  ]);
  const games: FinalGame[] = gamesSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        home_team_id: String(data.home_team_id ?? ""),
        away_team_id: String(data.away_team_id ?? ""),
        home_score: Number(data.home_score ?? 0),
        away_score: Number(data.away_score ?? 0),
        status: String(data.status ?? ""),
        date: data.date ? String(data.date) : null,
        field: data.field ? String(data.field) : null,
      };
    })
    .filter((g) => g.status === "final" || g.status === "approved")
    .sort((a, b) => {
      // Newest first.
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    });

  const teamNames: Record<string, string> = {};
  for (const d of teamsSnap.docs) {
    teamNames[d.id] = String(d.data().name ?? d.id);
  }
  return { games, teamNames };
}

function Shell({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
      </header>
      {children}
    </main>
  );
}

function ScoresList({
  games,
  teamNames,
}: {
  games: FinalGame[];
  teamNames: Record<string, string>;
}) {
  // Group by date so the eye can scan results week-by-week.
  const byDate = new Map<string, FinalGame[]>();
  for (const g of games) {
    const key = g.date ? g.date.slice(0, 10) : "Undated";
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(g);
  }
  return (
    <div className="space-y-6">
      {[...byDate.entries()].map(([date, group]) => (
        <section key={date}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {formatDateHeading(date)}
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {group.map((g) => (
              <ScoreCard key={g.id} g={g} teamNames={teamNames} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ScoreCard({
  g,
  teamNames,
}: {
  g: FinalGame;
  teamNames: Record<string, string>;
}) {
  const home = teamNames[g.home_team_id] ?? g.home_team_id;
  const away = teamNames[g.away_team_id] ?? g.away_team_id;
  const isHomeWin = g.home_score > g.away_score;
  const isAwayWin = g.away_score > g.home_score;
  const isTie = g.home_score === g.away_score;

  return (
    <li>
      <Link
        href={`/games/${g.id}`}
        className="block rounded-md border border-slate-200 bg-white p-3 text-sm hover:border-slate-400 hover:shadow-sm"
      >
        <Row name={away} score={g.away_score} winner={isAwayWin} tie={isTie} />
        <Row name={home} score={g.home_score} winner={isHomeWin} tie={isTie} />
        {g.field && <p className="mt-1 text-xs text-slate-500">{g.field}</p>}
      </Link>
    </li>
  );
}

function Row({
  name,
  score,
  winner,
  tie,
}: {
  name: string;
  score: number;
  winner: boolean;
  tie: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className={
          tie
            ? "text-slate-700"
            : winner
              ? "font-semibold text-slate-900"
              : "text-slate-500"
        }
      >
        {name}
      </span>
      <span
        className={
          "tabular-nums " +
          (tie ? "text-slate-700" : winner ? "font-semibold text-slate-900" : "text-slate-500")
        }
      >
        {score}
      </span>
    </div>
  );
}

function formatDateHeading(yyyyMmDd: string): string {
  if (yyyyMmDd === "Undated") return yyyyMmDd;
  const d = new Date(yyyyMmDd + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
