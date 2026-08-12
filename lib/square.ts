// Shared Square helpers for COYBL registration payments.
//
// Credentials live in Vercel env, NEVER the repo:
//   SQUARE_ACCESS_TOKEN            (secret — server only)
//   SQUARE_APP_ID                  (public identifier, sq0idp-… — needed by
//                                   the embedded card form on the client)
//   SQUARE_ENV  sandbox|production (defaults to sandbox)
//   SQUARE_LOCATION_ID             (optional — auto-detected from the token)
//
// The amount a coach is charged is ALWAYS computed here from the saved
// registration, never accepted from the browser.

import { createHash } from "node:crypto";
import { chargeCents, feeFor } from "@/lib/fees";

export {
  CARD_SURCHARGE,
  chargeCents,
  feeFor,
  nyCompliantTotal,
  surchargeFor,
} from "@/lib/fees";

export const SQUARE_VERSION = "2025-01-23";


export function squareEnv(): "production" | "sandbox" {
  return process.env.SQUARE_ENV === "production" ? "production" : "sandbox";
}

export function squareApiBase(): string {
  return squareEnv() === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

// Test-mode fee, for end-to-end checkout tests without pushing $495 through a
// real card just to refund it.
//
// Env-driven ON PURPOSE. This used to be a hardcoded constant, which meant the
// only way to test was to edit the source, deploy, and then remember to change
// it back. Forgetting that ships a live registration page charging a dollar.
// Now: set COYBL_TEST_FEE=1 in Vercel to test, delete the var to go back to
// real fees, and the code that gets deployed always means real money.
//
// Only the CARD amount is affected. The team_payments ledger always records
// what a team genuinely owes, so paid/unpaid tracking stays truthful either
// way.
// LEAGUE_TEST_FEE is the tenant-neutral name; COYBL_TEST_FEE still works so
// COYBL's existing Vercel config keeps functioning. Each league is its own
// Vercel project, so setting this on one cannot affect another.
//
// Worth knowing WHY this matters more than it looks: Square stopped returning
// processing fees on refunds in April 2023. Testing with a real $795 team fee
// and refunding it costs the league $24.05 it never gets back. Set
// LEAGUE_TEST_FEE=1 instead, run the card through at $1.33, and the whole cost
// of a full end-to-end test is 34 cents.




// Resolve a Square location from the access token when SQUARE_LOCATION_ID
// isn't set. Picks the first ACTIVE location (falls back to the first) and
// caches per token+base so we only hit /v2/locations once per server boot.
const locationCache = new Map<string, string>();

export async function resolveLocationId(
  token: string,
  base: string = squareApiBase(),
): Promise<string | null> {
  if (process.env.SQUARE_LOCATION_ID) return process.env.SQUARE_LOCATION_ID;

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
      console.error("[square] locations lookup failed", res.status);
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
    console.error("[square] locations lookup error", err);
    return null;
  }
}

/** Square's hard cap on `idempotency_key`. Exceed it and CreatePayment is
 *  rejected outright with "Field must not be greater than 45 length" — the
 *  payment never even reaches the card. */
export const SQUARE_IDEMPOTENCY_MAX = 45;

/**
 * The idempotency key for one card attempt on one registration.
 *
 * Two jobs, and they pull against each other. It has to be STABLE so a
 * double-click cannot charge a coach twice, and it has to CHANGE between card
 * attempts so a declined card does not weld the registration to that decline
 * forever (Square replays the stored result for a repeated key, so a second
 * card would silently receive the first card's failure).
 *
 * Keying on the registration plus the single-use card nonce satisfies both.
 * The readable form of that, `reg-${registrationId}-${sourceId.slice(-24)}`,
 * ran to 49 characters against a 20-character Firestore id and broke every
 * card payment on every tenant. A digest is the fix that cannot regress: it is
 * the same length whatever the inputs are.
 */
export function idempotencyKey(
  registrationId: string,
  sourceId: string,
): string {
  return createHash("sha256")
    .update(`${registrationId}:${sourceId}`)
    .digest("hex")
    .slice(0, SQUARE_IDEMPOTENCY_MAX);
}
