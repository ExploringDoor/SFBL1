// Full /games/[id] page — used on direct navigation. The intercepted
// route at @modal/(.)games/[id] wraps the same content in a modal.

import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BoxScoreContent } from "@/components/BoxScoreContent";
import { RecapEditor } from "@/components/RecapEditor";
import { LiveScoreBanner } from "@/components/LiveScoreBanner";
import { GameShareSection } from "@/components/GameShareSection";
import { loadBoxScoreData } from "@/lib/box-score-data";
import { getStatsOffRecap } from "@/lib/stats-off-recap";
import { getAdminDb } from "@/lib/firebase-admin";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

// Per-game link preview. The most-shared URL pattern: someone wins
// in a walk-off, drops the link in the team chat. Preview should
// show the matchup + final score, not generic league copy.
export async function generateMetadata({
  params,
}: {
  params: { gameId: string };
}): Promise<Metadata> {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) return {};
  const db = getAdminDb();
  const gameSnap = await db
    .doc(`leagues/${tenantId}/games/${params.gameId}`)
    .get();
  if (!gameSnap.exists) return {};
  const data = gameSnap.data() ?? {};
  const [awaySnap, homeSnap] = await Promise.all([
    db
      .doc(`leagues/${tenantId}/teams/${data.away_team_id}`)
      .get(),
    db
      .doc(`leagues/${tenantId}/teams/${data.home_team_id}`)
      .get(),
  ]);
  const awayName = String(awaySnap.data()?.name ?? data.away_team_id ?? "Away");
  const homeName = String(homeSnap.data()?.name ?? data.home_team_id ?? "Home");
  const status = String(data.status ?? "scheduled");
  const isFinal = status === "final" || status === "approved";
  const aScore = Number(data.away_score);
  const hScore = Number(data.home_score);
  const dateRaw = String(data.date ?? "");
  const dateFmt = dateRaw
    ? new Date(dateRaw).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";
  const title =
    isFinal && Number.isFinite(aScore) && Number.isFinite(hScore)
      ? `${awayName} ${aScore} – ${hScore} ${homeName} (Final)`
      : `${awayName} @ ${homeName}${dateFmt ? ` — ${dateFmt}` : ""}`;
  const description =
    isFinal && Number.isFinite(aScore) && Number.isFinite(hScore)
      ? `Final score and box score for ${awayName} vs ${homeName}${dateFmt ? `, ${dateFmt}` : ""}.`
      : `${awayName} at ${homeName}${dateFmt ? ` on ${dateFmt}` : ""}${data.field ? `, ${data.field}` : ""}.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
    },
    twitter: { card: "summary", title, description },
  };
}

export default async function GameDetailPage({
  params,
  searchParams,
}: {
  params: { gameId: string };
  searchParams?: { tab?: string };
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

  const data = await loadBoxScoreData(
    tenantId,
    params.gameId,
    config?.linescore_innings ?? 9,
  );
  if (!data) notFound();

  const view = searchParams?.tab === "recap" ? "recap" : "box";
  const isFinal = data.status === "final" || data.status === "approved";
  // Stats-off leagues (COYBL) have no box score — final games show a
  // recap-only view with a short AI-generated (or template) recap.
  const recapOnly = config?.flags?.stats_enabled === false && isFinal;

  let recapMarkdown: string | null = null;
  let recapHtml: string | null = null;
  if (recapOnly) {
    const r = await getStatsOffRecap(tenantId, params.gameId, {
      awayName: data.away.name ?? data.away.team_id,
      homeName: data.home.name ?? data.home.team_id,
      awayScore: data.away.score,
      homeScore: data.home.score,
      date: data.date,
      leagueName: config?.name ?? null,
    });
    recapMarkdown = r.markdown;
    recapHtml = r.html;
  } else {
    // Recap override — admin / captain custom-written recap that
    // overrides the auto-generated one. Stored at /recaps/{gameId}.
    // Public-readable; fall back to auto-build when null.
    const recapSnap = await getAdminDb()
      .doc(`leagues/${tenantId}/recaps/${params.gameId}`)
      .get();
    recapMarkdown = recapSnap.exists
      ? (recapSnap.data()?.markdown as string | undefined) ?? null
      : null;
    recapHtml = recapSnap.exists
      ? (recapSnap.data()?.html as string | undefined) ?? null
      : null;
  }

  return (
    <main className="container py-12">
      <div className="mb-4 flex items-center justify-between no-print">
        <Link
          href="/scores"
          className="font-barlow"
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--muted)",
          }}
        >
          ← All scores
        </Link>
        <PrintButton />
      </div>
      {/* Live banner — only renders when game.status is "live" or
          "final" / "approved". Subscribes to the game doc so updates
          flow live during in-progress games. */}
      <LiveScoreBanner
        leagueId={tenantId}
        gameId={params.gameId}
        awayName={data.away.name ?? data.away.team_id}
        homeName={data.home.name ?? data.home.team_id}
        initialAwayScore={data.away.score}
        initialHomeScore={data.home.score}
        initialStatus={data.status}
      />
      <BoxScoreContent
        {...data}
        view={view}
        recapOnly={recapOnly}
        recapOverrideHtml={recapHtml}
        recapEditor={
          <RecapEditor
            leagueId={tenantId}
            gameId={params.gameId}
            homeTeamId={data.home.team_id}
            awayTeamId={data.away.team_id}
            initialMarkdown={recapMarkdown}
          />
        }
      />

      <GameShareSection data={data} config={config} />
    </main>
  );
}
