// POST /api/square-checkout — start a Square hosted checkout for a team's
// registration. Reads the registration's amount server-side (never trusts a
// client amount), adds the 3.25% card surcharge Doug asked for, creates a
// Square Payment Link, and returns its URL for the browser to redirect to.
//
// Square credentials come from env (Vercel), NEVER the repo:
//   SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, SQUARE_ENV (sandbox|production)
// When they're absent the endpoint degrades gracefully (503) so the form can
// fall back to check/Venmo. Money lands in the league's own Square account.

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

// 3.25% processing fee, passed to the payer (per Doug). Card only.
const CARD_SURCHARGE = 0.0325;
const SQUARE_VERSION = "2025-01-23";

export async function POST(req: Request) {
  const leagueId = req.headers.get("x-tenant-id");
  if (!leagueId || !/^[a-z0-9_-]+$/.test(leagueId)) {
    return NextResponse.json({ error: "Unknown league" }, { status: 400 });
  }

  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!token || !locationId) {
    return NextResponse.json(
      { error: "Card payment isn't set up yet — please pay by check or Venmo." },
      { status: 503 },
    );
  }

  let body: { registrationId?: unknown };
  try {
    body = (await req.json()) as { registrationId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const registrationId =
    typeof body.registrationId === "string" ? body.registrationId : "";
  if (!registrationId || !/^[A-Za-z0-9_-]+$/.test(registrationId)) {
    return NextResponse.json({ error: "registrationId required" }, { status: 400 });
  }

  const db = getAdminDb();
  const snap = await db
    .doc(`leagues/${leagueId}/registrations/${registrationId}`)
    .get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Registration not found" }, { status: 404 });
  }
  const data = snap.data()!;
  const fee = Number(data.fee ?? 0);
  if (!(fee > 0)) {
    return NextResponse.json({ error: "Invalid registration amount" }, { status: 400 });
  }

  const amountCents = Math.round(fee * (1 + CARD_SURCHARGE) * 100);
  const teamName = String((data.team as { name?: string })?.name ?? "Team");

  const base =
    process.env.SQUARE_ENV === "production"
      ? "https://connect.squareup.com"
      : "https://connect.squareupsandbox.com";

  let res: Response;
  try {
    res = await fetch(`${base}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        "Square-Version": SQUARE_VERSION,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        quick_pay: {
          name: `COYBL 2027 Registration — ${teamName}`,
          price_money: { amount: amountCents, currency: "USD" },
          location_id: locationId,
        },
      }),
    });
  } catch (err) {
    console.error("[square-checkout] network error", err);
    return NextResponse.json(
      { error: "Couldn't reach the card processor. Try again or pay by check/Venmo." },
      { status: 502 },
    );
  }

  if (!res.ok) {
    console.error("[square-checkout] Square error", res.status, await res.text().catch(() => ""));
    return NextResponse.json(
      { error: "Couldn't start card payment. Try again or pay by check/Venmo." },
      { status: 502 },
    );
  }

  const json = (await res.json()) as { payment_link?: { url?: string } };
  const url = json.payment_link?.url;
  if (!url) {
    return NextResponse.json({ error: "No checkout URL returned." }, { status: 502 });
  }

  // Note that card payment was started (amount includes the surcharge).
  await db
    .doc(`leagues/${leagueId}/registrations/${registrationId}`)
    .set(
      { card: { initiated_at: new Date().toISOString(), amount_cents: amountCents } },
      { merge: true },
    );

  return NextResponse.json({ url, amount_cents: amountCents });
}
