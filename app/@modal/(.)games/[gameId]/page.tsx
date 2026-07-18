// Intercepted modal route for /games/[gameId]. Activated when the user
// navigates to a game via Link (e.g. clicking a GameCard) — Next renders
// this in the @modal slot instead of the full page. Direct URL access
// still hits the full page at app/games/[gameId]/page.tsx.

import { headers } from "next/headers";
import { Modal } from "@/components/Modal";
import { BoxScoreContent } from "@/components/BoxScoreContent";
import { loadBoxScoreData } from "@/lib/box-score-data";
import { getAdminDb } from "@/lib/firebase-admin";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

export default async function GameModalRoute({
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
  if (!tenantId) return null;

  const data = await loadBoxScoreData(
    tenantId,
    params.gameId,
    config?.linescore_innings ?? 9,
  );
  if (!data) return null;

  const view = searchParams?.tab === "recap" ? "recap" : "box";

  // Recap override — same fetch the full page does. MUST stay in sync:
  // most visitors reach a game by clicking from /scores, which Next
  // intercepts into THIS modal, so a manager-written recap that only the
  // full page knew about was effectively invisible (Adam, 2026-07).
  const recapSnap = await getAdminDb()
    .doc(`leagues/${tenantId}/recaps/${params.gameId}`)
    .get();
  const recapHtml = recapSnap.exists
    ? (recapSnap.data()?.html as string | undefined) ?? null
    : null;

  return (
    <Modal title={view === "recap" ? "Recap" : "Box Score"}>
      <BoxScoreContent {...data} view={view} recapOverrideHtml={recapHtml} />
    </Modal>
  );
}
