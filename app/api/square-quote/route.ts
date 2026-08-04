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
import { CARD_SURCHARGE, chargeCents, feeFor } from "@/lib/square";

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
  if (!registrationId || !/^[A-Za-z0-9_-]+$/.test(registrationId)) {
    return NextResponse.json(
      { error: "registrationId required" },
      { status: 400 },
    );
  }

  const snap = await getAdminDb()
    .doc(
      `leagues/${leagueId}/form_submissions/team_registration/items/${registrationId}`,
    )
    .get();
  if (!snap.exists) {
    return NextResponse.json(
      { error: "Registration not found" },
      { status: 404 },
    );
  }

  const fee = feeFor(snap.data() ?? {});
  const total = chargeCents(fee);
  return NextResponse.json({
    fee_dollars: fee,
    surcharge_cents: total - fee * 100,
    total_cents: total,
    surcharge_pct: CARD_SURCHARGE * 100,
  });
}
