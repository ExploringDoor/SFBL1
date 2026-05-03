import Link from "next/link";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

interface PlayerRow {
  id: string;
  name: string;
  team_id: string;
  team_name: string;
  jersey: number | null;
  position: string | null;
  ab: number;
  h: number;
  hr: number;
  rbi: number;
  avg: number;
  ops: number;
  hasStats: boolean;
}

export default async function PlayersPage() {
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
      <Shell heading="Players">
        <p className="text-slate-700">Visit a tenant subdomain.</p>
      </Shell>
    );
  }

  const db = getAdminDb();
  const [playersSnap, teamsSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/players`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
  ]);

  const teamNames: Record<string, string> = {};
  for (const d of teamsSnap.docs) {
    teamNames[d.id] = String(d.data().name ?? d.id);
  }

  const players: PlayerRow[] = playersSnap.docs.map((d) => {
    const data = d.data();
    const stats = (data.stats ?? {}) as Record<string, number>;
    const hasStats = Number(stats.gp ?? 0) > 0;
    return {
      id: d.id,
      name: String(data.name ?? d.id),
      team_id: String(data.team_id ?? ""),
      team_name: teamNames[String(data.team_id ?? "")] ?? "",
      jersey: data.jersey != null ? Number(data.jersey) : null,
      position: data.position ? String(data.position) : null,
      ab: Number(stats.ab ?? 0),
      h: Number(stats.h ?? 0),
      hr: Number(stats.hr ?? 0),
      rbi: Number(stats.rbi ?? 0),
      avg: Number(stats.avg ?? 0),
      ops: Number(stats.ops ?? 0),
      hasStats,
    };
  });
  // Players with stats first (sorted by AVG desc), then no-stat roster fillers.
  players.sort((a, b) => {
    if (a.hasStats !== b.hasStats) return a.hasStats ? -1 : 1;
    if (a.hasStats && b.hasStats) return b.avg - a.avg;
    return a.name.localeCompare(b.name);
  });

  return (
    <Shell heading={config?.name ? `${config.name} — Players` : "Players"}>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <Th className="text-left">Player</Th>
              <Th className="text-left">Team</Th>
              <Th>AB</Th>
              <Th>H</Th>
              <Th>HR</Th>
              <Th>RBI</Th>
              <Th>AVG</Th>
              <Th>OPS</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {players.map((p) => (
              <tr key={p.id} className="text-sm hover:bg-slate-50">
                <Td className="text-left font-medium">
                  <Link href={`/players/${p.id}`} className="hover:underline">
                    {p.jersey != null && (
                      <span className="text-xs text-slate-500">#{p.jersey} </span>
                    )}
                    {p.name}
                  </Link>
                </Td>
                <Td className="text-left text-slate-600">
                  {p.team_id ? (
                    <Link href={`/teams/${p.team_id}`} className="hover:underline">
                      {p.team_name || p.team_id}
                    </Link>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td>{p.hasStats ? p.ab : "—"}</Td>
                <Td>{p.hasStats ? p.h : "—"}</Td>
                <Td>{p.hasStats ? p.hr : "—"}</Td>
                <Td>{p.hasStats ? p.rbi : "—"}</Td>
                <Td>{p.hasStats ? formatAvg(p.avg) : "—"}</Td>
                <Td>{p.hasStats ? formatAvg(p.ops) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
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
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
      </header>
      {children}
    </main>
  );
}
function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-right font-semibold ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-right tabular-nums ${className}`}>{children}</td>;
}
function formatAvg(n: number): string {
  if (n === 1) return "1.000";
  return n.toFixed(3).replace(/^0/, "");
}
