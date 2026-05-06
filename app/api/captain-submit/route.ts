// POST /api/captain-submit — captain marks their box-score submission
// final, server promotes it into the public /box_scores doc and runs
// stats recalc.
//
// Why this lives on the server:
//   1. The captain's own lane (box_score_submissions/{game}_{team}) is
//      already written from the browser via the Web SDK before this
//      call — that's allowed by rules.
//   2. /box_scores/{game} is admin/captain-writable per
//      firestore.rules:117-122. We use Admin SDK here for convenience
//      so we can also read BOTH lanes (cross-captain reads are
//      blocked for clients but admin can do it).
//   3. recalcLeague writes to /players/* aggregates, which clients
//      can't write. Admin SDK only.
//
// Auth: bearer token, verifiable via Admin Auth, must have a
// `captain:<team_id>` claim for the requested league. The endpoint
// also accepts admin tokens (for cases where an admin is fixing a
// submission on a captain's behalf).

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { recalcLeague } from "@/lib/stats";
import {
  fanoutPush,
  originFromRequest,
} from "@/lib/notifications/server-fanout";

export const runtime = "nodejs";

interface SubmissionDoc {
  game_id: string;
  team_id: string;
  side: "home" | "away";
  lineup?: unknown[];
  pitchers?: unknown[];
  linescore?: number[];
  hits?: number;
  errors?: number;
  score?: number;
  /** Captain opted out of full stats for this team — only the final
   *  score is recorded. Public box score should render '–' across
   *  innings + show a "no individual stats" placeholder. */
  score_only?: boolean;
  final_score?: number;
  /** Captain may also supply a Score-Only final score for the
   *  OPPOSING team — useful when the opposing captain hasn't logged
   *  the result. Promotes to `${opp_side}_score_only` + `${opp_side}_score`
   *  on the public box-score doc. */
  opp_score_only?: boolean;
  opp_side?: "home" | "away";
  opp_final_score?: number;
  /** Captain kept the book for the OPPOSING team too — full lineup
   *  and pitching detail. Promoted only if no other captain has
   *  already submitted full data for that side (we don't clobber
   *  the opposing captain's authoritative version). */
  opp_lineup?: unknown[];
  opp_pitchers?: unknown[];
  /** Captain's view of the opposing team's per-inning runs + total
   *  errors. Promoted to public linescore[opp_side] and errors[opp_side]
   *  alongside opp_lineup/opp_pitchers, under the same anti-clobber
   *  rule. */
  opp_linescore?: number[];
  opp_errors?: number;
}

