// /api/admin-team-payment — the LEAGUE's own ledger of what each team
// owes / has paid the league (dues, fees). Separate from
// /api/captain-payment, which is captains tracking their own players'
// money — the league never sees that here.
//
// Stored at /leagues/{leagueId}/team_payments/{teamId}:
//   { amount_due, amount_paid, note, updated_at, updated_by_uid }
//
// Body:
//   POST { leagueId, action: "list" }
//        → { ok, payments: [{ team_id, amount_due, amount_paid, note }] }
//   POST { leagueId, action: "save", teamId, amount_due?, amount_paid?, note? }
//        → { ok }
//
// Admin-only (verified claim). Reads + writes via the Admin SDK so
// there's no new client-write rule to add.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const TEAM_ID_RE = /^[a-z0-9_-]+$/;

function money(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined; // reject; leave unchanged
  return Math.round(n * 100) / 100;
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(
      auth.slice("Bearer ".length).trim(),
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: {
    leagueId?: unknown;
    action?: unknown;
    teamId?: unknown;
    amount_due?: unknown;
    amount_paid?: unknown;
    note?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  const leagues = decoded.leagues as Record<string, string> | undefined;
  if (leagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const db = getAdminDb();

  if (body.action === "list") {
    const snap = await db
      .collection(`leagues/${leagueId}/team_payments`)
      .get();
    const payments = snap.docs.map((d) => {
      const x = d.data();
      return {
        team_id: d.id,
        amount_due: Number(x.amount_due ?? 0),
        amount_paid: Number(x.amount_paid ?? 0),
        note: String(x.note ?? ""),
      };
    });
    return NextResponse.json({ ok: true, payments });
  }

  if (body.action === "save") {
    const teamId = body.teamId;
    if (typeof teamId !== "string" || !TEAM_ID_RE.test(teamId)) {
      return NextResponse.json({ error: "valid teamId required" }, { status: 400 });
    }
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by_uid: decoded.uid,
    };
    const due = money(body.amount_due);
    if (due !== undefined) update.amount_due = due ?? 0;
    const paid = money(body.amount_paid);
    if (paid !== undefined) update.amount_paid = paid ?? 0;
    if (typeof body.note === "string") update.note = body.note.trim();

    await db
      .doc(`leagues/${leagueId}/team_payments/${teamId}`)
      .set(update, { merge: true });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "action must be list | save" },
    { status: 400 },
  );
}
