// POST /api/crew-sync
//
// Accept a league's umpire assignments from the system that made them, so the
// crew shows up on the public schedule without anyone retyping it.
//
// Island keeps its schedule here and does its assigning in AssignCrew. Jim
// fills the season there; this is how the names come back. Without it the two
// halves drift and somebody maintains both by hand.
//
//   { leagueId, crews: [{ gameId, umpires: [{ name, email? }] }] }
//
// AUTH is a shared secret rather than a Firebase token, for the same reason
// /api/pregame-reminder uses one: the caller is a machine with no user to sign
// in as. It fails closed when the env var is unset, so a deploy that forgot it
// refuses everyone instead of admitting everyone.
//
// WHAT IT WILL NOT DO:
//   * touch anything on a game except its crew. Not the date, not the field,
//     not the score. The schedule here stays the schedule of record.
//   * delete an umpire, ever. It creates one the league has not seen so a name
//     can render, and leaves everything else alone.
//   * refuse a crew for looking double-booked. The assigner is upstream and
//     authoritative, exactly as ArbiterSports is in /api/admin-arbiter: if it
//     says a crew works two fields, that is the league's real situation and
//     rejecting it would only leave the website blank.

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { authorizeCrewSync, crewChanged, matchUmpire, parseCrews } from "@/lib/crew-sync";

export const runtime = "nodejs";

const BATCH_LIMIT = 450;

export async function POST(req: Request) {
  const allowed = authorizeCrewSync(
    {
      authorization: req.headers.get("authorization"),
      secret: req.headers.get("x-crew-sync-secret"),
    },
    process.env.CREW_SYNC_SECRET,
  );
  if (!allowed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const leagueId = typeof body.leagueId === "string" ? body.leagueId : "";
  if (!leagueId || !/^[a-z][a-z0-9-]+$/i.test(leagueId)) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }

  const crews = parseCrews(body.crews);
  if (crews.length === 0) {
    return NextResponse.json({ error: "no usable crews in that request" }, { status: 400 });
  }

  const db = getAdminDb();
  const now = new Date().toISOString();
  const umpCol = db.collection(`leagues/${leagueId}/umpires`);
  const gameCol = db.collection(`leagues/${leagueId}/games`);

  // Read the whole roster and schedule first, so re-running the same
  // assignments resolves to the same ids instead of minting a second copy of
  // every umpire.
  const [umpSnap, gameSnap] = await Promise.all([umpCol.get(), gameCol.get()]);
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const d of umpSnap.docs) {
    const t = d.data();
    const email = String(t.email ?? "").trim().toLowerCase();
    const name = String(t.name ?? "").trim().toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, d.id);
    if (name && !byName.has(name)) byName.set(name, d.id);
  }
  const currentCrew = new Map<string, string[]>();
  for (const d of gameSnap.docs) {
    const u = d.data().umpires;
    currentCrew.set(d.id, Array.isArray(u) ? (u as string[]).map(String) : []);
  }

  // ---- resolve people, minting only the ones this league has never seen ----
  // Per request, never module scope: a shared array would replay one league's
  // new umpires into the next league's write.
  const pendingUmpires: { id: string; doc: Record<string, unknown> }[] = [];
  const created: string[] = [];
  const resolved = new Map<string, string[]>();
  const unknownGames: string[] = [];

  for (const crew of crews) {
    if (!currentCrew.has(crew.gameId)) {
      unknownGames.push(crew.gameId);
      continue;
    }
    const ids: string[] = [];
    for (const u of crew.umpires) {
      let id = matchUmpire(u, byEmail, byName);
      if (!id) {
        id = umpCol.doc().id;
        created.push(u.name);
        // Register straight away, so the same new person appearing on three
        // games in one payload becomes one umpire and not three.
        if (u.email) byEmail.set(u.email, id);
        byName.set(u.name.trim().toLowerCase(), id);
        pendingUmpires.push({
          id,
          doc: {
            name: u.name,
            email: u.email,
            level: "",
            phone: "",
            unavailable: [],
            fields: [],
            active: true,
            source: "assigncrew",
            created_at: now,
            updated_at: now,
          },
        });
      }
      ids.push(id);
    }
    resolved.set(crew.gameId, ids);
  }

  // ---- write ---------------------------------------------------------------
  let batch = db.batch();
  let inBatch = 0;
  const commits: Promise<unknown>[] = [];
  const flush = () => {
    if (inBatch === 0) return;
    commits.push(batch.commit());
    batch = db.batch();
    inBatch = 0;
  };

  for (const { id, doc } of pendingUmpires) {
    batch.set(umpCol.doc(id), doc, { merge: true });
    if (++inBatch >= BATCH_LIMIT) flush();
  }

  let gamesUpdated = 0;
  let gamesUnchanged = 0;
  for (const [gameId, ids] of resolved) {
    if (!crewChanged(currentCrew.get(gameId) ?? [], ids)) {
      gamesUnchanged++;
      continue;
    }
    gamesUpdated++;
    batch.update(gameCol.doc(gameId), { umpires: ids, umpires_updated_at: now });
    if (++inBatch >= BATCH_LIMIT) flush();
  }
  flush();
  await Promise.all(commits);

  return NextResponse.json({
    ok: true,
    gamesUpdated,
    gamesUnchanged,
    umpiresCreated: created.length,
    createdNames: created.slice(0, 50),
    unknownGameCount: unknownGames.length,
    unknownGames: unknownGames.slice(0, 20),
  });
}
