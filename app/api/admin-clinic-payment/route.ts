// POST /api/admin-clinic-payment — record a College Clinic place as paid, or
// undo it.
//
// WHY THIS EXISTS. The cap counts payment.status === "paid" ON THE SUBMISSION.
// The page's "N places left" counts the same field. Until this route, only
// /api/square-pay ever wrote it, and the payment screen RECOMMENDS Venmo. So
// every family who paid the way the site told them to consumed no place at
// all, no control anywhere in the admin could make them consume one, and the
// clinic would have oversold by exactly the number of people who followed the
// recommendation.
//
// WHY NOT PaymentQuickRecord / /api/admin-team-payment. Both were checked
// first. That control posts to admin-team-payment with target "team", which
// writes team_payments/{teamId}: a TEAM ledger row, keyed on a team a clinic
// registration does not have, and it never touches the submission. Reusing it
// would have written a phantom $175 team AND still not consumed a place. There
// is no reachable path from that route to form_submissions, by design, so the
// honest reuse is the SHAPE of the payment block, which this copies exactly
// from square-pay, not the route.
//
// NOT the team ledger and NOT league_payments either. league_payments is keyed
// on roster players, and a clinic registrant is not on any roster; using it
// would invent 40 phantom players instead of 40 phantom teams. The submission
// IS the clinic ledger, and the College Clinic tab is where it is read.
//
// Body: { leagueId, id, action: "paid" | "clear", method?, note? }
//
// Clinic-only by construction: the collection path is hardcoded, and
// form_submissions/clinic_registration exists on Island alone. No other
// tenant's payment path is reachable from this file.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { feeFor } from "@/lib/fees";
import { CLINIC } from "@/lib/clinic";
import { paidClinicPlaces } from "@/lib/clinic-count";

export const runtime = "nodejs";

const METHODS = new Set(["venmo", "check", "cash", "other"]);
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

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
    id?: unknown;
    action?: unknown;
    method?: unknown;
    note?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const leagueId = typeof body.leagueId === "string" ? body.leagueId : "";
  const id = typeof body.id === "string" ? body.id : "";
  const action = body.action === "clear" ? "clear" : "paid";
  const method =
    typeof body.method === "string" && METHODS.has(body.method.toLowerCase())
      ? body.method.toLowerCase()
      : "venmo";
  if (!leagueId || !ID_RE.test(leagueId)) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: "valid id required" }, { status: 400 });
  }
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[
    leagueId
  ];
  if (claim !== "admin") {
    return NextResponse.json({ error: "not admin" }, { status: 403 });
  }

  const db = getAdminDb();
  const ref = db.doc(
    `leagues/${leagueId}/form_submissions/clinic_registration/items/${id}`,
  );
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "registration not found" }, { status: 404 });
  }
  const data = snap.data() ?? {};
  const existing = (data.payment ?? {}) as { status?: string; method?: string };

  if (action === "clear") {
    // A CARD PAYMENT IS NOT OURS TO UNDO. Square has the money and the parent
    // has a receipt. Clearing the flag here would make the site say a charge
    // that really happened did not, and would silently hand the place to
    // someone else. Refunds happen in Square.
    if (existing.method === "card") {
      return NextResponse.json(
        {
          error:
            "This place was paid by card. Refund it in Square, then clear it here.",
        },
        { status: 409 },
      );
    }
    // update(), NOT set(..., {merge:true}). A merge deep-merges the map, so
    // amount_cents, method and paid_at from the original write survive under a
    // status of "unpaid". The office then reads a row saying UNPAID next to
    // $175.00, Venmo, and a payment date, on the one page whose job is
    // answering whether a family has paid, and stops chasing the money.
    // Assigning the whole map replaces it.
    await ref.update({
      payment: {
        status: "unpaid",
        cleared_at: new Date().toISOString(),
        cleared_by_uid: decoded.uid,
        cleared_by_email: decoded.email ?? null,
      },
    });
  } else {
    if (existing.status === "paid") {
      return NextResponse.json(
        { error: "This place is already recorded as paid." },
        { status: 409 },
      );
    }
    // feeFor, not a literal, so the manual path and the card path can never
    // disagree about the price. NOTE that feeFor honours LEAGUE_TEST_FEE
    // before anything else, so recording a real Venmo while that env var is
    // set on the project would write $1 against a $175 place. Do not leave it
    // set (see the deploy checks).
    const fee = feeFor(leagueId, data as Record<string, unknown>, "clinic_registration");
    // The SAME shape /api/square-pay writes, field for field, so everything
    // that asks "is this place taken" keeps asking one question of one field.
    // No surcharge: Venmo, a cheque and cash cost the league nothing, which is
    // why the payment screen quotes them at the flat fee.
    await ref.set(
      {
        payment: {
          status: "paid",
          method,
          amount_cents: fee * 100,
          fee_dollars: fee,
          surcharge_cents: 0,
          paid_at: new Date().toISOString(),
          recorded_by_uid: decoded.uid,
          recorded_by_email: decoded.email ?? null,
          ...(typeof body.note === "string" && body.note.trim()
            ? { note: body.note.trim() }
            : {}),
        },
      },
      { merge: true },
    );
  }

  await db.collection(`leagues/${leagueId}/audit`).add({
    kind: "clinic_payment",
    by_uid: decoded.uid,
    by_email: decoded.email ?? null,
    target_kind: "clinic_registration",
    target_id: id,
    action,
    method: action === "paid" ? method : null,
    at: new Date().toISOString(),
  });

  // Returned, not enforced. Recording money Mike already has in his Venmo
  // account is not the moment to refuse: the place is sold whatever this
  // number says, and a ledger that refuses to record reality is a ledger that
  // lies. The UI shows the count so he can SEE he is at 41 and decide.
  const paid_places = await paidClinicPlaces(db, leagueId).catch(() => -1);
  return NextResponse.json({ ok: true, paid_places, capacity: CLINIC.capacity });
}