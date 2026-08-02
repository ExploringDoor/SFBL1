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

export const SQUARE_VERSION = "2025-01-23";

/** 3.25% card processing fee, passed to the payer (per Doug). Card only —
 *  Venmo and check have no surcharge. */
export const CARD_SURCHARGE = 0.0325;

// 2027 COYBL fees. Mirrors the copy on /team-registration.
const FEE_WITH_INSURANCE = 495;
const FEE_WITHOUT_INSURANCE = 425;
const USSSA_ADDON = 50;

export function squareEnv(): "production" | "sandbox" {
  return process.env.SQUARE_ENV === "production" ? "production" : "sandbox";
}

export function squareApiBase(): string {
  return squareEnv() === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

/** Registration fee in whole dollars, derived from the submitted answers. */
export function feeFor(data: Record<string, unknown>): number {
  const option = String(data.insurance_option ?? "");
  const usssa = String(data.usssa_addon ?? "");
  // option-2 is "we provide our own insurance"; anything else falls back to
  // the league-provides-insurance price, which is the safe default.
  const base =
    option === "option-2" ? FEE_WITHOUT_INSURANCE : FEE_WITH_INSURANCE;
  return base + (usssa === "yes" ? USSSA_ADDON : 0);
}

/** What the card is actually charged, in cents, including the surcharge. */
export function chargeCents(feeDollars: number): number {
  return Math.round(feeDollars * (1 + CARD_SURCHARGE) * 100);
}

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
