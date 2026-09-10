// POST /api/admin-merch-payment — record a shirt order as paid, or undo it.
//
// WHY THIS EXISTS. Mike, 2026-09-10: "is there a way to know if Venmo or Zelle
// went through on the site without looking at Venmo or Zelle?"
//
// The honest answer is no, and it always will be. Venmo has no API for a
// personal account and Zelle has none at all, so nothing the site does can
// watch a peer-to-peer transfer land. Somebody who saw the money has to say so.
//
// The real problem was that they COULD NOT say so. The card path writes
// payment.status on the order and nothing else ever did, so every Venmo and
// Zelle shirt sat unpaid for good: 29 of them on 2026-09-10, and the store
// report's "owed" figure could only ever climb. This is the missing half.
//
// Deliberately the same shape as /api/admin-clinic-payment and the block
// /api/square-pay writes, field for field, so everything that asks "has this
// been paid for" keeps asking one question of one field.
//
// Body: { leagueId, id, action: "paid" | "clear", method?, note? }

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
// Card is absent on purpose: a card order is settled by Square, and marking one
// paid by hand here would paper over a payment that never happened.
const METHODS = new Set(["venmo", "zelle", "cash", "check"]);

export async function POST(req: Request) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(m[1]!);
  } catch {
    return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const leagueId = typeof body.leagueId === "string" ? body.leagueId : "";
  const id = typeof body.id === "string" ? body.id : "";
  if (!ID_RE.test(leagueId) || !ID_RE.test(id)) {
    return NextResponse.json({ error: "leagueId and id are required." }, { status: 400 });
  }
  // FULL ADMIN, not a scope, matching /api/admin-clinic-payment. Recording
  // money is the one thing a scoped helper should not be able to do on their
  // own, and there is no "forms" scope to hide behind.
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[leagueId];
  if (claim !== "admin") {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  const action = body.action === "clear" ? "clear" : "paid";
  const method =
    typeof body.method === "string" && METHODS.has(body.method.toLowerCase())
      ? body.method.toLowerCase()
      : "venmo";

  const db = getAdminDb();
  const ref = db.doc(`leagues/${leagueId}/form_submissions/merch_order/items/${id}`);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "That order no longer exists." }, { status: 404 });
  }
  const data = snap.data() ?? {};
  const existing = (data.payment ?? {}) as Record<string, unknown>;

  if (action === "clear") {
    // A card payment is Square's record, not ours. Clearing it here would say a
    // charge that really happened did not, and the money would still be in the
    // account. Refunds happen in Square.
    if (existing.method === "card") {
      return NextResponse.json(
        { error: "This order was paid by card. Refund it in Square, then clear it here." },
        { status: 409 },
      );
    }
    // update(), NOT set(..., {merge:true}). A merge deep-merges the map, so
    // amount_cents, method and paid_at survive under a status of "unpaid" and
    // the office reads UNPAID next to $30, Venmo and a payment date on the one
    // screen whose job is answering whether somebody has paid.
    await ref.update({
      payment: {
        status: "unpaid",
        cleared_at: new Date().toISOString(),
        cleared_by_uid: decoded.uid,
        cleared_by_email: decoded.email ?? null,
      },
      payment_status: "unpaid",
    });
  } else {
    if (existing.status === "paid" || data.payment_status === "paid") {
      return NextResponse.json(
        { error: "This order is already recorded as paid." },
        { status: 409 },
      );
    }
    // The amount the shopper was actually quoted, off the order itself, so the
    // manual path and the card path can never disagree about the price.
    const amount = Number(data.amount_due ?? 0) || 0;
    await ref.set(
      {
        payment: {
          status: "paid",
          method,
          amount_cents: Math.round(amount * 100),
          fee_dollars: amount,
          // No surcharge: Venmo, Zelle, a cheque and cash cost the league
          // nothing, which is why the store quotes them at the flat price.
          surcharge_cents: 0,
          paid_at: new Date().toISOString(),
          recorded_by_uid: decoded.uid,
          recorded_by_email: decoded.email ?? null,
          ...(typeof body.note === "string" && body.note.trim()
            ? { note: body.note.trim() }
            : {}),
        },
        // Written too, because the store report and the CSV read either field
        // and older rows only ever had this one.
        payment_status: "paid",
      },
      { merge: true },
    );
  }

  await db.collection(`leagues/${leagueId}/audit`).add({
    kind: "merch_payment",
    order_id: id,
    action,
    method: action === "paid" ? method : null,
    by_uid: decoded.uid,
    by_email: decoded.email ?? null,
    at: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true, action });
}
