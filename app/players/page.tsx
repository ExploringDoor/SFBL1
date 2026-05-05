// DVSL-style stats page: leaderboards (top batters, top pitchers) +
// full league stats table.

import Link from "next/link";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { TeamBadge } from "@/components/TeamBadge";
import { formatIP } from "@/lib/stats/ip";
import type { PublicLeagueConfig } from "@/lib/tenants";
import {
  SortableStatsTable,
  type StatsCol,
  type StatsRow,
} from "@/components/ui/SortableStatsTable";
import "@/components/ui/SortableStatsTable.css";

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

  // Pre-bake rows for the sortable table. Server Components can't
  // pass accessor functions to Client Component props, so values +
  // display are pre-computed here as plain serializable maps.
  const battingRows: StatsRow[] = players
    .filter((p) => p.hasBatting)
    .map((p) => ({
      id: p.id,
      name: p.name,
      team: <TeamCell row={p} />,
      values: {
        ab: p.ab,
        h: p.h,
        hr: p.hr,
        rbi: p.rbi,
        avg: p.avg,
        obp: p.obp,
        slg: p.slg,
        ops: p.ops,
      },
      display: {
        ab: String(p.ab),
        h: String(p.h),
        hr: String(p.hr),
        rbi: String(p.rbi),
        avg: formatAvg(p.avg),
        obp: formatAvg(p.obp),
        slg: formatAvg(p.slg),
        ops: formatAvg(p.ops),
      },
    }));
  const pitchingRows: StatsRow[] = players
    .filter((p) => p.hasPitching)
    .map((p) => ({
      id: p.id,
      name: p.name,
      team: <TeamCell row={p} />,
      values: {
        ip: p.ip_outs ?? 0,
        k: p.pitch_so ?? 0,
        era: p.era ?? 99,
        whip: p.whip ?? 99,
      },
      display: {
        ip: formatIP(p.ip_outs ?? 0),
        k: String(p.pitch_so ?? 0),
        era: (p.era ?? 0).toFixed(2),
        whip: (p.whip ?? 0).toFixed(2),
      },
    }));

  return (
    <main className="container py-10">
      <header className="mb-8">
        <h1 className="font-display" style={{ fontSize: "clamp(40px, 6vw, 64px)" }}>
          <span style={{ color: "var(--text-strong)" }}>League</span>{" "}
          <span style={{ color: "var(--brand-primary)" }}>Stats</span>
        </h1>
        {config?.name && <p className="sec-eyebrow mt-1">{config.name}</p>}
      </header>

      {/* Hide leaderboards + tables when there's nothing to show.
          Day-1 the league has rosters but no recorded stats — three
          empty card cells looked broken in QA. */}
      {battingRows.length === 0 && pitchingRows.length === 0 ? (
        <div
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
          <strong style={{ color: "var(--brand-primary)", fontSize: 16 }}>
            Stats will appear once games are played.
          </strong>
          <p style={{ margin: "8px 0 0", fontSize: 14 }}>
            Captains submit box scores after games; player season
            totals + leaderboards calculate from there.
          </p>
        </div>
      ) : (
        <>
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

          {battingRows.length > 0 && (
            <>
              <h2 className="font-barlow mb-3" style={{ fontSize: 24, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>
                Batting
              </h2>
              <SortableStatsTable
                rows={battingRows}
                defaultSort="ops"
                columns={BATTING_COLS}
              />
            </>
          )}

          {pitchingRows.length > 0 && (
            <>
              <h2 className="font-barlow mb-3 mt-10" style={{ fontSize: 24, fontWeight: 900, textTransform: "uppercase", letterSpacing: "-0.01em" }}>
                Pitching
              </h2>
              <SortableStatsTable
                rows={pitchingRows}
                defaultSort="era"
                columns={PITCHING_COLS}
              />
            </>
          )}
        </>
      )}
    </main>
  );
}

function TeamCell({ row }: { row: PlayerRow }) {
  if (!row.team_id) return null;
  return (
    <Link
      href={`/teams/${row.team_id}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <TeamBadge
        teamId={row.team_id}
        name={row.team_name}
        initials={row.team_abbrev}
        color={row.team_color}
        logoUrl={row.team_logo}
        size="sm"
      />
      <span style={{ fontSize: 12 }}>{row.team_abbrev ?? row.team_name}</span>
    </Link>
  );
}

const BATTING_COLS: StatsCol[] = [
  { key: "ab", label: "AB" },
  { key: "h", label: "H" },
  { key: "hr", label: "HR" },
  { key: "rbi", label: "RBI" },
  { key: "avg", label: "AVG" },
  { key: "obp", label: "OBP" },
  { key: "slg", label: "SLG" },
  { key: "ops", label: "OPS" },
];

const PITCHING_COLS: StatsCol[] = [
  { key: "ip", label: "IP" },
  { key: "k", label: "K" },
  { key: "era", label: "ERA", higherBetter: false },
  { key: "whip", label: "WHIP", higherBetter: false },
];

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
