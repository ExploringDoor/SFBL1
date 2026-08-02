// POST /api/square-checkout — start a Square hosted checkout for a team's
// registration. The amount is computed SERVER-SIDE from the saved submission
// (never trusted from the client), the 3.25% card surcharge Doug asked for is
// added, and a Square Payment Link is created; the browser redirects to it.
//
// Square credentials come from env (Vercel), NEVER the repo:
//   SQUARE_ACCESS_TOKEN            (required)
//   SQUARE_ENV  sandbox|production (defaults to sandbox)
//   SQUARE_LOCATION_ID             (optional — auto-detected from the token)
// With no access token the endpoint degrades gracefully (503) so the form
// keeps offering Venmo/check. Money lands in the league's own Square account.
//
// Adapted from the original (branch coybl-tenant, commit 068e667), which read
// a `registrations` collection and a stored `fee` field. The live registration
// flow writes to form_submissions/team_registration/items and stores NO fee —
// the amount is derived here from the option the coach picked.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { parseHost, resolveTenant } from "@/lib/tenants";

export const runtime = "nodejs";

// 3.25% processing fee, passed to the payer (per Doug). Card only —
// Venmo and check have no surcharge.
const CARD_SURCHARGE = 0.0325;
const SQUARE_VERSION = "2025-01-23";

// 2027 COYBL fees. Mirrors the copy on /team-registration. Kept server-side
// so a tampered client can't invent its own price.
const FEE_WITH_INSURANCE = 495;
const FEE_WITHOUT_INSURANCE = 425;
const USSSA_ADDON = 50;

/** Registration fee in whole dollars, from the submitted answers. */
function feeFor(data: Record<string, unknown>): number {
  const option = String(data.insurance_option ?? "");
  const usssa = String(data.usssa_addon ?? "");
  // option-2 is "we provide our own insurance"; anything else is the
  // league-provides-insurance price, which is also the safe default.
  const base =
    option === "option-2" ? FEE_WITHOUT_INSURANCE : FEE_WITH_INSURANCE;
  return base + (usssa === "yes" ? USSSA_ADDON : 0);
}

export async function POST(req: Request) {
  // Resolve the tenant from the Host, NOT from x-tenant-id: middleware skips
  // /api/* entirely, so that header never reaches an API route. (The original
  // version of this file read the header and would have failed every request
  // with "Unknown league".) Same pattern as /api/league-form.
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

  let body: { registrationId?: unknown };
  try {
    body = (await req.json()) as { registrationId?: unknown };
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

  const fee = feeFor(data);
  const amountCents = Math.round(fee * (1 + CARD_SURCHARGE) * 100);
  const teamName = String(data.team_name ?? "Team");

  const base =
    process.env.SQUARE_ENV === "production"
      ? "https://connect.squareup.com"
      : "https://connect.squareupsandbox.com";

  // Location ID is optional in env — if unset we ask Square for the account's
  // locations and use the first active one (cached). Most leagues have a
  // single location, so this "just works" from the access token alone.
  const locationId =
    process.env.SQUARE_LOCATION_ID ?? (await resolveLocationId(token, base));
  if (!locationId) {
    return NextResponse.json(
      { error: "Couldn't find a Square location for this account." },
      { status: 502 },
    );
  }

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
          name: `COYBL 2027 Registration: ${teamName}`,
          price_money: { amount: amountCents, currency: "USD" },
          location_id: locationId,
        },
      }),
    });
  } catch (err) {
    console.error("[square-checkout] network error", err);
    return NextResponse.json(
      {
        error:
          "Couldn't reach the card processor. Try again, or pay by Venmo or check.",
      },
      { status: 502 },
    );
  }

  if (!res.ok) {
    console.error(
      "[square-checkout] Square error",
      res.status,
      await res.text().catch(() => ""),
    );
    return NextResponse.json(
      {
        error:
          "Couldn't start card payment. Try again, or pay by Venmo or check.",
      },
      { status: 502 },
    );
  }

  const json = (await res.json()) as { payment_link?: { url?: string } };
  const url = json.payment_link?.url;
  if (!url) {
    return NextResponse.json({ error: "No checkout URL returned." }, { status: 502 });
  }

  // Record that card payment was started (amount includes the surcharge) so
  // the office can reconcile it against the Payments tab.
  await ref.set(
    {
      card: {
        initiated_at: new Date().toISOString(),
        amount_cents: amountCents,
        fee_dollars: fee,
      },
    },
    { merge: true },
  );

  return NextResponse.json({ url, amount_cents: amountCents });
}

// Resolve a Square location from the access token when SQUARE_LOCATION_ID
// isn't set. Picks the first ACTIVE location (falls back to the first) and
// caches per token+base so we only hit /v2/locations once per server boot.
const locationCache = new Map<string, string>();
async function resolveLocationId(
  token: string,
  base: string,
): Promise<string | null> {
  const cacheKey = `${base}:${token.slice(-8)}`;
  const cached = locationCache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(`${base}/v2/locations`, {
      headers: {
        "Square-Version": SQUARE_VERSION,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      console.error("[square-checkout] locations lookup failed", res.status);
      return null;
    }
    const json = (await res.json()) as {
      locations?: { id?: string; status?: string }[];
    };
    const locs = json.locations ?? [];
    const chosen = locs.find((l) => l.status === "ACTIVE") ?? locs[0];
    const id = chosen?.id ?? null;
    if (id) locationCache.set(cacheKey, id);
    return id;
  } catch (err) {
    console.error("[square-checkout] locations lookup error", err);
    return null;
  }
}
