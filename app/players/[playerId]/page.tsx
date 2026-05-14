// Player detail (full page route). Both this route and the
// intercepted modal at @modal/(.)players/[playerId] delegate to
// `loadPlayerProfileData()` so the visual + numbers stay in sync.
//
// The body renders the LBDC-style profile: "{Year} Batting" table
// with Regular Season / Projected / Career rows, Recent Games game
// log, Career Pitching per-season + total. Matches the layout LBDC's
// existing site uses (Adam's screenshot 2026-05-13).

import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminDb } from "@/lib/firebase-admin";
import { loadPlayerProfileData } from "@/lib/player-profile-data";
import { PlayerProfileLBDC } from "@/components/ui/PlayerProfileLBDC";
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
    const ts = await db.doc(`leagues/${tenantId}/teams/${teamId}`).get();
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

export default async function PlayerDetailPage({
  params,
}: {
  params: { playerId: string };
}) {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

  const profile = await loadPlayerProfileData(
    getAdminDb(),
    tenantId,
    params.playerId,
  );
  if (!profile) notFound();

  return (
    <main className="container py-10">
      <div className="mb-4 flex items-center justify-between">
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
        {profile.team?.team_id && (
          <AvatarUpload
            leagueId={tenantId}
            playerId={params.playerId}
            teamId={profile.team.team_id}
            initialPhotoUrl={profile.photoUrl}
          />
        )}
      </div>

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

      {profile.appearanceCount === 0 && profile.team && (
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
            href={`/teams/${profile.team.team_id}`}
            style={{
              color: "var(--brand-primary)",
              textDecoration: "underline",
            }}
          >
            {profile.team.name}
          </Link>{" "}
          starts playing games.
        </div>
      )}
    </main>
  );
}
