// DVSL-style stats page: leaderboards (top batters, top pitchers) +
// full league stats table.

import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminDb } from "@/lib/firebase-admin";
import { TeamBadge } from "@/components/TeamBadge";
import { formatIP } from "@/lib/stats/ip";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { statsEnabled } from "@/lib/tenant-flags";

export const dynamic = "force-dynamic";

interface PlayerRow {
  id: string;
  name: string;
  team_id: string;
  team_name: string;
  team_abbrev?: string;
  team_color?: string;
  team_logo?: string | null;
  jersey: number | null;
  ab: number;
  h: number;
  hr: number;
  rbi: number;
  avg: number;
  obp: number;
  slg: number;
  ops: number;
  // pitching
  ip_outs?: number;
  era?: number;
  whip?: number;
  pitch_so?: number;
  hasBatting: boolean;
  hasPitching: boolean;
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
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

  // Stats-off tenants (COYBL) have no stats page — 404 on a direct/stale URL.
  if (!statsEnabled(config)) notFound();

  const db = getAdminDb();
  const [playersSnap, teamsSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/players`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
  ]);

  const teams: Record<string, { name: string; abbrev?: string; color?: string; logoUrl?: string | null }> = {};
  for (const d of teamsSnap.docs) {
    const data = d.data();
    teams[d.id] = {
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      color: data.color ? String(data.color) : undefined,
      logoUrl: data.logo_url ? String(data.logo_url) : null,
    };
  }

  const players: PlayerRow[] = playersSnap.docs.map((d) => {
    const data = d.data();
    const stats = (data.stats ?? {}) as Record<string, number>;
    const pitching = (data.pitching ?? {}) as Record<string, number>;
    const teamId = String(data.team_id ?? "");
    const t = teams[teamId];
    return {
      id: d.id,
      name: String(data.name ?? d.id),
      team_id: teamId,
      team_name: t?.name ?? "",
      team_abbrev: t?.abbrev,
      team_color: t?.color,
      team_logo: t?.logoUrl ?? null,
      jersey: data.jersey != null ? Number(data.jersey) : null,
      ab: Number(stats.ab ?? 0),
      h: Number(stats.h ?? 0),
      hr: Number(stats.hr ?? 0),
      rbi: Number(stats.rbi ?? 0),
      avg: Number(stats.avg ?? 0),
      obp: Number(stats.obp ?? 0),
      slg: Number(stats.slg ?? 0),
      ops: Number(stats.ops ?? 0),
      ip_outs: pitching.ip_outs,
      era: pitching.era,
      whip: pitching.whip,
      pitch_so: pitching.so,
      hasBatting: Number(stats.gp ?? 0) > 0,
      hasPitching: Number(pitching.app ?? 0) > 0,
    };
  });

  const battingLeaders = [...players]
    .filter((p) => p.hasBatting)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);
  const opsLeaders = [...players]
    .filter((p) => p.hasBatting)
    .sort((a, b) => b.ops - a.ops)
    .slice(0, 5);
  const eraLeaders = [...players]
    .filter((p) => p.hasPitching)
    .sort((a, b) => (a.era ?? 99) - (b.era ?? 99))
    .slice(0, 5);

  // All batters table.
  const allBatters = [...players]
    .filter((p) => p.hasBatting)
    .sort((a, b) => b.ops - a.ops);

  return (
    <main className="container py-10">
      <header className="mb-8">
        <h1 className="font-display" style={{ fontSize: "clamp(40px, 6vw, 64px)" }}>
          <span style={{ color: "var(--text-strong)" }}>League</span>{" "}
          <span style={{ color: "var(--brand-primary)" }}>Stats</span>
        </h1>
        {config?.name && <p className="sec-eyebrow mt-1">{config.name}</p>}
      </header>

      <div className="mb-10 grid gap-6 md:grid-cols-3">
        <Leaderboard
          heading="Batting Average"
          rows={battingLeaders}
          accessor={(p) => formatAvg(p.avg)}
        />
        <Leaderboard
          heading="OPS"
          rows={opsLeaders}
          accessor={(p) => formatAvg(p.ops)}
        />
        <Leaderboard
          heading="ERA"
          rows={eraLeaders}
          accessor={(p) => (p.era != null ? p.era.toFixed(2) : "—")}
        />
      </div>

      <h2 className="font-display mb-3" style={{ fontSize: 28 }}>
        Batting (full)
      </h2>
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <table className="s-tbl">
          <thead>
            <tr>
              <th className="text-left">Player</th>
              <th className="text-left">Team</th>
              <th>AB</th>
              <th>H</th>
              <th>HR</th>
              <th>RBI</th>
              <th>AVG</th>
              <th>OBP</th>
              <th>SLG</th>
              <th>OPS</th>
            </tr>
          </thead>
          <tbody>
            {allBatters.map((p) => (
              <tr key={p.id}>
                <td className="text-left">
                  <Link href={`/players/${p.id}`} style={{ fontWeight: 600 }}>
                    {p.name}
                  </Link>
                </td>
                <td className="text-left">
                  {p.team_id && (
                    <Link
                      href={`/teams/${p.team_id}`}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                    >
                      <TeamBadge
                        teamId={p.team_id}
                        name={p.team_name}
                        initials={p.team_abbrev}
                        color={p.team_color}
                        logoUrl={p.team_logo}
                        size="sm"
                      />
                      <span style={{ fontSize: 12 }}>{p.team_abbrev ?? p.team_name}</span>
                    </Link>
                  )}
                </td>
                <td>{p.ab}</td>
                <td>{p.h}</td>
                <td>{p.hr}</td>
                <td>{p.rbi}</td>
                <td>{formatAvg(p.avg)}</td>
                <td>{formatAvg(p.obp)}</td>
                <td>{formatAvg(p.slg)}</td>
                <td>{formatAvg(p.ops)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {eraLeaders.length > 0 && (
        <>
          <h2 className="font-display mb-3 mt-10" style={{ fontSize: 28 }}>
            Pitching (full)
          </h2>
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <table className="s-tbl">
              <thead>
                <tr>
                  <th className="text-left">Pitcher</th>
                  <th className="text-left">Team</th>
                  <th>IP</th>
                  <th>K</th>
                  <th>ERA</th>
                  <th>WHIP</th>
                </tr>
              </thead>
              <tbody>
                {[...players]
                  .filter((p) => p.hasPitching)
                  .sort((a, b) => (a.era ?? 99) - (b.era ?? 99))
                  .map((p) => (
                    <tr key={p.id}>
                      <td className="text-left">
                        <Link href={`/players/${p.id}`} style={{ fontWeight: 600 }}>
                          {p.name}
                        </Link>
                      </td>
                      <td className="text-left">
                        {p.team_abbrev ?? p.team_name}
                      </td>
                      <td>{formatIP(p.ip_outs ?? 0)}</td>
                      <td>{p.pitch_so ?? 0}</td>
                      <td>{(p.era ?? 0).toFixed(2)}</td>
                      <td>{(p.whip ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}

function Leaderboard({
  heading,
  rows,
  accessor,
}: {
  heading: string;
  rows: PlayerRow[];
  accessor: (p: PlayerRow) => string;
}) {
  return (
    <section
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <h3
        className="font-barlow"
        style={{
          fontSize: 12,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "0.18em",
          color: "var(--brand-primary)",
          marginBottom: 12,
        }}
      >
        {heading}
      </h3>
      {rows.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>No data yet.</p>
      ) : (
        <ol style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((p, i) => (
            <li
              key={p.id}
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}
            >
              <span
                className="font-barlow"
                style={{
                  fontSize: 11,
                  width: 14,
                  color: "var(--muted)",
                  textAlign: "center",
                }}
              >
                {i + 1}
              </span>
              <TeamBadge
                teamId={p.team_id}
                name={p.team_name}
                initials={p.team_abbrev}
                color={p.team_color}
                logoUrl={p.team_logo}
                size="sm"
              />
              <Link href={`/players/${p.id}`} style={{ flex: 1, fontWeight: 600 }}>
                {p.name}
              </Link>
              <span
                className="font-barlow"
                style={{ fontWeight: 800, color: "var(--brand-primary)" }}
              >
                {accessor(p)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function formatAvg(n: number): string {
  if (n === 1) return "1.000";
  return n.toFixed(3).replace(/^0/, "");
}
