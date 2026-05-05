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
import { computeStandings, type GameResult } from "./stats/shared";

export async function loadBoxScoreData(
  tenantId: string,
  gameId: string,
  innings: number,
): Promise<BoxScoreContentProps | null> {
  const db = getAdminDb();
  const [gameSnap, boxSnap, teamsSnap, playersSnap, allGamesSnap] =
    await Promise.all([
      db.doc(`leagues/${tenantId}/games/${gameId}`).get(),
      db.doc(`leagues/${tenantId}/box_scores/${gameId}`).get(),
      db.collection(`leagues/${tenantId}/teams`).get(),
      db.collection(`leagues/${tenantId}/players`).get(),
      // Pull every game for this tenant so we can compute season
      // records to label the box-score header (e.g. "WPBC (3-0)").
      db.collection(`leagues/${tenantId}/games`).get(),
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

  // Records by team — bare "W-L" / "W-L-T", UI components add parens.
  const standingsGames: GameResult[] = allGamesSnap.docs.map((d) => {
    const data = d.data();
    return {
      home_team_id: String(data.home_team_id ?? ""),
      away_team_id: String(data.away_team_id ?? ""),
      home_score: Number(data.home_score ?? 0),
      away_score: Number(data.away_score ?? 0),
      status: (data.status ?? "draft") as GameResult["status"],
      date: data.date ? String(data.date) : undefined,
    };
  });
  const standings = computeStandings(standingsGames);
  const recordByTeam = new Map(
    standings.map((r) => [
      r.team_id,
      r.t > 0 ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`,
    ]),
  );
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
    const scoreOnly = box?.[`${side}_score_only`] === true;
    return {
      team_id: teamId,
      name: m.name,
      abbrev: m.abbrev,
      color: m.color,
      logoUrl: m.logoUrl,
      score,
      record: recordByTeam.get(teamId),
      linescore: linescore[side],
      hits: hits[side],
      errors: errors[side],
      lineup: ((box?.[`${side}_lineup`] as BoxBatter[] | undefined) ?? []).filter(
        (b) => b.player_id,
      ),
      pitchers: ((box?.[`${side}_pitchers`] as BoxPitcher[] | undefined) ?? []).filter(
        (p) => p.player_id,
      ),
      score_only: scoreOnly,
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
