// Full-page player detail. Direct URL hits this route; clicking a
// player from inside the app shows the same content inside a modal
// via the intercepted route at app/@modal/(.)players/[playerId].
//
// Both routes delegate rendering to <PlayerProfile> so the visual
// stays in sync.

import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  PlayerProfile,
  type PlayerSeasonBatting,
  type PlayerSeasonPitching,
} from "@/components/ui/PlayerProfile";
import { AvatarUpload } from "@/components/ui/AvatarUpload";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { playerId: string };
}): Promise<Metadata> {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) return {};
  const db = getAdminDb();
  const snap = await db
    .doc(`leagues/${tenantId}/players/${params.playerId}`)
    .get();
  if (!snap.exists) return {};
  const data = snap.data() ?? {};
  const name = String(data.name ?? params.playerId);
  const teamId = String(data.team_id ?? "");
  let teamName = teamId;
  if (teamId) {
    const ts = await db
      .doc(`leagues/${tenantId}/teams/${teamId}`)
      .get();
    teamName = String(ts.data()?.name ?? teamId);
  }
  const jersey = data.jersey != null ? `#${data.jersey} ` : "";
  const description = `${jersey}${name} — ${teamName}. Batting / pitching stats and game log.`;
  return {
    title: `${jersey}${name}`.trim(),
    description,
    openGraph: {
      title: `${jersey}${name}`.trim(),
      description,
      type: "profile",
    },
    twitter: {
      card: "summary",
      title: `${jersey}${name}`.trim(),
      description,
    },
  };
}

interface GameLogRow {
  gameId: string;
  date: string;
  opponentName: string;
  isHome: boolean;
  myScore: number;
  oppScore: number;
  result: "W" | "L" | "T";
  // Batting line for this player in this game (null if didn't bat)
  batting: {
    ab: number;
    r: number;
    h: number;
    rbi: number;
    bb: number;
    so: number;
    hr: number;
  } | null;
  // Pitching line (null if didn't pitch)
  pitching: {
    ip_outs: number;
    er: number;
    so: number;
    bb: number;
    h: number;
  } | null;
}

export default async function PlayerDetailPage({
  params,
}: {
  params: { playerId: string };
}) {
  const h = headers();
  const tenantId = h.get("x-tenant-id");

  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
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
  const stats = (data.stats ?? null) as Record<string, number> | null;
  const pitching = (data.pitching ?? null) as Record<string, number> | null;

  let team: {
    team_id: string;
    name: string;
    abbrev?: string;
    color?: string;
    logoUrl?: string | null;
  } | null = null;
  if (teamId) {
    const teamSnap = await db.doc(`leagues/${tenantId}/teams/${teamId}`).get();
    if (teamSnap.exists) {
      const t = teamSnap.data() ?? {};
      team = {
        team_id: teamId,
        name: String(t.name ?? teamId),
        abbrev: t.abbrev ? String(t.abbrev) : undefined,
        color: t.color ? String(t.color) : undefined,
        logoUrl: t.logo_url ? String(t.logo_url) : null,
      };
    }
  }

  const battingSeason: PlayerSeasonBatting | null =
    stats && Number(stats.gp ?? 0) > 0 ? toBatting(stats) : null;
  const pitchingSeason: PlayerSeasonPitching | null =
    pitching && Number(pitching.app ?? 0) > 0 ? toPitching(pitching) : null;

  // Recent game log — pull this player's last 5 batting / pitching
  // lines from the box scores. Skipped (silent) if no team or no
  // final games yet. Cheap (~5 doc reads worst case).
  const gameLog: GameLogRow[] = teamId
    ? await loadGameLog(tenantId, teamId, params.playerId)
    : [];

  return (
    <main className="container py-10">
      <div className="mb-4">
        <Link
          href="/players"
          className="font-barlow"
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--muted)",
          }}
        >
          ← All players
        </Link>
      </div>
      <PlayerProfile
        playerId={params.playerId}
        name={name}
        number={data.jersey != null ? String(data.jersey) : null}
        position={data.position ? String(data.position) : null}
        team={team}
        photoUrl={data.photo_url ? String(data.photo_url) : null}
        batting={battingSeason}
        pitching={pitchingSeason}
        avatarOverlay={
          tenantId && team?.team_id ? (
            <AvatarUpload
              leagueId={tenantId}
              playerId={params.playerId}
              teamId={team.team_id}
              initialPhotoUrl={
                data.photo_url ? String(data.photo_url) : null
              }
            />
          ) : null
        }
      />

      {gameLog.length > 0 && <GameLog rows={gameLog} />}

      {/* Pre-launch state: no team / no game log / no stats — show
          a friendly placeholder so the page doesn't end with the
          "no batting data this season" blob. */}
      {!battingSeason && !pitchingSeason && gameLog.length === 0 && team && (
        <div
          style={{
            marginTop: 24,
            padding: "20px 16px",
            background: "rgba(0,0,0,0.03)",
            border: "1px dashed rgba(0,0,0,0.12)",
            borderRadius: 12,
            textAlign: "center",
            color: "var(--muted)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          Stats and game log will appear here once{" "}
          <Link
            href={`/teams/${team.team_id}`}
            style={{ color: "var(--brand-primary)", textDecoration: "underline" }}
          >
            {team.name}
          </Link>{" "}
          starts playing games.
        </div>
      )}
    </main>
  );
}

