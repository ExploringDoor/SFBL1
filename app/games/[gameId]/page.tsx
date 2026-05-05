// Full /games/[id] page — used on direct navigation. The intercepted
// route at @modal/(.)games/[id] wraps the same content in a modal.

import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BoxScoreContent } from "@/components/BoxScoreContent";
import { RecapEditor } from "@/components/RecapEditor";
import { loadBoxScoreData } from "@/lib/box-score-data";
import { getAdminDb } from "@/lib/firebase-admin";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

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

  // Recap override — admin / captain custom-written recap that
  // overrides the auto-generated one. Stored at /recaps/{gameId}.
  // Public-readable; fall back to auto-build when null.
  const recapSnap = await getAdminDb()
    .doc(`leagues/${tenantId}/recaps/${params.gameId}`)
    .get();
  const recapMarkdown = recapSnap.exists
    ? (recapSnap.data()?.markdown as string | undefined) ?? null
    : null;
  const recapHtml = recapSnap.exists
    ? (recapSnap.data()?.html as string | undefined) ?? null
    : null;

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
      <BoxScoreContent
        {...data}
        view={view}
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
    </main>
  );
}
