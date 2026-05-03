import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminDb } from "@/lib/firebase-admin";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

export default async function PlayerDetailPage({
  params,
}: {
  params: { playerId: string };
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
      <Shell heading="Player">
        <p className="text-slate-700">Visit a tenant subdomain.</p>
      </Shell>
    );
  }

  const db = getAdminDb();
  const playerSnap = await db
    .doc(`leagues/${tenantId}/players/${params.playerId}`)
    .get();
  if (!playerSnap.exists) notFound();

  const data = playerSnap.data() ?? {};
  const name = String(data.name ?? params.playerId);
  const teamId = String(data.team_id ?? "");
  const jersey = data.jersey != null ? Number(data.jersey) : null;
  const position = data.position ? String(data.position) : null;
  const stats = (data.stats ?? null) as Record<string, number> | null;
  const pitching = (data.pitching ?? null) as Record<string, number> | null;

  let teamName: string | null = null;
  if (teamId) {
    const teamSnap = await db.doc(`leagues/${tenantId}/teams/${teamId}`).get();
    if (teamSnap.exists) {
      teamName = String(teamSnap.data()?.name ?? teamId);
    }
  }

  const showPitching = !!pitching && (config?.pitching?.tracked ?? true);

  return (
    <Shell heading={name}>
      <p className="mb-6 text-sm text-slate-500">
        {jersey != null && <span className="font-mono">#{jersey} · </span>}
        {position && <span>{position} · </span>}
        {teamId && (
          <Link href={`/teams/${teamId}`} className="text-slate-700 hover:underline">
            {teamName ?? teamId}
          </Link>
        )}
      </p>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Batting</h2>
        {!stats || Number(stats.gp ?? 0) === 0 ? (
          <p className="text-sm text-slate-500">No batting stats yet.</p>
        ) : (
          <StatGrid
            entries={[
              ["GP", stats.gp],
              ["AB", stats.ab],
              ["R", stats.r],
              ["H", stats.h],
              ["2B", stats.doubles],
              ["3B", stats.triples],
              ["HR", stats.hr],
              ["RBI", stats.rbi],
              ["BB", stats.bb],
              ["SO", stats.so],
              ["SB", stats.sb],
              ["AVG", formatAvg(Number(stats.avg ?? 0))],
              ["OBP", formatAvg(Number(stats.obp ?? 0))],
              ["SLG", formatAvg(Number(stats.slg ?? 0))],
              ["OPS", formatAvg(Number(stats.ops ?? 0))],
            ]}
          />
        )}
      </section>

      {showPitching && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-800">Pitching</h2>
          {!pitching || Number(pitching.app ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">No pitching stats yet.</p>
          ) : (
            <StatGrid
              entries={[
                ["APP", pitching.app],
                ["W", pitching.w],
                ["L", pitching.l],
                ["SV", pitching.sv],
                ["IP", formatIPDisplay(Number(pitching.ip_outs ?? 0))],
                ["H", pitching.h],
                ["R", pitching.r],
                ["ER", pitching.er],
                ["BB", pitching.bb],
                ["SO", pitching.so],
                ["HR", pitching.hr],
                ["ERA", (Number(pitching.era ?? 0)).toFixed(2)],
                ["WHIP", (Number(pitching.whip ?? 0)).toFixed(2)],
              ]}
            />
          )}
        </section>
      )}
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
      <header className="mb-2">
        <Link href="/players" className="text-xs text-slate-500 hover:underline">
          ← All players
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
      </header>
      {children}
    </main>
  );
}

function StatGrid({ entries }: { entries: Array<[string, unknown]> }) {
  return (
    <dl className="grid grid-cols-3 gap-3 sm:grid-cols-5">
      {entries.map(([label, value]) => (
        <div
          key={label}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-center"
        >
          <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-1 font-mono text-base font-semibold tabular-nums">
            {String(value ?? 0)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function formatAvg(n: number): string {
  if (n === 1) return "1.000";
  return n.toFixed(3).replace(/^0/, "");
}
function formatIPDisplay(outs: number): string {
  if (!Number.isFinite(outs)) return "0.0";
  const innings = Math.floor(outs / 3);
  const partial = outs % 3;
  return `${innings}.${partial}`;
}
