// GET /api/square-config — the two PUBLIC identifiers the embedded Square
// card form needs in the browser: the application id and the location id.
//
// Neither is a secret. The application id (sq0idp-…) is designed to ship to
// the client, and the location id is a public account identifier. The access
// token never leaves the server — it is used here only to look the location
// up, so nobody has to hand-copy it into another env var.
//
// Returns { configured: false } rather than an error when Square isn't set
// up, so the payment UI can quietly fall back to Venmo and check.
//
// GET /api/square-config?check=1 — SETUP DIAGNOSTIC.
//
// Why this exists. "configured: true" used to mean only that two env vars were
// non-empty. Set SQUARE_LOCATION_ID by hand and resolveLocationId returns it
// without ever calling Square (lib/square.ts), so the access token was never
// once exercised before a coach's card hit /v2/payments. Island went live in
// exactly that state and the first real payment came back "This request could
// not be authorized." — the token and the environment did not match, and
// nothing upstream could have told us.
//
// The diagnostic answers the question the config endpoint could not: does this
// token actually authorize, against the environment this deployment is set to?
// It returns booleans and Square's own error CODE. No secret is echoed, not
// even in part.

import { NextResponse } from "next/server";
import { resolveLocationId, squareApiBase, squareEnv, SQUARE_VERSION } from "@/lib/square";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Square's own naming: sandbox app ids are prefixed, production ones are not. */
function appIdEnv(appId: string): "sandbox" | "production" | "unknown" {
  if (appId.startsWith("sandbox-")) return "sandbox";
  if (appId.startsWith("sq0idp-")) return "production";
  return "unknown";
}

// One outbound call per minute is plenty for a setup check, and this endpoint
// is public. Without the cache anyone could make us hammer Square.
let checkCache: { at: number; body: unknown } | null = null;
const CHECK_TTL_MS = 60_000;

async function runCheck(token: string, appId: string) {
  const env = squareEnv();
  const base = squareApiBase();
  const pinnedLocation = process.env.SQUARE_LOCATION_ID ?? null;

  const result: Record<string, unknown> = {
    env,
    appIdEnvironment: appIdEnv(appId),
    // The single most common setup mistake: Square's dashboard shows Sandbox
    // and Production credentials on near-identical tabs.
    appIdMatchesEnv: appIdEnv(appId) === env,
    locationIdPinnedByEnvVar: Boolean(pinnedLocation),
  };

  let res: Response;
  try {
    res = await fetch(`${base}/v2/locations`, {
      headers: {
        "Square-Version": SQUARE_VERSION,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
  } catch (err) {
    result.tokenAuthorizes = false;
    result.problem = "Could not reach Square.";
    result.detail = err instanceof Error ? err.message : String(err);
    return result;
  }

  const json = (await res.json().catch(() => ({}))) as {
    locations?: { id?: string; status?: string }[];
    errors?: { code?: string; detail?: string; category?: string }[];
  };

  result.httpStatus = res.status;
  result.tokenAuthorizes = res.ok;

  if (!res.ok) {
    // Square's code is safe to surface and is the whole point of the check.
    result.squareErrorCode = json.errors?.[0]?.code ?? null;
    result.squareErrorDetail = json.errors?.[0]?.detail ?? null;

    // A 401 says only "not valid HERE". It does not say why, and the fixes
    // differ: a Sandbox-instead-of-Production mix-up needs a different token
    // from a different tab, while a truncated paste, a revoked token or an
    // unactivated account need something else entirely. So ask the OTHER
    // environment. If the token authorizes there, the mix-up is proven rather
    // than assumed. Both hosts are Square's own.
    const otherEnv = env === "production" ? "sandbox" : "production";
    const otherBase =
      otherEnv === "production"
        ? "https://connect.squareup.com"
        : "https://connect.squareupsandbox.com";
    try {
      const probe = await fetch(`${otherBase}/v2/locations`, {
        headers: {
          "Square-Version": SQUARE_VERSION,
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });
      result.tokenAuthorizesInOtherEnv = probe.ok;
      result.otherEnvTried = otherEnv;
    } catch {
      result.tokenAuthorizesInOtherEnv = null;
      result.otherEnvTried = otherEnv;
    }

    if (result.tokenAuthorizesInOtherEnv === true) {
      result.problem = `SQUARE_ACCESS_TOKEN is a ${otherEnv.toUpperCase()} token, but SQUARE_ENV is ${env}. Copy the token from the ${env} tab of the app's Credentials page. A ${otherEnv} location id is probably pasted alongside it, so clear SQUARE_LOCATION_ID too.`;
    } else if (
      json.errors?.[0]?.code === "UNAUTHORIZED" ||
      json.errors?.[0]?.category === "AUTHENTICATION_ERROR"
    ) {
      result.problem = `SQUARE_ACCESS_TOKEN is not valid in EITHER environment, so this is not a sandbox mix-up. Likely a partial copy or trailing whitespace, the application SECRET pasted instead of the access token, a token that has since been revoked or regenerated, or a Square account that has not finished activation.`;
    } else {
      result.problem = "Square rejected the credentials.";
    }
    return result;
  }

  const locations = json.locations ?? [];
  result.locationCount = locations.length;
  result.activeLocationCount = locations.filter(
    (l) => l.status === "ACTIVE",
  ).length;

  if (pinnedLocation) {
    // A location id from the wrong environment (or another merchant) passes
    // every check the app makes today, then fails at the moment of payment.
    const known = locations.some((l) => l.id === pinnedLocation);
    result.pinnedLocationBelongsToThisAccount = known;
    if (!known) {
      result.problem = `SQUARE_LOCATION_ID is not a location on this ${env} account. Remove the variable and the app will find the right one on its own.`;
    }
  }

  if (!result.problem && !result.appIdMatchesEnv) {
    result.problem = `SQUARE_APP_ID looks like a ${result.appIdEnvironment} application id, but SQUARE_ENV is ${env}. The card form and the charge would run against different environments.`;
  }

  result.ok = !result.problem;
  return result;
}

export async function GET(req: Request) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const appId = process.env.SQUARE_APP_ID;
  const wantsCheck = new URL(req.url).searchParams.has("check");

  if (wantsCheck) {
    if (!token || !appId) {
      return NextResponse.json(
        {
          ok: false,
          problem: `Missing ${!token ? "SQUARE_ACCESS_TOKEN" : "SQUARE_APP_ID"}.`,
          env: squareEnv(),
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const now = Date.now();
    if (!checkCache || now - checkCache.at > CHECK_TTL_MS) {
      checkCache = { at: now, body: await runCheck(token, appId) };
    }
    return NextResponse.json(checkCache.body, {
      headers: { "cache-control": "no-store" },
    });
  }

  if (!token || !appId) {
    return NextResponse.json(
      { configured: false },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const locationId = await resolveLocationId(token);
  if (!locationId) {
    return NextResponse.json(
      { configured: false },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return NextResponse.json(
    { configured: true, appId, locationId, env: squareEnv() },
    { headers: { "cache-control": "no-store" } },
  );
}
