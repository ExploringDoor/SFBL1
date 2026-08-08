// POST /api/admin-umpires — admin-only umpire roster and game assignment.
//
//   { leagueId, action: "save_umpire", umpire }        create / update
//   { leagueId, action: "delete_umpire", umpireId }
//   { leagueId, action: "assign", gameId, umpireIds }  set a game's crew
//   { leagueId, action: "settings", requiredPerGame?, gameMinutes? }
//
// Umpire contact details are stored under `umpires`, which is admin-read only
// in the rules — an official's mobile number is not public information, and
// this collection is never projected onto a public page. That is why there is
// no public umpire route in this file: the /content/umpires page is chapter
// information, not a directory of people.
//
// Assignment validates through lib/umpires before writing, for the same reason
// the schedule generator validates through lib/schedule-conflicts: an umpire
// double-booked across two fields is a game without an official, discovered on
// the morning of.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import {
  findUmpireIssues,
  type AssignableGame,
  type Umpire,
} from "@/lib/umpires";

export const runtime = "nodejs";

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CREW = 6;

export async function POST(req: Request) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return NextResponse.json({ error: "missing bearer" }, { status: 401 });
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(m[1]!);
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

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
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[leagueId];
  if (claim !== "admin") {
    return NextResponse.json({ error: "not admin" }, { status: 403 });
  }

  const db = getAdminDb();
  const now = new Date().toISOString();
  const action = String(body.action ?? "");
  const col = db.collection(`leagues/${leagueId}/umpires`);

  // ── roster ────────────────────────────────────────────────────────
  if (action === "save_umpire") {
    const u = (body.umpire ?? {}) as Record<string, unknown>;
    const name = String(u.name ?? "").trim().slice(0, 80);
    if (!name) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }
    const id =
      typeof u.id === "string" && ID_RE.test(u.id) ? u.id : col.doc().id;
    await col.doc(id).set(
      {
        name,
        level: String(u.level ?? "").trim().slice(0, 40),
        email: String(u.email ?? "").trim().slice(0, 160),
        phone: String(u.phone ?? "").trim().slice(0, 40),
        unavailable: Array.isArray(u.unavailable)
          ? [...new Set(u.unavailable.map(String).filter((d) => DATE_RE.test(d)))].sort()
          : [],
        fields: Array.isArray(u.fields)
          ? [...new Set(u.fields.map((f) => String(f).trim().slice(0, 120)).filter(Boolean))]
          : [],
        active: u.active !== false,
        updated_at: now,
      },
      { merge: true },
    );
    return NextResponse.json({ ok: true, id });
  }

  if (action === "delete_umpire") {
    const umpireId = String(body.umpireId ?? "");
    if (!ID_RE.test(umpireId)) {
      return NextResponse.json({ error: "umpireId required" }, { status: 400 });
    }
    // Strip them off any game first, or the schedule keeps pointing at an
    // official who no longer exists and the assignment view shows a blank name.
    const assigned = await db
      .collection(`leagues/${leagueId}/games`)
      .where("umpires", "array-contains", umpireId)
      .get();
    const batch = db.batch();
    assigned.docs.forEach((d) => {
      const cur = (d.data().umpires ?? []) as string[];
      batch.update(d.ref, { umpires: cur.filter((x) => x !== umpireId) });
    });
    batch.delete(col.doc(umpireId));
    await batch.commit();
    return NextResponse.json({ ok: true, unassigned: assigned.size });
  }

  // ── settings ──────────────────────────────────────────────────────
  if (action === "settings") {
    await db.doc(`leagues/${leagueId}/site_config/umpires`).set(
      {
        required_per_game: Math.max(0, Math.min(6, Number(body.requiredPerGame) || 0)),
        game_minutes: Math.max(0, Math.min(360, Number(body.gameMinutes) || 0)),
        updated_at: now,
      },
      { merge: true },
    );
    return NextResponse.json({ ok: true });
  }

  // ── assignment ────────────────────────────────────────────────────
  if (action === "assign") {
    const gameId = String(body.gameId ?? "");
    if (!ID_RE.test(gameId)) {
      return NextResponse.json({ error: "gameId required" }, { status: 400 });
    }
    const raw = Array.isArray(body.umpireIds) ? body.umpireIds : [];
    const umpireIds = [
      ...new Set(raw.map(String).filter((x) => ID_RE.test(x))),
    ].slice(0, MAX_CREW);

    const gameRef = db.doc(`leagues/${leagueId}/games/${gameId}`);
    const [gameSnap, umpSnap, cfgSnap] = await Promise.all([
      gameRef.get(),
      col.get(),
      db.doc(`leagues/${leagueId}/site_config/umpires`).get(),
    ]);
    if (!gameSnap.exists) {
      return NextResponse.json({ error: "game not found" }, { status: 404 });
    }

    const umpires: Umpire[] = umpSnap.docs.map((d) => {
      const t = d.data();
      return {
        id: d.id,
        name: String(t.name ?? d.id),
        level: t.level ? String(t.level) : null,
        unavailable: Array.isArray(t.unavailable) ? (t.unavailable as string[]) : [],
        fields: Array.isArray(t.fields) ? (t.fields as string[]) : [],
        active: t.active !== false,
      };
    });

    // Validate against the whole schedule, not just this game — a double
    // booking is by definition a relationship between two games.
    const gd = gameSnap.data() ?? {};
    const thisGame: AssignableGame = {
      id: gameId,
      date: String(gd.date ?? "").slice(0, 10),
      time: String(gd.time ?? ""),
      field: String(gd.field ?? ""),
      umpires: umpireIds,
    };
    const dayGames = await db
      .collection(`leagues/${leagueId}/games`)
      .where("date", "==", thisGame.date)
      .get();
    const others: AssignableGame[] = dayGames.docs
      .filter((d) => d.id !== gameId)
      .map((d) => {
        const x = d.data();
        return {
          id: d.id,
          date: String(x.date ?? "").slice(0, 10),
          time: String(x.time ?? ""),
          field: String(x.field ?? ""),
          umpires: Array.isArray(x.umpires) ? (x.umpires as string[]) : [],
        };
      });

    const gameMinutes = Number(cfgSnap.data()?.game_minutes ?? 0) || 0;
    const issues = findUmpireIssues([thisGame, ...others], umpires, { gameMinutes });
    // Only issues involving THIS game block the save; a pre-existing problem
    // elsewhere on the same day is not this edit's fault.
    const blocking = issues.filter(
      (i) => i.severity === "error" && i.gameIds.includes(gameId),
    );
    if (blocking.length > 0 && body.force !== true) {
      return NextResponse.json(
        { error: blocking[0]!.message, issues: blocking },
        { status: 409 },
      );
    }

    await gameRef.set({ umpires: umpireIds, umpires_updated_at: now }, { merge: true });
    return NextResponse.json({ ok: true, assigned: umpireIds.length });
  }

  return NextResponse.json(
    { error: "action must be save_umpire | delete_umpire | assign | settings" },
    { status: 400 },
  );
}
