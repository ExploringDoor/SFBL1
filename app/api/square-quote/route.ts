// POST /api/square-quote — what a given registration will be charged, so the
// payment screen can show the number BEFORE the coach taps Pay now.
//
// Adam caught this mid-test: the embedded card form asked for a card and said
// "Pay now" without ever displaying an amount. For a $495 team fee that is how
// you earn chargebacks.
//
// Read-only. Charges nothing, creates nothing. The amount is computed by the
// same feeFor/chargeCents used by /api/square-pay, so the quote and the charge
// cannot drift apart.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { parseHost, resolveTenant } from "@/lib/tenants";
import { chargeCents, feeFor } from "@/lib/square";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const tenant = await resolveTenant(parseHost(host));
  const leagueId = tenant?.id ?? null;
  if (!leagueId || !/^[a-z0-9_-]+$/.test(leagueId)) {
    return NextResponse.json({ error: "Unknown league" }, { status: 400 });
  }

  let body: { registrationId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const registrationId =
    typeof body.registrationId === "string" ? body.registrationId : "";
  // Allow-listed: this string becomes part of a Firestore path.
  const PAYABLE_KINDS = new Set([
    "team_registration",
    "clinic_registration",
    // COYBL takes card for its own tournaments and its baseball orders.
    "tournament_registration",
    "baseball_order",
    "merch_order",
  ]);
  const kind =
    typeof (body as { kind?: unknown }).kind === "string" &&
    PAYABLE_KINDS.has((body as { kind: string }).kind)
      ? (body as { kind: string }).kind
      : "team_registration";
  if (!registrationId || !/^[A-Za-z0-9_-]+$/.test(registrationId)) {
    return NextResponse.json(
      { error: "registrationId required" },
      { status: 400 },
    );
  }

  const snap = await getAdminDb()
    .doc(
      `leagues/${leagueId}/form_submissions/${kind}/items/${registrationId}`,
    )
    .get();
  if (!snap.exists) {
    return NextResponse.json(
      { error: "Registration not found" },
      { status: 404 },
    );
  }

  const fee = feeFor(leagueId, snap.data() ?? {}, kind);
  const total = chargeCents(leagueId, fee);
  const surchargeCents = total - fee * 100;
  return NextResponse.json({
    fee_dollars: fee,
    surcharge_cents: surchargeCents,
    total_cents: total,
    // Derived from the actual amounts rather than a stored constant. Island's
    // surcharge is Square's real cost, so the percentage differs per fee tier
    // and quoting a fixed number here would be wrong (and, in New York,
    // wrong in the direction that carries a penalty).
    surcharge_pct: Math.round((surchargeCents / (fee * 100)) * 10000) / 100,
  });
}