// ── Game log loader ────────────────────────────────────────────────
async function loadGameLog(
  tenantId: string,
  teamId: string,
  playerId: string,
): Promise<GameLogRow[]> {
  const db = getAdminDb();
  const gamesSnap = await db
    .collection(`leagues/${tenantId}/games`)
    .where("status", "in", ["final", "approved"])
    .get()
    .catch(() => null);
  if (!gamesSnap) return [];

  // Filter to games involving this team, sort newest-first, take 5.
  // Doing the .where("status","in",...) above is a small-set query;
  // can't combine with a team_id where (Firestore composite index
  // limit), so we filter team membership in memory.
  const teamGames = gamesSnap.docs
    .filter((d) => {
      const data = d.data();
      return (
        String(data.home_team_id ?? "") === teamId ||
        String(data.away_team_id ?? "") === teamId
      );
    })
    .sort((a, b) =>
      String(b.data().date ?? "").localeCompare(String(a.data().date ?? "")),
    )
    .slice(0, 5);

  if (teamGames.length === 0) return [];

  // Read all team's recent box-score docs + opponent team names in
  // parallel.
  const opponentIds = new Set<string>();
  for (const g of teamGames) {
    const data = g.data();
    const home = String(data.home_team_id ?? "");
    const away = String(data.away_team_id ?? "");
    opponentIds.add(home === teamId ? away : home);
  }
  const [boxScoreSnaps, opponentSnaps] = await Promise.all([
    Promise.all(
      teamGames.map((g) =>
        db.doc(`leagues/${tenantId}/box_scores/${g.id}`).get(),
      ),
    ),
    Promise.all(
      [...opponentIds].map(async (oid) => {
        const snap = await db
          .doc(`leagues/${tenantId}/teams/${oid}`)
          .get();
        return [oid, snap.data() ?? {}] as const;
      }),
    ),
  ]);

  const opponentNames: Record<string, string> = {};
  for (const [oid, data] of opponentSnaps) {
    opponentNames[oid] = String(data.name ?? oid);
  }

  const rows: GameLogRow[] = [];
  for (let i = 0; i < teamGames.length; i++) {
    const gameDoc = teamGames[i]!;
    const game = gameDoc.data();
    const boxSnap = boxScoreSnaps[i]!;
    const box = boxSnap.exists
      ? (boxSnap.data() as Record<string, unknown>)
      : null;

    const isHome = String(game.home_team_id ?? "") === teamId;
    const myScore = Number(
      isHome ? game.home_score ?? 0 : game.away_score ?? 0,
    );
    const oppScore = Number(
      isHome ? game.away_score ?? 0 : game.home_score ?? 0,
    );
    const result: "W" | "L" | "T" =
      myScore > oppScore ? "W" : myScore < oppScore ? "L" : "T";

    const oppId = isHome
      ? String(game.away_team_id ?? "")
      : String(game.home_team_id ?? "");

    // Find this player's batting line in the right side of the box.
    const lineupKey = isHome ? "home_lineup" : "away_lineup";
    const pitchersKey = isHome ? "home_pitchers" : "away_pitchers";
    const lineup = (box?.[lineupKey] as Array<Record<string, unknown>>) ?? [];
    const pitchers =
      (box?.[pitchersKey] as Array<Record<string, unknown>>) ?? [];

    const battingRow = lineup.find(
      (r) => String(r.player_id ?? "") === playerId,
    );
    const pitchingRow = pitchers.find(
      (r) => String(r.player_id ?? "") === playerId,
    );

    rows.push({
      gameId: gameDoc.id,
      date: String(game.date ?? ""),
      opponentName: opponentNames[oppId] ?? oppId,
      isHome,
      myScore,
      oppScore,
      result,
      batting: battingRow
        ? {
            ab: Number(battingRow.ab ?? 0),
            r: Number(battingRow.r ?? 0),
            h: Number(battingRow.h ?? 0),
            rbi: Number(battingRow.rbi ?? 0),
            bb: Number(battingRow.bb ?? 0),
            so: Number(battingRow.so ?? battingRow.k ?? 0),
            hr: Number(battingRow.hr ?? 0),
          }
        : null,
      pitching: pitchingRow
        ? {
            ip_outs: Number(pitchingRow.ip_outs ?? 0),
            er: Number(pitchingRow.er ?? 0),
            so: Number(pitchingRow.so ?? pitchingRow.k ?? 0),
            bb: Number(pitchingRow.bb ?? 0),
            h: Number(pitchingRow.h ?? 0),
          }
        : null,
    });
  }
  return rows;
}

