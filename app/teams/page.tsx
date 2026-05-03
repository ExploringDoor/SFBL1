import Link from "next/link";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  computePoints,
  computeStandings,
  sortByPoints,
  type GameResult,
} from "@/lib/stats/shared";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

interface TeamCard {
  id: string;
  name: string;
  division: string | null;
  record: string;
  points: number | null;
}

export default async function TeamsPage() {
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
      <Shell heading="Teams">
        <p className="text-slate-700">Visit a tenant subdomain.</p>
      </Shell>
    );
  }

  const db = getAdminDb();
  const [teamsSnap, gamesSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/teams`).get(),
    db.collection(`leagues/${tenantId}/games`).get(),
  ]);

  const games: GameResult[] = gamesSnap.docs.map((d) => {
    const data = d.data();
    return {
      home_team_id: String(data.home_team_id ?? ""),
      away_team_id: String(data.away_team_id ?? ""),
      home_score: Number(data.home_score ?? 0),
      away_score: Number(data.away_score ?? 0),
      status: (data.status ?? "draft") as GameResult["status"],
    };
  });
  let standings = computeStandings(games);
  const scheme = config?.standings?.points_per;
  const usePoints = config?.standings?.scoring === "points" && !!scheme;
  if (usePoints && scheme) {
    standings = sortByPoints(standings, scheme, config?.standings?.tiebreaker ?? "rd");
  }
  const recordByTeam = new Map(standings.map((r) => [r.team_id, r]));

  const teams: TeamCard[] = teamsSnap.docs.map((d) => {
    const data = d.data();
    const row = recordByTeam.get(d.id);
    return {
      id: d.id,
      name: String(data.name ?? d.id),
      division: data.division ? String(data.division) : null,
      record: row ? formatRecord(row.w, row.l, row.t) : "0-0",
      points: row && usePoints && scheme ? computePoints(row, scheme) : null,
    };
  });

  // Group by division.
  const byDivision = new Map<string, TeamCard[]>();
  for (const t of teams) {
    const key = t.division ?? "League";
    if (!byDivision.has(key)) byDivision.set(key, []);
    byDivision.get(key)!.push(t);
  }
  // Sort within each division to match standings order.
  for (const [, list] of byDivision) {
    list.sort((a, b) => {
      const ai = standings.findIndex((r) => r.team_id === a.id);
      const bi = standings.findIndex((r) => r.team_id === b.id);
      if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }
  const divisions = [...byDivision.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <Shell heading={config?.name ? `${config.name} — Teams` : "Teams"}>
      <div className="space-y-8">
        {divisions.map(([division, list]) => (
          <section key={division}>
            <h2 className="mb-3 text-lg font-semibold text-slate-800">{division}</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {list.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/teams/${t.id}`}
                    className="block rounded-md border border-slate-200 bg-white p-4 hover:border-slate-400 hover:shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{t.name}</span>
                      {t.points !== null && (
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono">
                          {t.points} PTS
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{t.record}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Shell>
  );
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

function formatRecord(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}
