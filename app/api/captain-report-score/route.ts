// POST /api/captain-report-score
//
// Mike's rule, exactly:
//
//   1. Whoever reports first gets published. The score goes live straight
//      away — no waiting on the other coach.
//   2. If the other team never reports, the first score stands. It is the
//      official result.
//   3. If the other team reports the SAME score, it is confirmed. Nothing
//      changes on the site except that it is now agreed by both.
//   4. If the other team reports a DIFFERENT score, the score comes OFF the
//      site, an email goes to the league office, a dispute lands in the admin
//      inbox, and Mike has the final say.
//
// Each team's report is kept separately in
// /games/<id>/_private/score_reports, so "what did each coach actually say"
// survives a dispute and Mike can see both numbers side by side.
//
// Body: { leagueId, gameId, home_score, away_score }
// Auth: bearer token with a captain claim for one of the two teams (admins
// may also post, which is how Mike enters a score on a coach's behalf).

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { sendEmail, notifyAddress, esc } from "@/lib/email/send";

export const runtime = "nodejs";

interface Report {
  home_score: number;
  away_score: number;
  by_team: string;
  by_uid: string;
  at: string;
}

export async function POST(req: Request) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return NextResponse.json({ error: "missing bearer" }, { status: 401 });
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(m[1]!);
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  let body: {
    leagueId?: unknown;
    gameId?: unknown;
    home_score?: unknown;
    away_score?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const leagueId = typeof body.leagueId === "string" ? body.leagueId : "";
  const gameId = typeof body.gameId === "string" ? body.gameId : "";
  const home = Number(body.home_score);
  const away = Number(body.away_score);
  if (!leagueId || !gameId) {
    return NextResponse.json({ error: "leagueId and gameId required" }, { status: 400 });
  }
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
    return NextResponse.json(
      { error: "home_score and away_score must be whole numbers, 0 or more" },
      { status: 400 },
    );
  }

  const leagues = (decoded.leagues as Record<string, string> | undefined) ?? {};
  const isAdmin = leagues[leagueId] === "admin";
  const captainTeam = String(
    (decoded as { captain?: string }).captain ?? "",
  ).replace(/^.*:/, "");

  const db = getAdminDb();
  const gameRef = db.doc(`leagues/${leagueId}/games/${gameId}`);
  const reportsRef = db.doc(`leagues/${leagueId}/games/${gameId}/_private/score_reports`);

  const gameSnap = await gameRef.get();
  if (!gameSnap.exists) {
    return NextResponse.json({ error: "game not found" }, { status: 404 });
  }
  const game = gameSnap.data() ?? {};
  const homeTeam = String(game.home_team_id ?? "");
  const awayTeam = String(game.away_team_id ?? "");

  // Which side is reporting. Admins report as "office".
  let side: "home" | "away" | "office";
  if (isAdmin) side = "office";
  else if (captainTeam && captainTeam === homeTeam) side = "home";
  else if (captainTeam && captainTeam === awayTeam) side = "away";
  else {
    return NextResponse.json(
      { error: "you are not a captain of either team in this game" },
      { status: 403 },
    );
  }

  const now = new Date().toISOString();
  const mine: Report = {
    home_score: home,
    away_score: away,
    by_team: side === "office" ? "office" : side === "home" ? homeTeam : awayTeam,
    by_uid: decoded.uid,
    at: now,
  };

  const outcome = await db.runTransaction(async (txn) => {
    const [rSnap, gSnap] = await Promise.all([txn.get(reportsRef), txn.get(gameRef)]);
    const reports = (rSnap.exists ? rSnap.data() : {}) ?? {};
    const g = gSnap.data() ?? {};

    // The office always wins: an admin report resolves everything.
    if (side === "office") {
      txn.set(reportsRef, { office: mine }, { merge: true });
      txn.set(
        gameRef,
        {
          home_score: home,
          away_score: away,
          status: "final",
          score_disputed: false,
          score_source: "office",
          score_updated_at: now,
        },
        { merge: true },
      );
      return { kind: "office" as const };
    }

    const otherSide = side === "home" ? "away" : "home";
    const other = reports[otherSide] as Report | undefined;
    txn.set(reportsRef, { [side]: mine }, { merge: true });

    // No one else has reported: publish it. Rule 1.
    if (!other) {
      txn.set(
        gameRef,
        {
          home_score: home,
          away_score: away,
          status: "final",
          score_disputed: false,
          score_source: side,
          score_updated_at: now,
        },
        { merge: true },
      );
      return { kind: "published" as const };
    }

    // Both agree: confirm it. Rule 3.
    if (other.home_score === home && other.away_score === away) {
      txn.set(
        gameRef,
        {
          home_score: home,
          away_score: away,
          status: "final",
          score_disputed: false,
          score_source: "both",
          score_updated_at: now,
        },
        { merge: true },
      );
      return { kind: "agreed" as const };
    }

    // They differ: pull it off the site and raise a dispute. Rule 4.
    // Scores are cleared and the status reverts, so standings stop counting it
    // until Mike decides. Both numbers stay in _private/score_reports.
    txn.set(
      gameRef,
      {
        home_score: null,
        away_score: null,
        status: "scheduled",
        score_disputed: true,
        score_source: null,
        score_updated_at: now,
      },
      { merge: true },
    );
    return {
      kind: "disputed" as const,
      other,
      otherSide,
    };
  });

  // ---- dispute side effects: admin inbox + email ------------------------
  if (outcome.kind === "disputed") {
    const teamName = async (id: string) => {
      const s = await db.doc(`leagues/${leagueId}/teams/${id}`).get();
      return String(s.data()?.name ?? id);
    };
    const [homeName, awayName] = await Promise.all([
      teamName(homeTeam),
      teamName(awayTeam),
    ]);
    const label = `${awayName} at ${homeName}`;
    const date = String(game.date ?? "");

    await db.collection(`leagues/${leagueId}/score_disputes`).add({
      game_id: gameId,
      date,
      label,
      home_team_id: homeTeam,
      away_team_id: awayTeam,
      reported: {
        [side]: { home_score: home, away_score: away },
        [outcome.otherSide]: {
          home_score: outcome.other.home_score,
          away_score: outcome.other.away_score,
        },
      },
      status: "open",
      created_at: now,
    });

    const to = notifyAddress();
    if (to) {
      const a = `${outcome.other.away_score}-${outcome.other.home_score}`;
      const b = `${away}-${home}`;
      await sendEmail({
        to,
        subject: `Score discrepancy: ${label}${date ? ` (${date})` : ""}`,
        html:
          `<p><strong>The two teams reported different scores, so the result has been ` +
          `taken off the site.</strong></p>` +
          `<p><strong>${esc(label)}</strong>${date ? ` — ${esc(date)}` : ""}</p>` +
          `<ul>` +
          `<li>${esc(outcome.otherSide === "home" ? homeName : awayName)} reported ` +
          `<strong>${esc(a)}</strong> (away-home)</li>` +
          `<li>${esc(side === "home" ? homeName : awayName)} reported ` +
          `<strong>${esc(b)}</strong> (away-home)</li>` +
          `</ul>` +
          `<p>Open the Score Disputes tab in the admin to set the official score. ` +
          `Nothing shows on the site until you do.</p>`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    result: outcome.kind,
    published: outcome.kind === "published" || outcome.kind === "agreed" || outcome.kind === "office",
    disputed: outcome.kind === "disputed",
  });
}
