// POST /api/square-checkout — start a Square hosted checkout for a team's
// registration. Reads the registration's amount server-side (never trusts a
// client amount), adds the 3.25% card surcharge Doug asked for, creates a
// Square Payment Link, and returns its URL for the browser to redirect to.
//
// Square credentials come from env (Vercel), NEVER the repo:
//   SQUARE_ACCESS_TOKEN          (required)
//   SQUARE_ENV  sandbox|production (defaults to sandbox)
//   SQUARE_LOCATION_ID           (optional — auto-detected from the token if unset)
// When the access token is absent the endpoint degrades gracefully (503) so the
// form can fall back to check/Venmo. Money lands in the league's own account.

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
  if (!token) {
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

  // Location ID is optional in env — if it's not set we ask Square for the
  // account's locations and use the first active one (cached). Most leagues
  // have a single location, so this "just works" from the access token alone.
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

// Resolve a Square location from the access token when SQUARE_LOCATION_ID isn't
// set. Picks the first ACTIVE location (falls back to the first one) and caches
// the result per token+base so we only hit /v2/locations once per server boot.
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