export async function POST(req: Request) {
  // 1) Auth ────────────────────────────────────────────────────
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing bearer token" },
      { status: 401 },
    );
  }
  const idToken = auth.slice("Bearer ".length).trim();

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  // 2) Body validation ─────────────────────────────────────────
  let body: { leagueId?: unknown; gameId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const leagueId = body.leagueId;
  const gameId = body.gameId;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "Body must include { leagueId }" },
      { status: 400 },
    );
  }
  if (typeof gameId !== "string" || !gameId) {
    return NextResponse.json(
      { error: "Body must include { gameId }" },
      { status: 400 },
    );
  }

  // 3) Claim check ─────────────────────────────────────────────
  const leagues = decoded.leagues as Record<string, string> | undefined;
  const claim = leagues?.[leagueId];
  let captainTeamId: string | null = null;
  if (claim === "admin") {
    captainTeamId = null;
  } else if (typeof claim === "string" && claim.startsWith("captain:")) {
    captainTeamId = claim.slice("captain:".length);
  } else {
    return NextResponse.json(
      { error: `Not admin/captain of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const db = getAdminDb();

  // 4) Promote captain's submission to /box_scores ─────────────
  // Read the captain's own lane (or both lanes if admin) and merge
  // into the public box-score doc. We never copy the OPPOSING
  // captain's submission into the public doc here — only their own
  // side. The other captain's submit promotes their side
  // independently. Admin reconciliation overwrites both as needed.
  try {
    if (captainTeamId) {
      const subId = `${gameId}_${captainTeamId}`;
      const subSnap = await db
        .doc(`leagues/${leagueId}/box_score_submissions/${subId}`)
        .get();
      if (!subSnap.exists) {
        return NextResponse.json(
          { error: "No submission found for this captain" },
          { status: 404 },
        );
      }
      const sub = subSnap.data() as SubmissionDoc;
      const side = sub.side;
      // Side may be missing on legacy docs — derive from game.
      const gameSnap = await db
        .doc(`leagues/${leagueId}/games/${gameId}`)
        .get();
      if (!gameSnap.exists) {
        return NextResponse.json(
          { error: "Game not found" },
          { status: 404 },
        );
      }
      const game = gameSnap.data() ?? {};

      // Defense-in-depth: verify the captain's team is actually IN this
      // game. The Firestore rules also gate this (via isCaptainOfDocGame
      // on /box_score_submissions), but we re-check server-side. Without
      // this, if the rules ever regress, a captain could submit a box
      // score for a game their team isn't in — derived `side` would
      // fall through to "away" and pollute the public box-score doc.
      // Found 2026-05-05 by the DVSL Claude peer review.
      if (
        game.home_team_id !== captainTeamId &&
        game.away_team_id !== captainTeamId
      ) {
        return NextResponse.json(
          { error: "Your team isn't in this game" },
          { status: 403 },
        );
      }

      const derivedSide =
        side ??
        (game.home_team_id === captainTeamId ? "home" : "away");

      // Score-Only branch: write only the final score + the
      // `${side}_score_only: true` flag. Lineup, pitchers, hits,
      // errors, linescore stay empty (or get cleared if the team
      // previously had full stats and the captain switched).
      const isScoreOnly = sub.score_only === true;
      const finalScoreFromSub = isScoreOnly
        ? Number(sub.final_score ?? sub.score ?? 0)
        : Number(sub.score ?? 0);
      const update: Record<string, unknown> = {
        [`${derivedSide}_score_only`]: isScoreOnly,
        [`${derivedSide}_lineup`]: isScoreOnly ? [] : (sub.lineup ?? []),
        [`${derivedSide}_pitchers`]: isScoreOnly
          ? []
          : (sub.pitchers ?? []),
        linescore: {
          ...((await getExistingLinescore(db, leagueId, gameId)) ?? {}),
          [derivedSide]: isScoreOnly ? [] : (sub.linescore ?? []),
        },
        hits: {
          ...((await getExistingScalar(db, leagueId, gameId, "hits")) ?? {}),
          [derivedSide]: isScoreOnly ? 0 : (sub.hits ?? 0),
        },
        errors: {
          ...((await getExistingScalar(db, leagueId, gameId, "errors")) ?? {}),
          [derivedSide]: isScoreOnly ? 0 : (sub.errors ?? 0),
        },
        // The team's authoritative score on the public doc — comes
        // from the score-only override or the regular submission.
        [`${derivedSide}_score`]: finalScoreFromSub,
        last_captain_submit_at: new Date().toISOString(),
      };
      // Read the BEFORE-state of the public box-score doc once. Used
      // both for opp-clobber-protection (don't overwrite the opposing
      // captain's authoritative submission with our view) and for
      // conflict detection in the push-trigger block below.
      const existing = (
        await db.doc(`leagues/${leagueId}/box_scores/${gameId}`).get()
      ).data() as Record<string, unknown> | undefined;

      // Carry over the captain's view of the OPPOSING team if they
      // submitted any. We only apply opposing-side data when the
      // public doc doesn't already have an authoritative full
      // submission from the opposing captain (don't clobber their
      // version with our copy).
      if (sub.opp_side) {
        const oppLineupKey = `${sub.opp_side}_lineup`;
        const oppHasFullStats =
          Array.isArray(existing?.[oppLineupKey]) &&
          (existing?.[oppLineupKey] as unknown[]).length > 0;
        if (!oppHasFullStats) {
          if (
            sub.opp_score_only &&
            typeof sub.opp_final_score === "number"
          ) {
            // Captain entered a final score only for the other
            // team — write that as a Score Only side.
            update[`${sub.opp_side}_score_only`] = true;
            update[`${sub.opp_side}_score`] = sub.opp_final_score;
          } else if (
            Array.isArray(sub.opp_lineup) ||
            Array.isArray(sub.opp_pitchers) ||
            Array.isArray(sub.opp_linescore)
          ) {
            // Captain kept the full book for both teams — promote
            // the opposing side's lineup + pitchers + linescore +
            // errors. Per-inning runs go into the existing
            // linescore map; errors merge into the errors map.
            update[`${sub.opp_side}_score_only`] = false;
            update[`${sub.opp_side}_lineup`] = sub.opp_lineup ?? [];
            update[`${sub.opp_side}_pitchers`] =
              sub.opp_pitchers ?? [];
            // Merge opposing linescore + errors into the per-side
            // maps. We re-use the helpers from the captain's-own
            // side promotion so behavior is identical for both
            // teams when the captain kept the whole book.
            const lsMap =
              (await getExistingLinescore(db, leagueId, gameId)) ?? {};
            update.linescore = {
              ...(update.linescore as Record<string, unknown>),
              ...lsMap,
              [sub.opp_side]: sub.opp_linescore ?? [],
            };
            const errMap =
              (await getExistingScalar(
                db,
                leagueId,
                gameId,
                "errors",
              )) ?? {};
            update.errors = {
              ...(update.errors as Record<string, unknown>),
              ...errMap,
              [sub.opp_side]: sub.opp_errors ?? 0,
            };
          }
        }
      }

      await db
        .doc(`leagues/${leagueId}/box_scores/${gameId}`)
        .set(update, { merge: true });

      // Promote the game's away/home_score on the games doc so
      // standings + game cards pick it up. We only set scores that
      // we have authoritative data for (this captain's side).
      const gameUpdate: Record<string, unknown> = {
        [`${derivedSide}_score`]: finalScoreFromSub,
      };
      // If both sides now have scores recorded, mark the game final.
      const otherSide = derivedSide === "home" ? "away" : "home";
      const bsAfter = (
        await db
          .doc(`leagues/${leagueId}/box_scores/${gameId}`)
          .get()
      ).data() as Record<string, number> | undefined;
      const otherScore = bsAfter?.[`${otherSide}_score`];
      const goingFinal = typeof otherScore === "number";
      if (goingFinal) {
        gameUpdate.status = "final";
        gameUpdate[`${otherSide}_score`] = otherScore;
      }
      await db
        .doc(`leagues/${leagueId}/games/${gameId}`)
        .set(gameUpdate, { merge: true });

      // ── Push triggers (DVSL spec §5.1, §5.2, §5.3) ────────────
      // Compose names + URL once; fire-and-forget the fanout.
      // Caller's bearer token is reused — they're already past
      // captain/admin claim verification, and send-notification
      // re-verifies on its own end.
      const origin = originFromRequest(req);
      const teamsSnap = await db
        .collection(`leagues/${leagueId}/teams`)
        .get();
      const teamNames: Record<string, string> = {};
      for (const d of teamsSnap.docs) {
        teamNames[d.id] = String(d.data().name ?? d.id);
      }
      const awayName =
        teamNames[String(game.away_team_id ?? "")] ?? "Away";
      const homeName =
        teamNames[String(game.home_team_id ?? "")] ?? "Home";
      const awayScore = goingFinal
        ? derivedSide === "away"
          ? finalScoreFromSub
          : (otherScore as number)
        : derivedSide === "away"
          ? finalScoreFromSub
          : null;
      const homeScore = goingFinal
        ? derivedSide === "home"
          ? finalScoreFromSub
          : (otherScore as number)
        : derivedSide === "home"
          ? finalScoreFromSub
          : null;
      const wkLabel = game.week != null ? `Week ${game.week}` : "";
      const dateLabel = game.date ? String(game.date) : "";
      const bodyParts = [wkLabel, dateLabel].filter(Boolean);

      if (goingFinal) {
        // 5.2 — Final push (both sides recorded). category: scores.
        await fanoutPush({
          origin,
          bearerToken: idToken,
          leagueId,
          category: "scores",
          title: `Final: ${awayName} ${awayScore}, ${homeName} ${homeScore}`,
          body: bodyParts.join(" · ") || "Game final",
          teams: [
            String(game.away_team_id ?? ""),
            String(game.home_team_id ?? ""),
          ].filter(Boolean),
          url: `/games/${gameId}`,
        });
      } else {
        // 5.1 — Score submitted, awaiting other captain. category: scores.
        const submittedBy =
          captainTeamId === game.away_team_id ? awayName : homeName;
        const titleScore =
          derivedSide === "away"
            ? `${awayName} ${finalScoreFromSub}, ${homeName} ?`
            : `${awayName} ?, ${homeName} ${finalScoreFromSub}`;
        await fanoutPush({
          origin,
          bearerToken: idToken,
          leagueId,
          category: "scores",
          title: `Score submitted: ${titleScore}`,
          body:
            [`by ${submittedBy}`, ...bodyParts]
              .filter(Boolean)
              .join(" · ") || "Awaiting confirmation from the other captain",
          teams: [
            String(game.away_team_id ?? ""),
            String(game.home_team_id ?? ""),
          ].filter(Boolean),
          url: `/games/${gameId}`,
        });
      }

      // 5.3 — Score conflict (admin-only alert). Fires when this
      // captain's view of the OPPOSING team's score disagrees with
      // what's already stored from the other captain. category:
      // admin, adminOnly: true (bypasses category prefs, gates by
      // is_admin per the filter chain).
      if (sub.opp_side) {
        const captainOppScore =
          typeof sub.opp_final_score === "number"
            ? sub.opp_final_score
            : null;
        const existingOppScore = (existing as Record<string, unknown> | undefined)?.[
          `${sub.opp_side}_score`
        ];
        if (
          captainOppScore !== null &&
          typeof existingOppScore === "number" &&
          existingOppScore !== captainOppScore
        ) {
          await fanoutPush({
            origin,
            bearerToken: idToken,
            leagueId,
            category: "admin",
            adminOnly: true,
            title: `🔔 Score conflict: ${awayName} @ ${homeName}`,
            body:
              `Captains disagree on ${
                sub.opp_side === "home" ? homeName : awayName
              }'s score — one says ${existingOppScore}, the other says ${captainOppScore}. Review on admin.`,
            url: "/admin",
          });
        }
      }
    }

    // 5) Recalc — refresh per-player season aggregates ──────
    const result = await recalcLeague(db, leagueId);
    return NextResponse.json({ ok: true, recalc: result });
  } catch (err) {
    console.error("[api/captain-submit] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Submit failed" },
      { status: 500 },
    );
  }
}

async function getExistingLinescore(
  db: FirebaseFirestore.Firestore,
  leagueId: string,
  gameId: string,
): Promise<Record<string, unknown> | null> {
  const snap = await db
    .doc(`leagues/${leagueId}/box_scores/${gameId}`)
    .get();
  if (!snap.exists) return null;
  const v = (snap.data() ?? {}).linescore;
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

async function getExistingScalar(
  db: FirebaseFirestore.Firestore,
  leagueId: string,
  gameId: string,
  field: "hits" | "errors",
): Promise<Record<string, unknown> | null> {
  const snap = await db
    .doc(`leagues/${leagueId}/box_scores/${gameId}`)
    .get();
  if (!snap.exists) return null;
  const v = (snap.data() ?? {})[field];
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