function GameLog({ rows }: { rows: GameLogRow[] }) {
  return (
    <section className="le-player-game-log">
      <div className="le-player-section-label" style={{ marginTop: 24 }}>
        Recent Games
      </div>
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <table className="bat-tbl">
          <thead>
            <tr>
              <th className="text-left">Date</th>
              <th className="text-left">Opponent</th>
              <th className="text-left">Result</th>
              <th>AB</th>
              <th>R</th>
              <th>H</th>
              <th>HR</th>
              <th>RBI</th>
              <th>BB</th>
              <th>K</th>
              <th>IP</th>
              <th>ER</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.gameId}>
                <td className="text-left">
                  <Link
                    href={`/games/${row.gameId}`}
                    style={{ fontFamily: "var(--font-barlow)", fontWeight: 600 }}
                  >
                    {row.date
                      ? new Date(row.date).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      : "—"}
                  </Link>
                </td>
                <td className="text-left">
                  <span style={{ color: "var(--muted)", marginRight: 4 }}>
                    {row.isHome ? "vs" : "@"}
                  </span>
                  {row.opponentName}
                </td>
                <td className="text-left">
                  <span
                    style={{
                      fontFamily: "var(--font-barlow)",
                      fontWeight: 800,
                      color:
                        row.result === "W"
                          ? "var(--green)"
                          : row.result === "L"
                            ? "var(--red)"
                            : "var(--muted)",
                      marginRight: 6,
                    }}
                  >
                    {row.result}
                  </span>
                  <span
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      fontSize: 13,
                    }}
                  >
                    {row.myScore}–{row.oppScore}
                  </span>
                </td>
                <td>{row.batting ? row.batting.ab : "—"}</td>
                <td>{row.batting ? row.batting.r : "—"}</td>
                <td>{row.batting ? row.batting.h : "—"}</td>
                <td>{row.batting ? row.batting.hr : "—"}</td>
                <td>{row.batting ? row.batting.rbi : "—"}</td>
                <td>{row.batting ? row.batting.bb : "—"}</td>
                <td>{row.batting ? row.batting.so : "—"}</td>
                <td>{row.pitching ? formatIpFromOuts(row.pitching.ip_outs) : "—"}</td>
                <td>{row.pitching ? row.pitching.er : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatIpFromOuts(outs: number): string {
  if (!Number.isFinite(outs) || outs <= 0) return "—";
  const innings = Math.floor(outs / 3);
  const partial = outs % 3;
  return `${innings}.${partial}`;
}

function toBatting(s: Record<string, number>): PlayerSeasonBatting {
  return {
    ab: Number(s.ab ?? 0),
    r: Number(s.r ?? 0),
    h: Number(s.h ?? 0),
    doubles: Number(s.doubles ?? 0),
    triples: Number(s.triples ?? 0),
    hr: Number(s.hr ?? 0),
    rbi: Number(s.rbi ?? 0),
    bb: Number(s.bb ?? 0),
    so: Number(s.so ?? 0),
    sb: Number(s.sb ?? 0),
    avg: formatAvg(Number(s.avg ?? 0)),
    obp: formatAvg(Number(s.obp ?? 0)),
    slg: formatAvg(Number(s.slg ?? 0)),
    ops: formatAvg(Number(s.ops ?? 0)),
  };
}

function toPitching(p: Record<string, number>): PlayerSeasonPitching {
  return {
    ip_outs: Number(p.ip_outs ?? 0),
    h: Number(p.h ?? 0),
    r: Number(p.r ?? 0),
    er: Number(p.er ?? 0),
    bb: Number(p.bb ?? 0),
    so: Number(p.so ?? 0),
    hr: Number(p.hr ?? 0),
    era: Number(p.era ?? 0).toFixed(2),
    whip: Number(p.whip ?? 0).toFixed(2),
    w: Number(p.w ?? 0),
    l: Number(p.l ?? 0),
    s: Number(p.sv ?? 0),
  };
}

function formatAvg(n: number): string {
  if (n === 1) return "1.000";
  return n.toFixed(3).replace(/^0/, "");
}
