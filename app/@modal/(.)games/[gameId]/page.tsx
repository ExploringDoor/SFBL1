// Intercepted modal route for /games/[gameId]. Activated when the user
// navigates to a game via Link (e.g. clicking a GameCard) — Next renders
// this in the @modal slot instead of the full page. Direct URL access
// still hits the full page at app/games/[gameId]/page.tsx.

import { headers } from "next/headers";
import { Modal } from "@/components/Modal";
import { BoxScoreContent } from "@/components/BoxScoreContent";
import { GameShareSection } from "@/components/GameShareSection";
import { loadBoxScoreData } from "@/lib/box-score-data";
import { getStatsOffRecap } from "@/lib/stats-off-recap";
import { formatGameDate } from "@/lib/format-time";
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
  const isFinal = data.status === "final" || data.status === "approved";
  // Stats-off leagues (COYBL): recap-only — no box score. Resolve the
  // short recap (AI-generated + cached, or template fallback).
  const recapOnly = config?.flags?.stats_enabled === false && isFinal;
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
    recapHtml = r.html;
  }

  // COYBL (recap-only) gets the LMLL-style colored header band: division +
  // date on top, a FINAL pill below, close button inside. Other tenants keep
  // the plain modal (no band passed).
  const dateLabel = data.date
    ? formatGameDate(data.date, data.time, {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null;
  const bandContext =
    [data.ageGroup, data.division].filter(Boolean).join(" · ") +
    (dateLabel ? `${data.ageGroup || data.division ? " · " : ""}${dateLabel}` : "");
  const band = recapOnly ? (
    <>
      <div className="le-modal-band-eyebrow">{bandContext || "Final"}</div>
      {isFinal && <span className="le-modal-band-final">FINAL</span>}
    </>
  ) : undefined;

  return (
    <Modal
      title={recapOnly || view === "recap" ? "Recap" : "Box Score"}
      band={band}
    >
      <BoxScoreContent
        {...data}
        view={view}
        recapOnly={recapOnly}
        recapOverrideHtml={recapHtml}
      />
      <GameShareSection data={data} config={config} />
    </Modal>
  );
}
