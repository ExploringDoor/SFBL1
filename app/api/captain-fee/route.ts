// GET  /api/captain-fee?leagueId=…  → what this coach's team owes the league
// POST /api/captain-fee { leagueId }  → the amount, and this coach's OWN
//                                       registration id, for the embedded card
//                                       form on the page to charge
//
// Adam, 2026-08-12: "can the coach somehow get this link themselves?"
//
// Why this exists rather than letting the portal call a payment endpoint
// directly: /api/square-pay takes a registrationId straight from the request
// body and checks nobody's identity. That is unavoidable on the public path,
// where the payer has no account, but it is wrong to hand a signed-in portal.
// So the portal never learns a registration id except from this route, and
// this route only ever returns the caller's own.
//
// Here the team comes from the caller's OWN captain claim and the registration
// is looked up from that team's payment record. Nothing about which team, and
// nothing about the amount, is taken from the client.

import { NextResponse } from "next/server";

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
// From lib/fees, not lib/square: this route needs the arithmetic and nothing
// else, and lib/square pulls in node:crypto for the idempotency digest.
import { chargeCents, feeFor } from "@/lib/fees";

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
    // Only tells the UI whether card payment is possible, never the id itself.
    // The id is handed over by POST, which is an explicit act by the coach.
    // This GET runs on every My Team render for every coach in the league.
    canPayByCard: Boolean(x.registration_id) && due > 0 && paid <= 0,
    // What the same balance costs on a card, surcharge included, so the coach
    // sees BOTH prices before choosing rather than meeting the card price on a
    // checkout page they have already been sent to. New York GBL 518 requires
    // the card price to be posted up front, not added at the end, and the old
    // redirect showed no total at all.
    //
    // Quoted from the LEDGER, which is what the office believes the team owes,
    // and costs no extra Firestore read because `due` is already in hand. POST
    // applies min(price list, ledger) and is the authority. The only case
    // where the two differ is a balance raised ABOVE the published fee, where
    // this line shows MORE than POST will charge. Never the other way round,
    // so nobody is ever charged more than they were shown.
    //
    // One exception, and it is test-only: LEAGUE_TEST_FEE rewrites feeFor()
    // but not the stored balance, so on a preview with the test fee set this
    // number stays at the real price while POST quotes $1.33. Expected. Do not
    // "fix" it by reading the registration here, which would add a Firestore
    // read to every My Team render for every coach.
    card_total_cents: due > 0 ? chargeCents(leagueId, due) : 0,
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

  // QUOTE IT, and hand the coach their OWN registration id so the embedded
  // card form on the page can charge it.
  //
  // This used to POST to /api/square-checkout and return a Square hosted
  // Payment Link. That link recorded nothing anybody reads: square-checkout
  // wrote card.initiated_at on the registration and stopped, no code path
  // reads that field, and there is no Square webhook in this codebase. So a
  // coach who paid stayed unpaid on the Payments tab, kept being chased by
  // /api/admin-payment-reminders for money they had already sent, and got no
  // receipt. On 2026-08-20 all eleven Island team rows sat at amount_due 795
  // with no amount_paid key at all and all ten registrations carried
  // payment: null. And because each link was minted with crypto.randomUUID()
  // as its idempotency key, a second tap minted a second link and Square took
  // a second $819.05.
  //
  // The identity work above is UNCHANGED and is the whole point of this route:
  // the team comes from the caller's own captain claim and the registration
  // comes from that team's ledger row. Nothing about which team, and nothing
  // about the amount, is taken from the client. The id returned below is
  // therefore only ever the caller's own.
  const regSnap = await getAdminDb()
    .doc(
      `leagues/${leagueId}/form_submissions/team_registration/items/${registrationId}`,
    )
    .get();
  if (!regSnap.exists) {
    // Live data proves this happens: leagues/island/team_payments carries a
    // row whose registration_id points at a document that does not exist.
    return NextResponse.json(
      {
        error:
          "We couldn't find your registration. Please contact the league office.",
      },
      { status: 404 },
    );
  }

  // min() so the quote can never exceed what the ledger says is owed. In
  // practice the two always agree by the time a coach gets here, because
  // cardBlockReason refuses any team whose amount_due differs from feeFor
  // before a card is ever shown. Kept as a ceiling on the QUOTE only: this
  // number is what the coach reads, and a quote above the recorded balance
  // would be the one number on the screen he could prove wrong.
  const payable = Math.min(feeFor(leagueId, regSnap.data() ?? {}), due);
  const totalCents = chargeCents(leagueId, payable);
  return NextResponse.json({
    ok: true,
    registrationId,
    fee_dollars: payable,
    surcharge_cents: totalCents - Math.round(payable * 100),
    total_cents: totalCents,
  });
}
