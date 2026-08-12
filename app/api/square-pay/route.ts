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
import { sendEmail, notifyAddress } from "@/lib/email/send";
import { paymentReceiptEmail, officePaymentEmail } from "@/lib/email/templates";
import {
  SQUARE_VERSION,
  chargeCents,
  feeFor,
  idempotencyKey,
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
        // Keyed on the registration AND this card nonce.
        //
        // It used to be the registration id alone, which stops a double-click
        // but also welds the coach to their first attempt: after a decline,
        // Square replays the SAME failed result for every later try, so a
        // second card can never be used for that registration. A source_id is
        // single-use and unique per card entry, so this is still stable across
        // a retry of the SAME submission (the double-click case) while a fresh
        // card attempt gets a fresh key.
        //
        // Hashed because Square caps idempotency_key at 45 characters and
        // rejects the whole payment with "Field must not be greater than 45
        // length" otherwise. The readable version of this
        // (`reg-${registrationId}-${sourceId.slice(-24)}`) came to 49 with a
        // 20-character Firestore id and broke every card payment on every
        // tenant. A digest is a fixed 45 no matter how long the inputs get,
        // which the string form could never promise.
        idempotency_key: idempotencyKey(registrationId, sourceId),
        amount_money: { amount: amountCents, currency: "USD" },
        location_id: locationId,
        // Square emails its own branded receipt when it knows who paid. This
        // costs nothing and was simply never passed, which is half the reason
        // a coach could pay $819 and receive nothing at all.
        ...(typeof data.email === "string" && data.email.includes("@")
          ? { buyer_email_address: data.email.trim() }
          : {}),
        // Tenant id, not a hardcoded "COYBL 2027" — this string is what
        // shows on the Square receipt and in the seller dashboard.
        note: `${leagueId} registration: ${String(data.team_name ?? "Team")}`,
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

  // THE CARD HAS ALREADY BEEN CHARGED. Everything from here is bookkeeping,
  // and none of it may surface to the coach as a failure.
  //
  // This write used to be unguarded. A transient Firestore error, or this
  // function timing out after the locations lookup plus the payment call,
  // threw AFTER the money moved — the coach saw "Something went wrong taking
  // the payment. Please try again.", with the button re-enabled and no record
  // anywhere that they had paid. There is no Square webhook in this codebase
  // to reconcile it out of band, so it would surface as an angry phone call.
  try {
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
  } catch (err) {
    // Loud, because this is money taken that the office cannot see. The
    // Square dashboard is the source of truth for reconciling it.
    console.error(
      "[square-pay] CHARGED BUT NOT RECORDED — reconcile by hand.",
      { leagueId, registrationId, squarePaymentId: payment.id ?? null, amountCents },
      err,
    );
  }

  // Mark the team PAID in the league's own ledger, which is what the admin
  // Payments tab actually reads. Without this a coach could pay by card and
  // still show as unpaid to the office, who would chase them for money they
  // had already sent. Best-effort: the card has been charged either way, so a
  // ledger hiccup must not turn into an error the coach sees.
  //
  // The row is keyed on the assigned team when there is one, and on the
  // REGISTRATION when there is not. It used to be written only when
  // assigned_team_id was already set, which is a COYBL-shaped assumption: COYBL
  // auto-provisions a team at registration, Island assigns by hand days later.
  // So an Island coach who registered and paid in one sitting produced no
  // ledger row at all, and the office's Payments tab showed nothing collected
  // while the money sat in Square. Adam found it minutes after the first
  // successful live payment. Worse, admin-payment-reminders reads a missing row
  // as "owes money", so a team that had paid could be chased for it.
  //
  // registration_id is carried on the row either way, so assignment can
  // reconcile the two without a second source of truth.
  try {
    const teamId =
      typeof data.assigned_team_id === "string" ? data.assigned_team_id : "";
    const ledgerId = teamId || `reg-${registrationId}`;
    {
      await db.doc(`leagues/${leagueId}/team_payments/${ledgerId}`).set(
        {
          team_name: String(data.team_name ?? ""),
          registration_id: registrationId,
          // False when the row is keyed on the registration because no team
          // exists yet. Assignment flips it.
          team_assigned: Boolean(teamId),
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

  // Receipt to the coach, and a heads-up to the office.
  //
  // Until now NOTHING was sent when a card was charged — not to the payer, not
  // to the league. A coach paid the largest amount they will ever pay this
  // site and had no proof of it in their inbox, and the office learned about
  // it only by opening Square. Adam asked for this directly (2026-08-12).
  //
  // Awaited, not fire-and-forget: this runs after the charge, and unawaited
  // work on a serverless function dies with the response. Wrapped, because the
  // card has ALREADY been charged and an email failure must never surface to
  // the coach as a failed payment.
  try {
    const teamName = String(data.team_name ?? "your team");
    const payerEmail =
      typeof data.email === "string" && data.email.includes("@")
        ? data.email.trim()
        : "";

    if (payerEmail) {
      const m = paymentReceiptEmail({
        firstName: String(data.manager_first_name ?? ""),
        team: teamName,
        feeCents: fee * 100,
        totalCents: amountCents,
        receiptUrl: payment.receipt_url ?? null,
      });
      await sendEmail({
        to: payerEmail,
        subject: m.subject,
        html: m.html,
        replyTo: notifyAddress() ?? undefined,
      });
      await ref.set({ receipt_email_sent: true }, { merge: true });
    }

    const notify = notifyAddress();
    if (notify) {
      const m = officePaymentEmail({
        team: teamName,
        firstName: String(data.manager_first_name ?? ""),
        lastName: String(data.manager_last_name ?? ""),
        payerEmail,
        feeCents: fee * 100,
        totalCents: amountCents,
        receiptUrl: payment.receipt_url ?? null,
      });
      await sendEmail({
        to: notify,
        subject: m.subject,
        html: m.html,
        replyTo: payerEmail || undefined,
      });
    }
  } catch (err) {
    // Money moved and is recorded; only the notification failed.
    console.error("[square-pay] payment recorded but receipt email failed", {
      leagueId,
      registrationId,
      squarePaymentId: payment.id ?? null,
    }, err);
    await ref
      .set({ receipt_email_sent: false }, { merge: true })
      .catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    amount_cents: amountCents,
    receipt_url: payment.receipt_url ?? null,
  });
}
