// Intercepted modal for /players/[id]. Renders the LBDC-style player
// profile inside a Modal shell when navigated via Link. Direct URL
// access falls through to the full page at
// app/players/[playerId]/page.tsx.
//
// Both routes share `loadPlayerProfileData()` so the layout + numbers
// stay in sync.

import { headers } from "next/headers";
import { Modal } from "@/components/Modal";
import { getAdminDb } from "@/lib/firebase-admin";
import { loadPlayerProfileData } from "@/lib/player-profile-data";
import { PlayerProfileLBDC } from "@/components/ui/PlayerProfileLBDC";

export const dynamic = "force-dynamic";

export default async function PlayerModalRoute({
  params,
}: {
  params: { playerId: string };
}) {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) return null;

  const profile = await loadPlayerProfileData(
    getAdminDb(),
    tenantId,
    params.playerId,
  );
  if (!profile) return null;

  return (
    <Modal title={profile.name}>
      <PlayerProfileLBDC
        name={profile.name}
        team={profile.team}
        currentSeasonLabel={profile.currentSeasonLabel}
        currentBatting={profile.currentBatting}
        projectedBatting={profile.projectedBatting}
        careerBatting={profile.careerBatting}
        recentGames={profile.recentGames}
        pitchingBySeason={profile.pitchingBySeason}
        careerPitching={profile.careerPitching}
      />
    </Modal>
  );
}
