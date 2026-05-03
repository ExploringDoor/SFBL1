// Intercepted modal route for /games/[gameId]. Activated when the user
// navigates to a game via Link (e.g. clicking a GameCard) — Next renders
// this in the @modal slot instead of the full page. Direct URL access
// still hits the full page at app/games/[gameId]/page.tsx.

import { headers } from "next/headers";
import { Modal } from "@/components/Modal";
import { BoxScoreContent } from "@/components/BoxScoreContent";
import { loadBoxScoreData } from "@/lib/box-score-data";
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

  return (
    <Modal title={view === "recap" ? "Recap" : "Box Score"}>
      <BoxScoreContent {...data} view={view} />
    </Modal>
  );
}
