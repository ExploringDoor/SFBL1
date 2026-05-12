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

// Closes H9. The expensive part of loadBoxScoreData isn't the per-
// game doc — it's the three tenant-wide reads (teams, players, all
// games) needed only to render the season-record badges + look up
// player names in the box. Sharing a box-score link in iMessage
// fans out into many parallel page loads; each used to pull ~450
// docs from Firestore.
//
// Process-local TTL cache for the three tenant aggregates, keyed by
// tenant. Per-game game + box_score docs are always read fresh so
// score updates surface immediately. 30s TTL collapses bursts.
interface TenantBoxCacheEntry {
  teamMeta: Record<
    string,
    { name: string; abbrev?: string; color?: string; logoUrl?: string | null }
  >;
  recordByTeam: Map<string, string>;
  playerNames: Record<string, string>;
  expires_at: number;
}
const BOX_TENANT_TTL_MS = 30_000;
const boxTenantCache = new Map<string, TenantBoxCacheEntry>();

// Closes audit M4. The box doc is written by the captain via the
// Web SDK and Firestore rules don't validate per-field shape. The
// previous `as BoxBatter[]` cast trusted every numeric field on
// faith; a captain-side bug writing "5" instead of 5 would render
// verbatim ("5") in the public box score. Coerce each numeric
// field through Number() and drop rows missing player_id.
function num(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function coerceLineup(raw: unknown): BoxBatter[] {
  if (!Array.isArray(raw)) return [];
  const out: BoxBatter[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const obj = r as Record<string, unknown>;
    const player_id = typeof obj.player_id === "string" ? obj.player_id : "";
    if (!player_id) continue;
    out.push({
      player_id,
      ab: num(obj.ab),
      r: num(obj.r),
      h: num(obj.h),
      doubles: num(obj.doubles),
      triples: num(obj.triples),
      hr: num(obj.hr),
      rbi: num(obj.rbi),
      bb: num(obj.bb),
      so: num(obj.so),
      sb: num(obj.sb),
    });
  }
  return out;
}

function coercePitchers(raw: unknown): BoxPitcher[] {
  if (!Array.isArray(raw)) return [];
  const out: BoxPitcher[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const obj = r as Record<string, unknown>;
    const player_id = typeof obj.player_id === "string" ? obj.player_id : "";
    if (!player_id) continue;
    const decisionRaw =
      typeof obj.decision === "string" ? obj.decision : undefined;
    const decision: "W" | "L" | "S" | undefined =
      decisionRaw === "W" || decisionRaw === "L" || decisionRaw === "S"
        ? decisionRaw
        : undefined;
    out.push({
      player_id,
      ip_outs: num(obj.ip_outs),
      h: num(obj.h),
      r: num(obj.r),
      er: num(obj.er),
      bb: num(obj.bb),
      so: num(obj.so),
      hr: num(obj.hr),
      decision,
    });
  }
  return out;
}

async function loadTenantBoxAggregates(
  tenantId: string,
): Promise<TenantBoxCacheEntry> {
  const cached = boxTenantCache.get(tenantId);
  if (cached && Date.now() < cached.expires_at) {
    return cached;
  }
  const db = getAdminDb();
  const [teamsSnap, playersSnap, allGamesSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/teams`).get(),
    db.collection(`leagues/${tenantId}/players`).get(),
    db.collection(`leagues/${tenantId}/games`).get(),
  ]);
  const teamMeta: Record<
    string,
    { name: string; abbrev?: string; color?: string; logoUrl?: string | null }
  > = {};
  for (const d of teamsSnap.docs) {
    const data = d.data();
    teamMeta[d.id] = {
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      color: data.color ? String(data.color) : undefined,
      logoUrl: data.logo_url ? String(data.logo_url) : null,
    };
  }
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
  const entry: TenantBoxCacheEntry = {
    teamMeta,
    recordByTeam,
    playerNames,
    expires_at: Date.now() + BOX_TENANT_TTL_MS,
  };
  boxTenantCache.set(tenantId, entry);
  return entry;
}

export async function loadBoxScoreData(
  tenantId: string,
  gameId: string,
  innings: number,
): Promise<BoxScoreContentProps | null> {
  const db = getAdminDb();
  // Per-game reads (always fresh) in parallel with the cached
  // tenant aggregates. On a cache hit, only the two doc reads cost
  // Firestore — down from ~450 doc reads per page-load.
  const [gameSnap, boxSnap, tenantAgg] = await Promise.all([
    db.doc(`leagues/${tenantId}/games/${gameId}`).get(),
    db.doc(`leagues/${tenantId}/box_scores/${gameId}`).get(),
    loadTenantBoxAggregates(tenantId),
  ]);
  if (!gameSnap.exists) return null;

  const game = gameSnap.data() ?? {};
  const homeTeamId = String(game.home_team_id ?? "");
  const awayTeamId = String(game.away_team_id ?? "");
  const { teamMeta, recordByTeam, playerNames } = tenantAgg;

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
      lineup: coerceLineup(box?.[`${side}_lineup`]),
      pitchers: coercePitchers(box?.[`${side}_pitchers`]),
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
