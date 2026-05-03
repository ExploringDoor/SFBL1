import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  computeStandings,
  computePoints,
  sortByPoints,
  type GameResult,
} from "@/lib/stats/shared";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

interface TeamPageProps {
  params: { teamId: string };
}

export default async function TeamDetailPage({ params }: TeamPageProps) {
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
      <Shell heading="Team">
        <p className="text-slate-700">Visit a tenant subdomain.</p>
      </Shell>
    );
  }

  const db = getAdminDb();
  const [teamSnap, rosterSnap, gamesSnap, teamsSnap] = await Promise.all([
    db.doc(`leagues/${tenantId}/teams/${params.teamId}`).get(),
    db
      .collection(`leagues/${tenantId}/players`)
      .where("team_id", "==", params.teamId)
      .get(),
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
  ]);

  if (!teamSnap.exists) notFound();
  const teamData = teamSnap.data() ?? {};
  const teamName = String(teamData.name ?? params.teamId);
  const division = teamData.division ? String(teamData.division) : null;

  const teamNames: Record<string, string> = {};
  for (const d of teamsSnap.docs) {
    teamNames[d.id] = String(d.data().name ?? d.id);
  }

  // Compute this team's record + points.
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
  const myRow = standings.find((r) => r.team_id === params.teamId) ?? null;

  // Recent finalized games involving this team.
  const myGames = gamesSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown> & { id: string })
    .filter(
      (g) =>
        (g.home_team_id === params.teamId || g.away_team_id === params.teamId) &&
        (g.status === "final" || g.status === "approved" || g.status === "scheduled"),
    )
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
    .slice(0, 8);

  // Roster: players where team_id == this team.
  const roster = rosterSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: String(data.name ?? d.id),
        jersey: data.jersey != null ? Number(data.jersey) : null,
        position: data.position ? String(data.position) : null,
        avg: data.stats?.avg as number | undefined,
        hr: data.stats?.hr as number | undefined,
        rbi: data.stats?.rbi as number | undefined,
      };
    })
    .sort((a, b) => (a.jersey ?? 999) - (b.jersey ?? 999) || a.name.localeCompare(b.name));

  return (
    <Shell heading={teamName}>
      <p className="mb-4 text-sm text-slate-500">
        {division && <span>{division} Division · </span>}
        {myRow ? formatRecord(myRow.w, myRow.l, myRow.t) : "0-0"}
        {myRow && usePoints && scheme && (
          <span> · {computePoints(myRow, scheme)} pts</span>
        )}
        {myRow && (
          <span>
            {" "}· run diff {myRow.rd > 0 ? `+${myRow.rd}` : myRow.rd}
          </span>
        )}
      </p>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Roster</h2>
        {roster.length === 0 ? (
          <p className="text-sm text-slate-500">No players on roster yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
            {roster.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/players/${p.id}`}
                  className="flex items-center justify-between px-4 py-2 text-sm hover:bg-slate-50"
                >
                  <div className="flex items-center gap-3">
                    {p.jersey != null && (
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 font-mono text-xs">
                        {p.jersey}
                      </span>
                    )}
                    <span className="font-medium text-slate-900">{p.name}</span>
                    {p.position && (
                      <span className="text-xs text-slate-500">{p.position}</span>
                    )}
                  </div>
                  {p.avg != null && (
                    <span className="font-mono text-xs text-slate-600">
                      {formatAvg(p.avg)} · {p.hr ?? 0} HR · {p.rbi ?? 0} RBI
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Recent games</h2>
        {myGames.length === 0 ? (
          <p className="text-sm text-slate-500">No games yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
            {myGames.map((g) => (
              <GameLine
                key={g.id}
                myTeamId={params.teamId}
                game={g}
                teamNames={teamNames}
              />
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}

function GameLine({
  myTeamId,
  game,
  teamNames,
}: {
  myTeamId: string;
  game: Record<string, unknown> & { id: string };
  teamNames: Record<string, string>;
}) {
  const isHome = game.home_team_id === myTeamId;
  const opponentId = String(isHome ? game.away_team_id : game.home_team_id);
  const opponent = teamNames[opponentId] ?? opponentId;
  const myScore = Number(isHome ? game.home_score : game.away_score);
  const oppScore = Number(isHome ? game.away_score : game.home_score);
  const status = String(game.status ?? "");
  const isFinal = status === "final" || status === "approved";
  const won = isFinal && myScore > oppScore;
  const lost = isFinal && myScore < oppScore;
  const dateStr = game.date ? new Date(String(game.date)).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

  return (
    <li className="flex items-center justify-between px-4 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={
            "inline-flex h-5 w-5 items-center justify-center rounded text-xs font-bold " +
            (won
              ? "bg-emerald-100 text-emerald-700"
              : lost
                ? "bg-red-100 text-red-700"
                : "bg-slate-100 text-slate-500")
          }
        >
          {won ? "W" : lost ? "L" : "·"}
        </span>
        <span className="text-slate-600">{isHome ? "vs" : "@"}</span>
        <span className="font-medium text-slate-900">{opponent}</span>
      </div>
      <div className="text-right">
        {isFinal ? (
          <span className="font-mono text-xs">
            {myScore}–{oppScore}
          </span>
        ) : (
          <span className="text-xs text-slate-500">{dateStr || status}</span>
        )}
      </div>
    </li>
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
      <header className="mb-2">
        <Link href="/teams" className="text-xs text-slate-500 hover:underline">
          ← All teams
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
      </header>
      {children}
    </main>
  );
}

function formatRecord(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}
function formatAvg(n: number): string {
  if (n === 1) return "1.000";
  return n.toFixed(3).replace(/^0/, "");
}
