// GET  /api/captain-fee?leagueId=…  → what this coach's team owes the league
// POST /api/captain-fee { leagueId }  → mint a Square card link for it
//
// Adam, 2026-08-12: "can the coach somehow get this link themselves?"
//
// Why this exists rather than calling /api/square-checkout from the portal:
// that endpoint takes a registrationId straight from the request body and
// checks nobody's identity. Fine where it is used today (a coach who has just
// registered, paying immediately, with a server-computed amount), but wrong to
// expose to a signed-in portal — a coach could hand it any team's id.
//
// Here the team comes from the caller's OWN captain claim and the registration
// is looked up from that team's payment record. Nothing about which team, and
// nothing about the amount, is taken from the client.

import { NextResponse } from "next/server";

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolve the caller to a team, or return the error response to send back. */
async function teamFor(req: Request, leagueId: string) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(auth.slice(7).trim());
  } catch {
    return { error: NextResponse.json({ error: "Session expired." }, { status: 401 }) };
  }
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[leagueId];
  if (typeof claim !== "string" || !claim.startsWith("captain:")) {
    return {
      error: NextResponse.json(
        { error: "You need to be signed in as a coach for this team." },
        { status: 403 },
      ),
    };
  }
  const teamId = claim.slice("captain:".length);
  if (!teamId) {
    return { error: NextResponse.json({ error: "No team on your login." }, { status: 403 }) };
  }
  return { teamId };
}

function leagueIdFrom(v: string | null) {
  return v && /^[a-z0-9_-]+$/.test(v) ? v : "";
}

export async function GET(req: Request) {
  const leagueId = leagueIdFrom(new URL(req.url).searchParams.get("leagueId"));
  if (!leagueId) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  const who = await teamFor(req, leagueId);
  if (who.error) return who.error;

  const snap = await getAdminDb()
    .doc(`leagues/${leagueId}/team_payments/${who.teamId}`)
    .get();
  if (!snap.exists) {
    // No ledger row: nothing is owed as far as the league is concerned.
    return NextResponse.json({ ok: true, owes: false });
  }
  const x = snap.data() ?? {};
  const due = Number(x.amount_due ?? 0);
  const paid = Number(x.amount_paid ?? 0);
  return NextResponse.json({
    ok: true,
    owes: due > 0 && paid <= 0,
    due,
    paid,
    method: String(x.method ?? ""),
    // Only tells the UI whether a card link is possible, never the id itself.
    canPayByCard: Boolean(x.registration_id) && due > 0 && paid <= 0,
  });
}

export async function POST(req: Request) {
  let body: { leagueId?: unknown };
  try {
    body = (await req.json()) as { leagueId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const leagueId = leagueIdFrom(typeof body.leagueId === "string" ? body.leagueId : null);
  if (!leagueId) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  const who = await teamFor(req, leagueId);
  if (who.error) return who.error;

  const ref = getAdminDb().doc(`leagues/${leagueId}/team_payments/${who.teamId}`);
  const snap = await ref.get();
  const x = snap.data() ?? {};
  const registrationId = String(x.registration_id ?? "");
  const due = Number(x.amount_due ?? 0);
  const paid = Number(x.amount_paid ?? 0);

  if (paid > 0) {
    return NextResponse.json({ error: "This team is already marked paid." }, { status: 400 });
  }
  if (!registrationId || due <= 0) {
    return NextResponse.json(
      { error: "No fee on file for your team. Contact the league office." },
      { status: 400 },
    );
  }

  // Reuse the existing checkout so the amount and the 3.25% surcharge are
  // computed in exactly one place, server-side, from the saved registration.
  const origin = new URL(req.url).origin;
  const res = await fetch(`${origin}/api/square-checkout`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // square-checkout resolves the tenant from Host, so pass ours through.
      host: req.headers.get("host") ?? "",
    },
    body: JSON.stringify({ registrationId }),
  });
  const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!j.url) {
    return NextResponse.json(
      { error: j.error ?? "Couldn't start card payment. Try again shortly." },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, url: j.url });
}
