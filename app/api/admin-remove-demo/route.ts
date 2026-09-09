// POST /api/admin-remove-demo — delete a league's sample season.
//
// Body: { leagueId } → { ok, teams, games, standings }
//
// WHY THIS EXISTS. A tenant is seeded with sample teams and sample games so a
// brand new site has something to look at. Removing them afterwards needed a
// terminal and a script, which meant it needed ADAM, which meant it did not
// happen. Mike, 2026-09-01: "Schedule in admin, not deleting sample games."
//
// He was not wrong. The per-game Delete button works fine and always has, but
// deleting twelve games one at a time leaves eight sample TEAMS standing on
// the teams page and the standings table, so the site still looks seeded and
// the job looks unfinished. There was no control anywhere that removed the set.
//
// WHAT IT WILL AND WILL NOT TOUCH. Only documents carrying `demo: true`, plus
// the standings rows derived from them. It reads every candidate, checks that
// flag on each, and deletes nothing it did not verify. A real team that
// somehow acquired a demo-looking id is safe; a sample team that lost its flag
// is left behind, which is the right way round for a destructive action.
//
// FULL ADMIN ONLY. Deliberately not given a scope: this is the most
// destructive thing in the admin, and the assistant and umpire roles have no
// business reaching it.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(auth.slice(7));
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  let body: { leagueId?: unknown };
  try {
    body = (await req.json()) as { leagueId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const leagueId = typeof body.leagueId === "string" ? body.leagueId : "";
  if (!leagueId) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }

  const leagues = (decoded.leagues ?? {}) as Record<string, string>;
  if (leagues[leagueId] !== "admin") {
    return NextResponse.json({ error: "not admin" }, { status: 403 });
  }

  const db = getAdminDb();
  const isDemo = (d: FirebaseFirestore.QueryDocumentSnapshot) =>
    (d.data() as { demo?: unknown }).demo === true;

  // Read first, delete second, and only what carries the flag.
  const [teamSnap, gameSnap] = await Promise.all([
    db.collection(`leagues/${leagueId}/teams`).get(),
    db.collection(`leagues/${leagueId}/games`).get(),
  ]);
  const teams = teamSnap.docs.filter(isDemo);
  const games = gameSnap.docs.filter(isDemo);

  // The provision script and quick-score write a score-only box_scores doc
  // for every final game, keyed by the game id. A sample game's must go with
  // it, or the public game page keeps showing a result for a game that no
  // longer exists. Matched on the id of a VERIFIED demo game only.
  const demoGameIds = new Set(games.map((d) => d.id));
  const boxSnap = await db
    .collection(`leagues/${leagueId}/box_scores`)
    .get()
    .catch(() => null);
  const boxScores = (boxSnap?.docs ?? []).filter((d) => demoGameIds.has(d.id));

  // Standings are derived, and a sample division left behind is as visible as
  // a sample team. Only rows whose every entry belongs to a demo team go.
  const demoTeamIds = new Set(teams.map((d) => d.id));
  const standSnap = await db
    .collection(`leagues/${leagueId}/standings`)
    .get()
    .catch(() => null);
  const standings = (standSnap?.docs ?? []).filter((d) => {
    const rows = (d.data() as { rows?: { team_id?: unknown }[] }).rows;
    if (!Array.isArray(rows) || rows.length === 0) return false;
    return rows.every((r) => demoTeamIds.has(String(r?.team_id ?? "")));
  });

  const batchDelete = async (
    docs: FirebaseFirestore.QueryDocumentSnapshot[],
  ) => {
    // 400 at a time. Firestore caps a batch at 500 writes and a seeded season
    // is nowhere near that, but a tenant seeded twice would be.
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  };

  await batchDelete(games);
  await batchDelete(boxScores);
  await batchDelete(standings);
  // Teams last. If anything above fails the sample teams are still there, and
  // a half-removed season that still has its teams reads as "not finished"
  // rather than as games belonging to teams that no longer exist.
  await batchDelete(teams);

  // Clear the flag in the same operation, so the "sample data" banners on the
  // schedule and standings pages come down with the data rather than needing a
  // second, separate action nobody would know to take.
  await db
    .doc(`leagues/${leagueId}`)
    .set({ flags: { demo_data: false } }, { merge: true });

  try {
    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: "remove_demo_season",
      by_uid: decoded.uid,
      teams: teams.length,
      games: games.length,
      box_scores: boxScores.length,
      standings: standings.length,
      at: new Date().toISOString(),
    });
  } catch {
    /* never fail the removal over the audit row */
  }

  return NextResponse.json({
    ok: true,
    teams: teams.length,
    games: games.length,
    box_scores: boxScores.length,
    standings: standings.length,
  });
}
