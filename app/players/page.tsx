// DVSL-style stats page: leaderboards (top batters, top pitchers) +
// full league stats table.

import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminDb } from "@/lib/firebase-admin";
import { statsEnabled } from "@/lib/tenant-flags";
import { numericStatsOrEmpty } from "@/lib/safe-stats";
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
  // Stats-off tenants (e.g. COYBL) have no player stats — 404 the direct URL
  // so there's no orphan stats surface the nav already hides.
  if (!statsEnabled(config)) notFound();

  const db = getAdminDb();
  // Fetch ALL players, then filter in memory. The earlier
  // `.where("status", "==", "active")` Firestore filter accidentally
  // dropped every SFBL player (their docs were provisioned with
  // `active: true` but no `status` field — equality filters in
  // Firestore exclude missing fields). We need to keep both:
  //   - SFBL docs (active:true, no status)  → keep
  //   - LBDC active docs (status:"active")  → keep
  //   - LBDC orphans (status:"unknown", orphan:true) → drop
  // Audit C1 fix (2026-05-15).
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

  const players: PlayerRow[] = playersSnap.docs
    // Same orphan/inactive filter the captain surfaces use. Missing
    // status field PASSES THROUGH (SFBL legacy convention).
    .filter((d) => {
      const data = d.data();
      if (data.active === false) return false;
      if (data.orphan === true) return false;
      if (data.status && data.status !== "active") return false;
      return true;
    })
    .map((d) => {
    const data = d.data();
    // Audit M3.
    const stats = numericStatsOrEmpty(data.stats);
    const pitching = numericStatsOrEmpty(data.pitching);
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
      // Read either field — LBDC's migration writes `number`,
      // SFBL captain UI writes `jersey`. Coerces "" / "—" / non-
      // numeric strings to null so the cell renders an em-dash.
      jersey: jerseyNum(data.jersey ?? data.number),
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
        <>
          <div
            style={{
              padding: "20px 24px",
              background: "rgba(0,0,0,0.03)",
              border: "1px dashed rgba(0,0,0,0.12)",
              borderRadius: 12,
              textAlign: "center",
              color: "var(--muted)",
              lineHeight: 1.55,
              marginBottom: 28,
            }}
          >
            <strong style={{ color: "var(--brand-primary)", fontSize: 15 }}>
              Stats will appear once captains submit box scores.
            </strong>
            <p style={{ margin: "6px 0 0", fontSize: 13 }}>
              Until then, here&rsquo;s every rostered player in the
              league.
            </p>
          </div>
          <RosterDirectory players={players} teams={teams} />
        </>
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

// Coerce an arbitrary jersey value to a number, returning null when
// the input is empty / non-numeric. Mirrors the helper in
// /teams/[id]/page.tsx — kept inline (not extracted to a shared
// util) so each page-level loader stays self-contained.
function jerseyNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (s === "" || s === "—" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function formatAvg(n: number): string {
  if (n === 1) return "1.000";
  return n.toFixed(3).replace(/^0/, "");
}

// Pre-stats roster directory. Renders only when no batting/pitching
// data exists yet (early season). Groups every player under their
// team with logo header, sorted by jersey number then alphabetical.
// Useful for fans who want to confirm a teammate is rostered, and
// for captains spot-checking their lineup pre-game.
function RosterDirectory({
  players,
  teams,
}: {
  players: PlayerRow[];
  teams: Record<
    string,
    { name: string; abbrev?: string; color?: string; logoUrl?: string | null }
  >;
}) {
  // Group players by team_id.
  const byTeam = new Map<string, PlayerRow[]>();
  for (const p of players) {
    if (!p.team_id) continue;
    const arr = byTeam.get(p.team_id) ?? [];
    arr.push(p);
    byTeam.set(p.team_id, arr);
  }

  // Sort teams by name (or could group by division — keep simple).
  const teamIds = [...byTeam.keys()].sort((a, b) => {
    const an = teams[a]?.name ?? a;
    const bn = teams[b]?.name ?? b;
    return an.localeCompare(bn);
  });

  if (teamIds.length === 0) {
    return (
      <p style={{ color: "var(--muted)", textAlign: "center", padding: 32 }}>
        No rosters yet.
      </p>
    );
  }

  return (
    <section style={{ display: "grid", gap: 18 }}>
      <h2
        className="font-display"
        style={{
          fontSize: 22,
          color: "var(--text-strong)",
          margin: "0 0 4px",
          fontWeight: 800,
          letterSpacing: "-0.005em",
          textTransform: "uppercase",
        }}
      >
        Rosters
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 14,
        }}
      >
        {teamIds.map((teamId) => {
          const team = teams[teamId];
          if (!team) return null;
          const teamPlayers = (byTeam.get(teamId) ?? [])
            .slice()
            .sort((a, b) => {
              // Players with jersey numbers first, sorted asc; then no-jersey alphabetical.
              const aHas = a.jersey != null;
              const bHas = b.jersey != null;
              if (aHas && !bHas) return -1;
              if (!aHas && bHas) return 1;
              if (aHas && bHas) return (a.jersey ?? 0) - (b.jersey ?? 0);
              return a.name.localeCompare(b.name);
            });
          return (
            <article
              key={teamId}
              style={{
                background: "white",
                border: "1px solid rgba(0, 0, 0, 0.08)",
                borderRadius: 12,
                padding: "14px 14px 10px",
              }}
            >
              <Link
                href={`/teams/${teamId}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  paddingBottom: 10,
                  borderBottom: "1px solid rgba(0,0,0,0.06)",
                  textDecoration: "none",
                  color: "var(--text-strong)",
                }}
              >
                <TeamBadge
                  teamId={teamId}
                  name={team.name}
                  initials={team.abbrev}
                  color={team.color}
                  logoUrl={team.logoUrl}
                  size="md"
                />
                <span
                  style={{
                    fontFamily: "var(--font-barlow), sans-serif",
                    fontWeight: 800,
                    fontSize: 15,
                    letterSpacing: "0.01em",
                    textTransform: "uppercase",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {team.name}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--muted)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {teamPlayers.length}
                </span>
              </Link>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: "8px 0 0",
                  display: "grid",
                  gap: 1,
                }}
              >
                {teamPlayers.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/players/${p.id}`}
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                        padding: "5px 4px",
                        fontSize: 13,
                        textDecoration: "none",
                        color: "var(--text-strong)",
                        borderRadius: 6,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-barlow), sans-serif",
                          fontWeight: 800,
                          color: "var(--muted)",
                          width: 26,
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          flexShrink: 0,
                        }}
                      >
                        {p.jersey != null ? `#${p.jersey}` : ""}
                      </span>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {p.name}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}
