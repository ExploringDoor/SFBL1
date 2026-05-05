// DVSL-style team detail page: hero strip with team logo + name +
// record, two-column layout (roster left, recent games right).

import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminDb } from "@/lib/firebase-admin";
import { TeamBadge } from "@/components/TeamBadge";
import { SubscribeCalendar } from "@/components/SubscribeCalendar";
import {
  computePoints,
  computeStandings,
  sortByPoints,
  type GameResult,
} from "@/lib/stats/shared";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

export default async function TeamDetailPage({
  params,
}: {
  params: { teamId: string };
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
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
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

  const t = teamSnap.data() ?? {};
  const teamName = String(t.name ?? params.teamId);
  const division = t.division ? String(t.division) : null;
  const abbrev = t.abbrev ? String(t.abbrev) : undefined;
  const color = t.color ? String(t.color) : undefined;
  const logoUrl = t.logo_url ? String(t.logo_url) : null;

  const teamNames: Record<string, { name: string; abbrev?: string; color?: string; logoUrl?: string | null }> = {};
  for (const d of teamsSnap.docs) {
    const data = d.data();
    teamNames[d.id] = {
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      color: data.color ? String(data.color) : undefined,
      logoUrl: data.logo_url ? String(data.logo_url) : null,
    };
  }

  const games: GameResult[] = gamesSnap.docs.map((d) => {
    const data = d.data();
    return {
      home_team_id: String(data.home_team_id ?? ""),
      away_team_id: String(data.away_team_id ?? ""),
      home_score: Number(data.home_score ?? 0),
      away_score: Number(data.away_score ?? 0),
      status: (data.status ?? "draft") as GameResult["status"],
      date: data.date ? String(data.date) : undefined,
    };
  });
  let standings = computeStandings(games);
  const scheme = config?.standings?.points_per ?? null;
  const usePoints = config?.standings?.scoring === "points" && !!scheme;
  if (usePoints && scheme) {
    standings = sortByPoints(standings, scheme, config?.standings?.tiebreaker ?? "rd");
  }
  const myRow = standings.find((r) => r.team_id === params.teamId) ?? null;

  // Standings position WITHIN this team's division. If the league
  // has no division structure, fall back to overall position. Only
  // meaningful when games have actually been played — for fresh
  // launches we hide the rank entirely.
  const hasGames = !!myRow && myRow.w + myRow.l + myRow.t > 0;
  let divisionRank: { rank: number; total: number } | null = null;
  if (hasGames && division) {
    const divPeers = standings.filter((r) => {
      const meta = teamNames[r.team_id];
      // teamNames map is keyed by id; we need the team's division
      // from teamsSnap. Fast inline lookup.
      const peerDoc = teamsSnap.docs.find((d) => d.id === r.team_id);
      return peerDoc && String(peerDoc.data().division ?? "") === division;
    });
    const idx = divPeers.findIndex((r) => r.team_id === params.teamId);
    if (idx >= 0) divisionRank = { rank: idx + 1, total: divPeers.length };
  } else if (hasGames) {
    const idx = standings.findIndex((r) => r.team_id === params.teamId);
    if (idx >= 0) divisionRank = { rank: idx + 1, total: standings.length };
  }

  // Team batting/pitching aggregates from rosterSnap player.stats.
  const aggBatting = aggregateRoster(rosterSnap.docs.map((d) => d.data().stats));
  const aggPitching = aggregateRosterPitching(rosterSnap.docs.map((d) => d.data().pitching));

  // Roster sorted by jersey #.
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

  // Recent + upcoming games for this team.
  const myGames = gamesSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown> & { id: string })
    .filter((g) => g.home_team_id === params.teamId || g.away_team_id === params.teamId);
  const recentFinals = myGames
    .filter((g) => g.status === "final" || g.status === "approved")
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
    .slice(0, 6);
  const upcoming = myGames
    .filter((g) => g.status === "scheduled")
    .sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")))
    .slice(0, 4);

  return (
    <main>
      {/* Hero band */}
      <section
        className="text-white"
        style={{
          background: `linear-gradient(135deg, ${color ?? "var(--brand-primary)"} 0%, #0a0e1c 80%)`,
        }}
      >
        <div className="container" style={{ padding: "48px 24px" }}>
          <Link
            href="/teams"
            className="font-barlow"
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.7)",
              display: "inline-block",
              marginBottom: 18,
            }}
          >
            ← All Teams
          </Link>
          <div className="flex items-center gap-6">
            <div style={{ background: "white", borderRadius: 16, padding: 14 }}>
              <TeamBadge
                teamId={params.teamId}
                name={teamName}
                initials={abbrev}
                color={color}
                logoUrl={logoUrl}
                size="xl"
              />
            </div>
            <div>
              {division && (
                <p className="sec-eyebrow" style={{ color: "rgba(255,255,255,0.7)" }}>
                  {division}
                </p>
              )}
              <h1
                className="font-display"
                style={{ fontSize: "clamp(40px, 6vw, 72px)", color: "#fff", marginTop: 4 }}
              >
                {teamName}
              </h1>
              {/* Stats pill row — only shown when there's been at
                  least one game played. Pre-launch shows a "Season
                  starts soon" pill instead so the page doesn't
                  look broken. */}
              {hasGames && myRow ? (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    marginTop: 12,
                  }}
                >
                  <HeroPill
                    primary={formatRecord(myRow.w, myRow.l, myRow.t)}
                    label="Record"
                  />
                  {usePoints && scheme && (
                    <HeroPill
                      primary={String(computePoints(myRow, scheme))}
                      label="Points"
                    />
                  )}
                  <HeroPill
                    primary={
                      myRow.rd > 0
                        ? `+${myRow.rd}`
                        : String(myRow.rd)
                    }
                    label="Run diff"
                  />
                  {divisionRank && (
                    <HeroPill
                      primary={`${ordinal(divisionRank.rank)}`}
                      label={
                        division
                          ? `in ${division}`
                          : `of ${divisionRank.total}`
                      }
                    />
                  )}
                </div>
              ) : (
                <p
                  className="font-barlow mt-3"
                  style={{
                    display: "inline-block",
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "#fff",
                    background: "rgba(255,255,255,0.12)",
                    padding: "5px 12px",
                    borderRadius: 999,
                  }}
                >
                  Season starts soon
                </p>
              )}
              <div style={{ marginTop: 14 }}>
                <SubscribeCalendar teamId={params.teamId} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="container py-10">
        {(aggBatting.gp > 0 || aggPitching.app > 0) && (
          <div className="mb-8 grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            {aggBatting.gp > 0 && (
              <>
                <StatTile label="Team AVG" value={formatAvg(aggBatting.avg)} />
                <StatTile label="Runs Scored" value={aggBatting.r} />
                <StatTile label="Home Runs" value={aggBatting.hr} />
              </>
            )}
            {aggPitching.app > 0 && (
              <StatTile label="Team ERA" value={aggPitching.era.toFixed(2)} />
            )}
          </div>
        )}

        {/* Top performers — only shown when there's actual stat data
            on the roster. Surfaces the team's leading batter / power
            hitter / RBI guy in a small card row above the full
            roster table. Helps fans + opposing-team scouts spot
            who's hot. Hidden pre-launch. */}
        {(() => {
          const playersWithStats = roster.filter(
            (p) => p.avg != null || p.hr != null || p.rbi != null,
          );
          if (playersWithStats.length === 0) return null;
          const topAvg = [...playersWithStats]
            .filter((p) => p.avg != null && p.avg > 0)
            .sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0))[0];
          const topHr = [...playersWithStats]
            .filter((p) => p.hr != null && p.hr > 0)
            .sort((a, b) => (b.hr ?? 0) - (a.hr ?? 0))[0];
          const topRbi = [...playersWithStats]
            .filter((p) => p.rbi != null && p.rbi > 0)
            .sort((a, b) => (b.rbi ?? 0) - (a.rbi ?? 0))[0];
          if (!topAvg && !topHr && !topRbi) return null;
          return (
            <div className="mb-8">
              <h2
                className="font-barlow mb-3"
                style={{
                  fontSize: 18,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--brand-primary)",
                }}
              >
                Top Performers
              </h2>
              <div className="grid gap-3 sm:grid-cols-3">
                {topAvg && (
                  <TopPerformerCard
                    label="Batting AVG"
                    value={formatAvg(topAvg.avg ?? 0)}
                    playerId={topAvg.id}
                    playerName={topAvg.name}
                    jersey={topAvg.jersey}
                  />
                )}
                {topHr && (
                  <TopPerformerCard
                    label="Home Runs"
                    value={String(topHr.hr ?? 0)}
                    playerId={topHr.id}
                    playerName={topHr.name}
                    jersey={topHr.jersey}
                  />
                )}
                {topRbi && (
                  <TopPerformerCard
                    label="RBI"
                    value={String(topRbi.rbi ?? 0)}
                    playerId={topRbi.id}
                    playerName={topRbi.name}
                    jersey={topRbi.jersey}
                  />
                )}
              </div>
            </div>
          );
        })()}

        <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
          <div>
            <h2 className="font-display mb-4" style={{ fontSize: 28 }}>
              Roster
            </h2>
            {roster.length === 0 ? (
              <p style={{ color: "var(--muted)" }}>No players on roster yet.</p>
            ) : (
              <RosterTable roster={roster} hasGames={hasGames} />
            )}
          </div>

          <aside>
            <h2 className="font-display mb-4" style={{ fontSize: 22 }}>
              Recent Results
            </h2>
            <ul style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recentFinals.length === 0 && (
                <li style={{ color: "var(--muted)", fontSize: 13 }}>
                  No games played yet.
                </li>
              )}
              {recentFinals.map((g) => (
                <GameLine
                  key={g.id}
                  myTeamId={params.teamId}
                  game={g}
                  teams={teamNames}
                />
              ))}
            </ul>
            {upcoming.length > 0 && (
              <>
                <h2 className="font-display mb-3 mt-6" style={{ fontSize: 22 }}>
                  Upcoming
                </h2>
                <ul style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {upcoming.map((g) => (
                    <GameLine
                      key={g.id}
                      myTeamId={params.teamId}
                      game={g}
                      teams={teamNames}
                    />
                  ))}
                </ul>
              </>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}

function TopPerformerCard({
  label,
  value,
  playerId,
  playerName,
  jersey,
}: {
  label: string;
  value: string;
  playerId: string;
  playerName: string;
  jersey: number | null;
}) {
  return (
    <Link
      href={`/players/${playerId}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 14px",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        textDecoration: "none",
        color: "inherit",
        transition: "transform 120ms ease, box-shadow 120ms ease",
      }}
    >
      <div
        className="font-barlow"
        style={{
          fontSize: 28,
          fontWeight: 900,
          color: "var(--brand-primary)",
          letterSpacing: "-0.02em",
          lineHeight: 1,
          minWidth: 50,
          textAlign: "center",
        }}
      >
        {value}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sec-eyebrow" style={{ marginBottom: 2 }}>
          {label}
        </div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text-strong)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {jersey != null ? `#${jersey} ` : ""}
          {playerName}
        </div>
      </div>
    </Link>
  );
}

interface RosterPlayer {
  id: string;
  name: string;
  jersey: number | null;
  position: string | null;
  avg?: number;
  hr?: number;
  rbi?: number;
}

function RosterTable({
  roster,
  hasGames,
}: {
  roster: RosterPlayer[];
  hasGames: boolean;
}) {
  // When the season hasn't started, drop the AVG/HR/RBI columns
  // entirely. The all-dashes table just looks broken; bare jersey/
  // name/position is cleaner and matches what the data actually
  // supports.
  if (!hasGames) {
    return (
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <table className="s-tbl">
          <thead>
            <tr>
              <th className="text-left">#</th>
              <th className="text-left">Player</th>
              <th className="text-left">Pos</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((p) => (
              <tr key={p.id}>
                <td className="text-left">
                  <span className="rank">{p.jersey ?? "—"}</span>
                </td>
                <td className="text-left">
                  <Link href={`/players/${p.id}`} style={{ fontWeight: 600 }}>
                    {p.name}
                  </Link>
                </td>
                <td className="text-left">
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>
                    {p.position ?? "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <table className="s-tbl">
        <thead>
          <tr>
            <th className="text-left">#</th>
            <th className="text-left">Player</th>
            <th className="text-left">Pos</th>
            <th>AVG</th>
            <th>HR</th>
            <th>RBI</th>
          </tr>
        </thead>
        <tbody>
          {roster.map((p) => (
            <tr key={p.id}>
              <td className="text-left">
                <span className="rank">{p.jersey ?? "—"}</span>
              </td>
              <td className="text-left">
                <Link href={`/players/${p.id}`} style={{ fontWeight: 600 }}>
                  {p.name}
                </Link>
              </td>
              <td className="text-left">
                <span style={{ color: "var(--muted)", fontSize: 12 }}>
                  {p.position ?? "—"}
                </span>
              </td>
              <td>{p.avg != null ? formatAvg(p.avg) : "—"}</td>
              <td>{p.hr ?? "—"}</td>
              <td>{p.rbi ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeroPill({
  primary,
  label,
}: {
  primary: string;
  label: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "8px 14px",
        background: "rgba(255,255,255,0.12)",
        borderRadius: 10,
        minWidth: 64,
      }}
    >
      <span
        className="font-barlow"
        style={{
          fontSize: 22,
          fontWeight: 900,
          color: "#fff",
          lineHeight: 1,
          letterSpacing: "-0.01em",
        }}
      >
        {primary}
      </span>
      <span
        className="font-barlow"
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.7)",
          marginTop: 2,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function ordinal(n: number): string {
  // 1 → 1st, 2 → 2nd, 3 → 3rd, 4 → 4th, 11/12/13 → 11th/12th/13th, etc.
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  const suffix = s[(v - 20) % 10] ?? s[v] ?? "th";
  return n + suffix;
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
        textAlign: "center",
      }}
    >
      <div className="sec-eyebrow">{label}</div>
      <div
        className="font-barlow"
        style={{ fontSize: 36, fontWeight: 900, color: "var(--brand-primary)", lineHeight: 1, marginTop: 4 }}
      >
        {value}
      </div>
    </div>
  );
}

function GameLine({
  myTeamId,
  game,
  teams,
}: {
  myTeamId: string;
  game: Record<string, unknown> & { id: string };
  teams: Record<string, { name: string; abbrev?: string; color?: string; logoUrl?: string | null }>;
}) {
  const isHome = game.home_team_id === myTeamId;
  const opponentId = String(isHome ? game.away_team_id : game.home_team_id);
  const opp = teams[opponentId];
  const myScore = Number(isHome ? game.home_score : game.away_score);
  const oppScore = Number(isHome ? game.away_score : game.home_score);
  const status = String(game.status ?? "");
  const isFinal = status === "final" || status === "approved";
  const won = isFinal && myScore > oppScore;
  const lost = isFinal && myScore < oppScore;
  const dateStr = game.date
    ? new Date(String(game.date)).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "";

  return (
    <li>
      <Link
        href={`/games/${game.id}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          border: "1px solid var(--border)",
          borderRadius: 10,
          background: "var(--card)",
          fontSize: 13,
        }}
      >
        <span
          className="font-barlow"
          style={{
            fontSize: 11,
            fontWeight: 800,
            width: 22,
            textAlign: "center",
            color: won ? "var(--green)" : lost ? "var(--red)" : "var(--muted)",
          }}
        >
          {won ? "W" : lost ? "L" : "·"}
        </span>
        <span style={{ color: "var(--muted)" }}>{isHome ? "vs" : "@"}</span>
        {opp?.logoUrl && (
          <TeamBadge
            teamId={opponentId}
            name={opp.name}
            initials={opp.abbrev}
            color={opp.color}
            logoUrl={opp.logoUrl}
            size="sm"
          />
        )}
        <span style={{ flex: 1, fontWeight: 600 }}>{opp?.name ?? opponentId}</span>
        <span style={{ fontFamily: "var(--font-barlow)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {isFinal ? `${myScore}–${oppScore}` : dateStr || status}
        </span>
      </Link>
    </li>
  );
}

function formatRecord(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}
function formatAvg(n: number): string {
  if (n === 1) return "1.000";
  return n.toFixed(3).replace(/^0/, "");
}

interface BattingAgg {
  gp: number;
  ab: number;
  h: number;
  r: number;
  hr: number;
  rbi: number;
  avg: number;
}
function aggregateRoster(statsList: Array<unknown>): BattingAgg {
  let gp = 0,
    ab = 0,
    h = 0,
    r = 0,
    hr = 0,
    rbi = 0;
  for (const s of statsList) {
    const v = (s ?? {}) as Record<string, number>;
    gp += Number(v.gp ?? 0);
    ab += Number(v.ab ?? 0);
    h += Number(v.h ?? 0);
    r += Number(v.r ?? 0);
    hr += Number(v.hr ?? 0);
    rbi += Number(v.rbi ?? 0);
  }
  return { gp, ab, h, r, hr, rbi, avg: ab > 0 ? h / ab : 0 };
}
interface PitchingAgg {
  app: number;
  ip_outs: number;
  er: number;
  era: number;
}
function aggregateRosterPitching(pitchingList: Array<unknown>): PitchingAgg {
  let app = 0,
    ip_outs = 0,
    er = 0;
  for (const p of pitchingList) {
    const v = (p ?? {}) as Record<string, number>;
    app += Number(v.app ?? 0);
    ip_outs += Number(v.ip_outs ?? 0);
    er += Number(v.er ?? 0);
  }
  const era = ip_outs > 0 ? (er * 27) / ip_outs : 0;
  return { app, ip_outs, er, era };
}
