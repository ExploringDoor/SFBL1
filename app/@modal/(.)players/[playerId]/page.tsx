// Intercepted modal for /players/[id]. Renders the DVSL-style player
// profile (avatar + big name + stat pill + season tables) inside a
// modal when navigated via Link. Direct URL access falls through to
// the full page at app/players/[playerId]/page.tsx.
//
// All rendering is delegated to <PlayerProfile> in components/ui/ so
// the full page and the modal stay in sync.

import { headers } from "next/headers";
import { Modal } from "@/components/Modal";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  PlayerProfile,
  type PlayerSeasonBatting,
  type PlayerSeasonPitching,
} from "@/components/ui/PlayerProfile";

export const dynamic = "force-dynamic";

export default async function PlayerModalRoute({
  params,
}: {
  params: { playerId: string };
}) {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  if (!tenantId) return null;

  const db = getAdminDb();
  const playerSnap = await db
    .doc(`leagues/${tenantId}/players/${params.playerId}`)
    .get();
  if (!playerSnap.exists) return null;
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
  let photoUrl: string | null = null;
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
  if (data.photo_url) photoUrl = String(data.photo_url);

  const battingSeason: PlayerSeasonBatting | null =
    stats && Number(stats.gp ?? 0) > 0
      ? toBatting(stats)
      : null;
  const pitchingSeason: PlayerSeasonPitching | null =
    pitching && Number(pitching.app ?? 0) > 0
      ? toPitching(pitching)
      : null;

  return (
    <Modal title={name}>
      <PlayerProfile
        playerId={params.playerId}
        name={name}
        number={data.jersey != null ? String(data.jersey) : null}
        position={data.position ? String(data.position) : null}
        team={team}
        photoUrl={photoUrl}
        batting={battingSeason}
        pitching={pitchingSeason}
      />
    </Modal>
  );
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
