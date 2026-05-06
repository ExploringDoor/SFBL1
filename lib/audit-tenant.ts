// Tenant data-integrity audit. Walks a single tenant's Firestore
// data and returns a list of issues — orphan refs, score mismatches,
// duplicate slugs, etc.
//
// DVSL §6 from the peer-review notes: DVSL has a 13-dimension audit
// in `scripts/audit-game-data.py` that's been catching real bugs
// for months. We port the 6 most useful dimensions here. Run:
//   npm run audit:tenant -- --league sfbl
// before flipping a tenant on for the first time, and weekly in-
// season as a "did anything drift?" sanity check.
//
// The 6 dimensions covered (see DVSL spec for the full 13):
//   1. game/box_score score parity (final games)
//   2. schedule fields populated on every scheduled+ game
//   3. orphan player refs in box-score lineups
//   4. /players → /teams ref integrity (every player on a real team)
//   5. duplicate cleanName collisions (NBSP-split players)
//   6. orphan box_score_submissions for non-existent games
//
// Pure function — no env vars, no SDK init. The script wrapper
// (scripts/audit-tenant.ts) handles those.

import { cleanName } from "./text";

// Loose Firestore Admin SDK shape — narrow enough for the helpers
// here, broad enough to mock for tests.
export interface AuditDb {
  collection(path: string): {
    get(): Promise<{
      docs: Array<{
        id: string;
        data(): Record<string, unknown>;
      }>;
    }>;
  };
  doc(path: string): {
    get(): Promise<{
      exists: boolean;
      data(): Record<string, unknown> | undefined;
    }>;
  };
}

export interface AuditIssue {
  /** Which check found this. */
  dimension: string;
  /** Severity: error means data is broken; warning is "looks weird, verify". */
  level: "error" | "warning";
  /** Path-ish reference for the offending doc(s). */
  ref: string;
  message: string;
}

export interface AuditResult {
  leagueId: string;
  issues: AuditIssue[];
  /** Per-dimension counts for a one-line summary. */
  counts: Record<string, number>;
  /** How many docs we checked across all dimensions. */
  checked: {
    teams: number;
    players: number;
    games: number;
    box_scores: number;
    box_score_submissions: number;
  };
}

