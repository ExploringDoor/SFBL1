// Shared loader for the box score view. Used by both the full
// /games/[id] page and the intercepted modal route. Consolidates
// Firestore reads and shapes into BoxScoreContent's prop type.

import { getAdminDb } from "./firebase-admin";
import type {
  BoxScoreContentProps,
  BoxTeam,
  BoxBatter,
  BoxPitcher,
} from "@/components/BoxScoreContent";

export async function loadBoxScoreData(
  tenantId: string,
  gameId: string,
  innings: number,
): Promise<BoxScoreContentProps | null> {
  const db = getAdminDb();
  const [gameSnap, boxSnap, teamsSnap, playersSnap] = await Promise.all([
    db.doc(`leagues/${tenantId}/games/${gameId}`).get(),
    db.doc(`leagues/${tenantId}/box_scores/${gameId}`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
    db.collection(`leagues/${tenantId}/players`).get(),
  ]);
  if (!gameSnap.exists) return null;

  const game = gameSnap.data() ?? {};
  const homeTeamId = String(game.home_team_id ?? "");
  const awayTeamId = String(game.away_team_id ?? "");

  const teamMeta: Record<string, { name: string; abbrev?: string; color?: string; logoUrl?: string | null }> = {};
  for (const d of teamsSnap.docs) {
    const data = d.data();
    teamMeta[d.id] = {
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      color: data.color ? String(data.color) : undefined,
      logoUrl: data.logo_url ? String(data.logo_url) : null,
    };
  }
  const playerNames: Record<string, string> = {};
  for (const d of playersSnap.docs) {
    playerNames[d.id] = String(d.data().name ?? d.id);
  }

  const box = boxSnap.exists ? (boxSnap.data() as Record<string, unknown>) : null;
  const linescore = (box?.linescore as { away?: number[]; home?: number[] } | undefined) ?? {};
  const hits = (box?.hits as { away?: number; home?: number } | undefined) ?? {};
  const errors = (box?.errors as { away?: number; home?: number } | undefined) ?? {};

  function buildTeam(side: "away" | "home", teamId: string, score: number): BoxTeam {
    const m = teamMeta[teamId] ?? { name: teamId };
    return {
      team_id: teamId,
      name: m.name,
      abbrev: m.abbrev,
      color: m.color,
      logoUrl: m.logoUrl,
      score,
      linescore: linescore[side],
      hits: hits[side],
      errors: errors[side],
      lineup: ((box?.[`${side}_lineup`] as BoxBatter[] | undefined) ?? []).filter(
        (b) => b.player_id,
      ),
      pitchers: ((box?.[`${side}_pitchers`] as BoxPitcher[] | undefined) ?? []).filter(
        (p) => p.player_id,
      ),
    };
  }

  return {
    gameId,
    date: game.date ? String(game.date) : null,
    field: game.field ? String(game.field) : null,
    status: String(game.status ?? "draft"),
    innings,
    away: buildTeam("away", awayTeamId, Number(game.away_score ?? 0)),
    home: buildTeam("home", homeTeamId, Number(game.home_score ?? 0)),
    playerNames,
  };
}
