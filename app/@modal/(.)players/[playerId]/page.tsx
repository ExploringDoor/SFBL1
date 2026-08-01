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
import { statsEnabled } from "@/lib/tenant-flags";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { PlayerProfileLBDC } from "@/components/ui/PlayerProfileLBDC";

export const dynamic = "force-dynamic";

export default async function PlayerModalRoute({
  params,
}: {
  params: { playerId: string };
}) {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  if (!tenantId) return null;

  // Match the full page's gate (app/players/[playerId]/page.tsx). Stats-off
  // youth tenants have no player stats to show, and rendering this anyway
  // would scan every box score in the league to build an empty profile.
  const config = (() => {
    const raw = h.get("x-tenant-config-json");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicLeagueConfig;
    } catch {
      return null;
    }
  })();
  if (!statsEnabled(config)) return null;

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
        showClose
      />
    </Modal>
  );
}