export async function auditTenant(
  db: AuditDb,
  leagueId: string,
): Promise<AuditResult> {
  const [teams, players, games, boxScores, submissions] = await Promise.all([
    db.collection(`leagues/${leagueId}/teams`).get(),
    db.collection(`leagues/${leagueId}/players`).get(),
    db.collection(`leagues/${leagueId}/games`).get(),
    db.collection(`leagues/${leagueId}/box_scores`).get(),
    db.collection(`leagues/${leagueId}/box_score_submissions`).get(),
  ]);

  const teamIds = new Set(teams.docs.map((d) => d.id));
  const playerIds = new Set(players.docs.map((d) => d.id));
  const gameIds = new Set(games.docs.map((d) => d.id));

  const issues: AuditIssue[] = [];

  // ── Dimension 1: game/box_score score parity (finals only) ──────
  // The captain-submit route writes both /games/{id}.{side}_score and
  // /box_scores/{id}.{side}_score in the same transaction. If they
  // ever diverge, something wrote one without the other (manual
  // Firestore Console edit is the usual culprit). Catch silent drift.
  const boxScoreById = new Map<string, Record<string, unknown>>(
    boxScores.docs.map((d) => [d.id, d.data() ?? {}]),
  );
  for (const g of games.docs) {
    const data = g.data() ?? {};
    if (data.status !== "final" && data.status !== "approved") continue;
    const bs = boxScoreById.get(g.id);
    if (!bs) {
      issues.push({
        dimension: "score_parity",
        level: "error",
        ref: `games/${g.id}`,
        message:
          "game is final but has no /box_scores doc — public box-score page will 404",
      });
      continue;
    }
    for (const side of ["away", "home"] as const) {
      const gameScore = data[`${side}_score`];
      const bsScore = bs[`${side}_score`];
      if (
        typeof gameScore === "number" &&
        typeof bsScore === "number" &&
        gameScore !== bsScore
      ) {
        issues.push({
          dimension: "score_parity",
          level: "error",
          ref: `games/${g.id}`,
          message: `${side}_score diverges between /games (${gameScore}) and /box_scores (${bsScore})`,
        });
      }
    }
  }

  // ── Dimension 2: schedule fields populated ───────────────────────
  // Every game (regardless of status) should have a date and both
  // team ids. Missing date = won't appear on /schedule. Missing
  // team_id = blank cells in standings calc.
  for (const g of games.docs) {
    const data = g.data() ?? {};
    if (!data.date) {
      issues.push({
        dimension: "schedule_fields",
        level: "warning",
        ref: `games/${g.id}`,
        message: "missing `date` — game won't appear on /schedule",
      });
    }
    if (!data.away_team_id) {
      issues.push({
        dimension: "schedule_fields",
        level: "error",
        ref: `games/${g.id}`,
        message: "missing `away_team_id`",
      });
    }
    if (!data.home_team_id) {
      issues.push({
        dimension: "schedule_fields",
        level: "error",
        ref: `games/${g.id}`,
        message: "missing `home_team_id`",
      });
    }
    if (data.away_team_id === data.home_team_id && data.away_team_id) {
      issues.push({
        dimension: "schedule_fields",
        level: "error",
        ref: `games/${g.id}`,
        message: `team ${data.away_team_id} is listed as both home and away`,
      });
    }
    // Cross-ref: team_ids exist as actual teams.
    for (const side of ["away", "home"] as const) {
      const tid = data[`${side}_team_id`];
      if (tid && typeof tid === "string" && !teamIds.has(tid)) {
        issues.push({
          dimension: "schedule_fields",
          level: "error",
          ref: `games/${g.id}`,
          message: `${side}_team_id "${tid}" is not in /teams`,
        });
      }
    }
  }

  // ── Dimension 3: orphan player refs in box-score lineups ─────────
  // Captains can submit a lineup with a typo'd player_id (rare, but
  // a manual edit can introduce it). Catch lineup entries pointing
  // to a non-existent player.
  function checkLineupArray(
    arr: unknown,
    label: string,
    bsId: string,
  ): void {
    if (!Array.isArray(arr)) return;
    for (const entry of arr) {
      if (typeof entry !== "object" || entry == null) continue;
      const pid = (entry as Record<string, unknown>).player_id;
      if (typeof pid !== "string" || !pid) continue;
      if (!playerIds.has(pid)) {
        issues.push({
          dimension: "orphan_player_ref",
          level: "error",
          ref: `box_scores/${bsId}`,
          message: `${label} references player "${pid}" which is not in /players`,
        });
      }
    }
  }
  for (const bs of boxScores.docs) {
    const data = bs.data() ?? {};
    for (const side of ["away", "home"] as const) {
      checkLineupArray(data[`${side}_lineup`], `${side}_lineup`, bs.id);
      checkLineupArray(data[`${side}_pitchers`], `${side}_pitchers`, bs.id);
    }
  }

  // ── Dimension 4: /players → /teams ref integrity ──────────────────
  // Every player.team_id must point to a real team. Catches CSV typos
  // and orphan players from deleted teams.
  for (const p of players.docs) {
    const data = p.data() ?? {};
    const teamId = data.team_id;
    if (!teamId || typeof teamId !== "string") {
      issues.push({
        dimension: "player_team_ref",
        level: "error",
        ref: `players/${p.id}`,
        message: "missing or non-string team_id",
      });
      continue;
    }
    if (!teamIds.has(teamId)) {
      issues.push({
        dimension: "player_team_ref",
        level: "error",
        ref: `players/${p.id}`,
        message: `team_id "${teamId}" is not in /teams (orphan player)`,
      });
    }
  }

  // ── Dimension 5: duplicate cleanName collisions ─────────────────
  // Two players with the same NORMALIZED name on the same team are
  // a strong signal that NBSP-split or other Unicode-whitespace
  // weirdness slipped through — DVSL caught 70+ of these in a real
  // audit. With the cleanName fix landed, NEW imports are safe; this
  // catches legacy data that pre-dates it.
  const byTeamPlusName = new Map<string, string[]>();
  for (const p of players.docs) {
    const data = p.data() ?? {};
    const teamId =
      typeof data.team_id === "string" ? data.team_id : "_unknown";
    const cleaned = cleanName(data.name);
    if (!cleaned) continue;
    const key = `${teamId}::${cleaned.toLowerCase()}`;
    if (!byTeamPlusName.has(key)) byTeamPlusName.set(key, []);
    byTeamPlusName.get(key)!.push(p.id);
  }
  for (const [key, ids] of byTeamPlusName) {
    if (ids.length > 1) {
      issues.push({
        dimension: "duplicate_player_name",
        level: "warning",
        ref: `players/[${ids.join(",")}]`,
        message: `${ids.length} players share the cleaned name on team "${key.split("::")[0]}". Possible NBSP-split duplicates from a pre-cleanName import.`,
      });
    }
  }

  // ── Dimension 6: orphan box_score_submissions for missing games ──
  for (const sub of submissions.docs) {
    // Doc id is `${gameId}_${teamId}` — DVSL convention. Try to extract
    // the game id by looking up the team_id field on the submission
    // doc and stripping the suffix.
    const data = sub.data() ?? {};
    const subGameId = data.game_id;
    if (typeof subGameId === "string" && subGameId && !gameIds.has(subGameId)) {
      issues.push({
        dimension: "orphan_submission",
        level: "warning",
        ref: `box_score_submissions/${sub.id}`,
        message: `submission references game_id "${subGameId}" which is not in /games`,
      });
    }
  }

  // Counts per dimension for a quick summary.
  const counts: Record<string, number> = {};
  for (const i of issues) {
    counts[i.dimension] = (counts[i.dimension] ?? 0) + 1;
  }

  return {
    leagueId,
    issues,
    counts,
    checked: {
      teams: teams.docs.length,
      players: players.docs.length,
      games: games.docs.length,
      box_scores: boxScores.docs.length,
      box_score_submissions: submissions.docs.length,
    },
  };
}

/** Format an audit result as human-readable text for stdout. */
export function formatAuditReport(r: AuditResult): string {
  const lines: string[] = [];
  lines.push(`# Tenant Audit — ${r.leagueId}`);
  lines.push("");
  lines.push(
    `Checked: ${r.checked.teams} teams · ${r.checked.players} players · ${r.checked.games} games · ${r.checked.box_scores} box scores · ${r.checked.box_score_submissions} submissions`,
  );
  lines.push("");
  if (r.issues.length === 0) {
    lines.push("✅ No issues found.");
    return lines.join("\n");
  }
  lines.push(
    `⚠️  ${r.issues.length} issue${r.issues.length === 1 ? "" : "s"} across ${Object.keys(r.counts).length} dimension${Object.keys(r.counts).length === 1 ? "" : "s"}:`,
  );
  for (const [dim, n] of Object.entries(r.counts)) {
    lines.push(`   - ${dim}: ${n}`);
  }
  lines.push("");
  lines.push("Details:");
  for (const issue of r.issues) {
    const tag = issue.level === "error" ? "❌" : "⚠️ ";
    lines.push(`${tag} [${issue.dimension}] ${issue.ref}`);
    lines.push(`     ${issue.message}`);
  }
  return lines.join("\n");
}
