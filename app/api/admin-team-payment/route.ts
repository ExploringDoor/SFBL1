// /api/admin-team-payment — the LEAGUE's own ledger of who has paid
// the league, at BOTH levels (it happens both ways):
//   - a team paying as a block  → team_payments/{teamId}
//   - a player paying directly  → league_payments/{playerId}
// Separate from /api/captain-payment (captains tracking their own
// players' money) — the league never sees that here.
//
// Docs:
//   /leagues/{id}/team_payments/{teamId}    { amount_due, amount_paid, note }
//   /leagues/{id}/league_payments/{playerId}{ team_id, amount_due,
//                                             amount_paid, note }
//
// Body:
//   POST { leagueId, action: "list" }
//        → { ok, team_payments: [...], player_payments: [...] }
//   POST { leagueId, action: "save", target: "team"|"player",
//          teamId|playerId, teamId?(for player), amount_due?,
//          amount_paid?, note? }
//        → { ok }
//
// Admin-only. Reads + writes via the Admin SDK — no client-write rule.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

// Team/player ids are EITHER hand-made slugs on older tenants ("18-plus") OR
// Firestore auto-ids from registration ("etUnCN42apFfYXnyVvrO"), which are
// mixed case. Lowercase-only rejected every team a coach registered.
const TEAM_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

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
    target?: unknown;
    teamId?: unknown;
    playerId?: unknown;
    amount_due?: unknown;
    amount_paid?: unknown;
    note?: unknown;
    method?: unknown;
    paid_at?: unknown;
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
    const [teamSnap, playerSnap] = await Promise.all([
      db.collection(`leagues/${leagueId}/team_payments`).get(),
      db.collection(`leagues/${leagueId}/league_payments`).get(),
    ]);
    const team_payments = teamSnap.docs.map((d) => {
      const x = d.data();
      return {
        team_id: d.id,
        amount_due: Number(x.amount_due ?? 0),
        amount_paid: Number(x.amount_paid ?? 0),
        note: String(x.note ?? ""),
        method: String(x.method ?? ""),
        paid_at: String(x.paid_at ?? ""),
      };
    });
    const player_payments = playerSnap.docs.map((d) => {
      const x = d.data();
      return {
        player_id: d.id,
        team_id: String(x.team_id ?? ""),
        amount_due: Number(x.amount_due ?? 0),
        amount_paid: Number(x.amount_paid ?? 0),
        note: String(x.note ?? ""),
      };
    });
    return NextResponse.json({ ok: true, team_payments, player_payments });
  }

  if (body.action === "save") {
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by_uid: decoded.uid,
    };
    const due = money(body.amount_due);
    if (due !== undefined) update.amount_due = due ?? 0;
    const paid = money(body.amount_paid);
    if (paid !== undefined) update.amount_paid = paid ?? 0;
    if (typeof body.note === "string") update.note = body.note.trim();
    // How the money arrived, from a fixed set rather than free text, so the
    // office can actually count and filter it. Anything unrecognised is
    // ignored instead of stored.
    if (typeof body.method === "string") {
      const m = body.method.trim().toLowerCase();
      update.method = ["card", "venmo", "check", "cash", "other"].includes(m)
        ? m
        : "";
    }
    if (typeof body.paid_at === "string") update.paid_at = body.paid_at.trim();

    if (body.target === "player") {
      const playerId = body.playerId;
      if (typeof playerId !== "string" || !TEAM_ID_RE.test(playerId)) {
        return NextResponse.json(
          { error: "valid playerId required" },
          { status: 400 },
        );
      }
      if (typeof body.teamId === "string") update.team_id = body.teamId;
      await db
        .doc(`leagues/${leagueId}/league_payments/${playerId}`)
        .set(update, { merge: true });
      return NextResponse.json({ ok: true });
    }

    // default: team-level
    const teamId = body.teamId;
    if (typeof teamId !== "string" || !TEAM_ID_RE.test(teamId)) {
      return NextResponse.json(
        { error: "valid teamId required" },
        { status: 400 },
      );
    }
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
