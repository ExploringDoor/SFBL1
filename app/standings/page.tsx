import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  computePoints,
  computeStandings,
  sortByPoints,
  type GameResult,
  type PointsScheme,
  type StandingsRow,
} from "@/lib/stats/shared";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

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
      <Shell heading="Standings">
        <p className="text-slate-700">
          Standings are tenant-scoped. Visit a tenant subdomain (e.g.{" "}
          <code className="rounded bg-slate-100 px-1">sfbl.localhost:3000</code>).
        </p>
      </Shell>
    );
  }

  const { rows, teamMeta } = await loadStandings(tenantId);

  // Apply points-based sorting if the league configures it.
  const scheme = config?.standings?.points_per;
  const usePoints = config?.standings?.scoring === "points" && !!scheme;
  const finalRows = usePoints && scheme ? sortByPoints(rows, scheme) : rows;

  // Group by division if at least one team has one.
  const grouped = groupByDivision(finalRows, teamMeta);

  return (
    <Shell heading={config?.name ? `${config.name} — Standings` : "Standings"}>
      {finalRows.length === 0 ? (
        <p className="text-slate-600">No final games yet.</p>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ division, rows: groupRows }) => (
            <section key={division ?? "league"}>
              {division && (
                <h2 className="mb-2 text-lg font-semibold text-slate-800">
                  {division}
                </h2>
              )}
              <StandingsTable
                rows={groupRows}
                teamMeta={teamMeta}
                pointsScheme={usePoints ? scheme : null}
              />
            </section>
          ))}
        </div>
      )}
    </Shell>
  );
}

interface TeamMeta {
  name: string;
  division?: string;
}

async function loadStandings(tenantId: string): Promise<{
  rows: StandingsRow[];
  teamMeta: Record<string, TeamMeta>;
}> {
  const db = getAdminDb();
  const [gamesSnap, teamsSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
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

  const teamMeta: Record<string, TeamMeta> = {};
  for (const d of teamsSnap.docs) {
    const data = d.data();
    teamMeta[d.id] = {
      name: String(data.name ?? d.id),
      division: data.division ? String(data.division) : undefined,
    };
  }

  return { rows: computeStandings(games), teamMeta };
}

function groupByDivision(
  rows: StandingsRow[],
  teamMeta: Record<string, TeamMeta>,
): Array<{ division: string | null; rows: StandingsRow[] }> {
  const anyDivision = rows.some((r) => teamMeta[r.team_id]?.division);
  if (!anyDivision) return [{ division: null, rows }];

  const buckets = new Map<string, StandingsRow[]>();
  for (const r of rows) {
    const div = teamMeta[r.team_id]?.division ?? "Other";
    if (!buckets.has(div)) buckets.set(div, []);
    buckets.get(div)!.push(r);
  }

  // Stable order: alphabetical by division name.
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([division, rows]) => ({ division, rows }));
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
      <section>{children}</section>
    </main>
  );
}

function StandingsTable({
  rows,
  teamMeta,
  pointsScheme,
}: {
  rows: StandingsRow[];
  teamMeta: Record<string, TeamMeta>;
  pointsScheme: PointsScheme | null;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <Th className="text-left">Team</Th>
            {pointsScheme && <Th>PTS</Th>}
            <Th>W</Th>
            <Th>L</Th>
            <Th>T</Th>
            <Th>PCT</Th>
            <Th>GB</Th>
            <Th>RS</Th>
            <Th>RA</Th>
            <Th>RD</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((r) => (
            <tr key={r.team_id} className="text-sm">
              <Td className="text-left font-medium">
                {teamMeta[r.team_id]?.name ?? r.team_id}
              </Td>
              {pointsScheme && (
                <Td className="font-semibold">{computePoints(r, pointsScheme)}</Td>
              )}
              <Td>{r.w}</Td>
              <Td>{r.l}</Td>
              <Td>{r.t}</Td>
              <Td>{formatPct(r.pct)}</Td>
              <Td>{r.gb === 0 ? "—" : r.gb.toFixed(1)}</Td>
              <Td>{r.rs}</Td>
              <Td>{r.ra}</Td>
              <Td>{r.rd > 0 ? `+${r.rd}` : r.rd}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-right font-semibold ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-right tabular-nums ${className}`}>{children}</td>;
}

function formatPct(p: number): string {
  if (p === 1) return "1.000";
  return p.toFixed(3).replace(/^0/, "");
}
