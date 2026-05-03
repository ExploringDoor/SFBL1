import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { computeStandings, type GameResult } from "@/lib/stats/shared";

// Server component — runs on every request, no client-side Firestore.
// Phase 5 will add per-tenant theme variables to <html>; for now this
// renders with default Tailwind.
export const dynamic = "force-dynamic";

export default async function StandingsPage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  const tenantName = (() => {
    const cfg = h.get("x-tenant-config-json");
    if (!cfg) return null;
    try {
      return (JSON.parse(cfg) as { name?: string }).name ?? null;
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

  const { rows, teamNames } = await loadStandings(tenantId);

  return (
    <Shell heading={tenantName ? `${tenantName} — Standings` : "Standings"}>
      {rows.length === 0 ? (
        <p className="text-slate-600">No final games yet.</p>
      ) : (
        <StandingsTable rows={rows} teamNames={teamNames} />
      )}
    </Shell>
  );
}

async function loadStandings(tenantId: string): Promise<{
  rows: ReturnType<typeof computeStandings>;
  teamNames: Record<string, string>;
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

  const teamNames: Record<string, string> = {};
  for (const d of teamsSnap.docs) {
    teamNames[d.id] = String(d.data().name ?? d.id);
  }

  return { rows: computeStandings(games), teamNames };
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
  teamNames,
}: {
  rows: ReturnType<typeof computeStandings>;
  teamNames: Record<string, string>;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <Th className="text-left">Team</Th>
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
                {teamNames[r.team_id] ?? r.team_id}
              </Td>
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

// Baseball convention: drop leading zero, three decimal places.
// .500 not 0.500.
function formatPct(p: number): string {
  if (p === 1) return "1.000";
  return p.toFixed(3).replace(/^0/, "");
}
