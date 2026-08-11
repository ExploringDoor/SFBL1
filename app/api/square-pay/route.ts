// POST /api/square-pay — charge a card for a team registration, using a
// single-use token produced by the EMBEDDED Square card form on the page.
//
// Body: { registrationId, sourceId }
//   sourceId is the nonce Square's Web Payments SDK returns after the coach
//   types their card. Raw card numbers never touch this server.
//
// The amount is computed HERE from the saved registration (fee + the 3.25%
// card surcharge). A client cannot influence what it is charged.
//
// Idempotency: the key is derived from the registration id, so a double-click
// or a retry of the same registration will not double-charge — Square returns
// the original payment instead of creating a second one.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { parseHost, resolveTenant } from "@/lib/tenants";
import {
  SQUARE_VERSION,
  chargeCents,
  feeFor,
  resolveLocationId,
  squareApiBase,
} from "@/lib/square";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // Tenant comes from the Host: middleware skips /api/*, so x-tenant-id
  // never reaches an API route.
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const tenant = await resolveTenant(parseHost(host));
  const leagueId = tenant?.id ?? null;
  if (!leagueId || !/^[a-z0-9_-]+$/.test(leagueId)) {
    return NextResponse.json({ error: "Unknown league" }, { status: 400 });
  }

  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Card payment isn't set up yet — please pay by Venmo or check." },
      { status: 503 },
    );
  }

  let body: { registrationId?: unknown; sourceId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const registrationId =
    typeof body.registrationId === "string" ? body.registrationId : "";
  const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
  if (!registrationId || !/^[A-Za-z0-9_-]+$/.test(registrationId)) {
    return NextResponse.json(
      { error: "registrationId required" },
      { status: 400 },
    );
  }
  if (!sourceId) {
    return NextResponse.json({ error: "sourceId required" }, { status: 400 });
  }

  const db = getAdminDb();
  const ref = db.doc(
    `leagues/${leagueId}/form_submissions/team_registration/items/${registrationId}`,
  );
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json(
      { error: "Registration not found" },
      { status: 404 },
    );
  }
  const data = snap.data() ?? {};

  // Already settled? Don't charge twice.
  if ((data.payment as { status?: string } | undefined)?.status === "paid") {
    return NextResponse.json(
      { error: "This registration is already paid." },
      { status: 409 },
    );
  }

  const fee = feeFor(leagueId, data);
  const amountCents = chargeCents(leagueId, fee);
  const base = squareApiBase();

  const locationId = await resolveLocationId(token, base);
  if (!locationId) {
    return NextResponse.json(
      { error: "Couldn't find a Square location for this account." },
      { status: 502 },
    );
  }

  let res: Response;
  try {
    res = await fetch(`${base}/v2/payments`, {
      method: "POST",
      headers: {
        "Square-Version": SQUARE_VERSION,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_id: sourceId,
        // Same registration => same key => Square will not double-charge.
        idempotency_key: `coybl-reg-${registrationId}`,
        amount_money: { amount: amountCents, currency: "USD" },
        location_id: locationId,
        note: `COYBL 2027 registration: ${String(data.team_name ?? "Team")}`,
      }),
    });
  } catch (err) {
    console.error("[square-pay] network error", err);
    return NextResponse.json(
      {
        error:
          "Couldn't reach the card processor. Try again, or pay by Venmo or check.",
      },
      { status: 502 },
    );
  }

  const json = (await res.json().catch(() => ({}))) as {
    payment?: { id?: string; status?: string; receipt_url?: string };
    errors?: { detail?: string; code?: string }[];
  };

  if (!res.ok) {
    // Square's card errors are the useful ones to show a coach verbatim
    // (declined, expired, wrong CVV); anything else stays generic.
    const detail = json.errors?.[0]?.detail;
    console.error("[square-pay] Square error", res.status, json.errors);
    return NextResponse.json(
      {
        error:
          detail ??
          "That payment didn't go through. Try another card, or pay by Venmo or check.",
      },
      { status: 402 },
    );
  }

  const payment = json.payment ?? {};

  // Record it on the registration so the office can reconcile in the
  // Payments tab without logging into Square.
  await ref.set(
    {
      payment: {
        status: "paid",
        method: "card",
        amount_cents: amountCents,
        fee_dollars: fee,
        surcharge_cents: amountCents - fee * 100,
        square_payment_id: payment.id ?? null,
        receipt_url: payment.receipt_url ?? null,
        paid_at: new Date().toISOString(),
      },
    },
    { merge: true },
  );

  // Mark the team PAID in the league's own ledger, which is what the admin
  // Payments tab actually reads. Without this a coach could pay by card and
  // still show as unpaid to the office, who would chase them for money they
  // had already sent. Best-effort: the card has been charged either way, so a
  // ledger hiccup must not turn into an error the coach sees.
  try {
    const teamId =
      typeof data.assigned_team_id === "string" ? data.assigned_team_id : "";
    if (teamId) {
      await db.doc(`leagues/${leagueId}/team_payments/${teamId}`).set(
        {
          team_name: String(data.team_name ?? ""),
          amount_due: fee,
          amount_paid: amountCents / 100,
          // Structured, not prose. The UI renders "Card · Aug 4" from these;
          // it used to write a sentence into the free-text note, which read
          // like garbage in the table and could not be filtered on.
          method: "card",
          paid_at: new Date().toISOString(),
          square_payment_id: payment.id ?? null,
          // Square's own receipt. Kept on the ledger row so the office can
          // answer "prove I paid" from the Payments tab, without logging in
          // to Square and hunting for the transaction.
          receipt_url: payment.receipt_url ?? null,
        },
        { merge: true },
      );
    }
  } catch (err) {
    console.error("[square-pay] could not update the payment ledger", err);
  }

  return NextResponse.json({
    ok: true,
    amount_cents: amountCents,
    receipt_url: payment.receipt_url ?? null,
  });
}
