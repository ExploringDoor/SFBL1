// Server-side helper: fire a push by calling /api/send-notification
// from another API route (e.g. captain-submit, captain-schedule).
//
// The send-notification endpoint already has the full 9-step filter
// chain + dead-token prune + push log + multi-tenant guards. Routes
// that need to fan out a push compose the payload + call this helper;
// they don't reimplement filter/send logic. Mirrors DVSL pattern of
// every trigger site doing `fetch('/api/send-notification', { ... })`.
//
// Auth: forwards the caller's bearer token. The route must already be
// past auth/claim checks before calling this — send-notification
// re-verifies the token + claim, so a forged token would fail there
// even if our caller's logic missed it.
//
// Errors: fire-and-forget by default. Push delivery is non-critical
// vs the underlying mutation (game submitted, schedule edited). We
// log warnings so failures show in /push_log + server console without
// blocking the user's primary action.

import type { NotificationCategory } from "./categories";

interface FanoutOpts {
  // Inferred from the calling Request when present, else from
  // VERCEL_URL. Both work; the request URL is more reliable when
  // Next is running locally with custom domains.
  origin: string;
  bearerToken: string;
  leagueId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  team?: string;
  teams?: string[];
  url?: string;
  adminOnly?: boolean;
  rosterOnly?: boolean;
  excludeToken?: string;
  excludePlayerIds?: string[];
  sourceId?: string;
  imageDataUrl?: string;
}

export async function fanoutPush(opts: FanoutOpts): Promise<void> {
  const {
    origin,
    bearerToken,
    leagueId,
    category,
    title,
    body,
    ...rest
  } = opts;
  try {
    await fetch(`${origin}/api/send-notification`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({
        leagueId,
        category,
        title,
        body,
        ...rest,
      }),
    });
  } catch (e) {
    console.warn(
      `[server-fanout] push failed (category=${category}):`,
      e instanceof Error ? e.message : e,
    );
  }
}

/** Pull the absolute origin from a Request (preferred) or Vercel env.
 *
 * IMPORTANT — `req.url` is preferred over `VERCEL_URL`. Vercel sets
 * VERCEL_URL to the project's *.vercel.app hostname, which is NOT in
 * `LEAGUEENGINE_APEX_DOMAINS`. If we fetch sibling APIs via that
 * origin, the middleware tenant-resolver runs against an unknown
 * subdomain and 404s the request before it reaches the API route.
 *
 * `req.url` carries the actual public host the user hit (e.g.
 * `https://sfbl.leagueengine.com`), which DOES resolve to a tenant.
 * VERCEL_URL is only a fallback for when `req.url` is unusable. */
export function originFromRequest(req: Request): string {
  try {
    return new URL(req.url).origin;
  } catch {
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
    return "http://localhost:3000";
  }
}
