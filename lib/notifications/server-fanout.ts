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

/** What actually went out.
 *
 * Callers that report delivery back to a human must not infer success from
 * "the fetch did not throw". This function catches its own errors, so it
 * never throws, and send-notification answers 200 with sent: 0 whenever the
 * league has no matching tokens, which is every league whose deployment has
 * no NEXT_PUBLIC_FIREBASE_VAPID_KEY. The Rain Out Day panel reported "push
 * sent" on exactly that path for a full season. Callers that genuinely fire
 * and forget (captain-submit, captain-schedule) can keep ignoring this.
 *
 * ok:false means the request was rejected: a 403 from the role gate in
 * /api/send-notification, a 400 from category or url validation, or a
 * network failure. That is NOT the same as ok:true with sent:0, which means
 * the send worked and nobody was subscribed. Anything that shows this to a
 * human has to keep the two apart, or it swaps one wrong answer for another. */
export interface FanoutResult {
  /** The send-notification call completed and was accepted. */
  ok: boolean;
  /** Devices FCM accepted the message for. 0 is a normal answer. */
  sent: number;
  /** Subscribed tokens that matched the filters before sending. */
  total: number;
}

export async function fanoutPush(opts: FanoutOpts): Promise<FanoutResult> {
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
    const res = await fetch(`${origin}/api/send-notification`, {
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
    const data = (await res.json().catch(() => null)) as {
      sent?: number;
      total?: number;
    } | null;
    if (!res.ok || !data) {
      console.warn(
        `[server-fanout] push rejected (category=${category}, status=${res.status})`,
      );
      return { ok: false, sent: 0, total: 0 };
    }
    return {
      ok: true,
      sent: Number(data.sent ?? 0),
      total: Number(data.total ?? 0),
    };
  } catch (e) {
    console.warn(
      `[server-fanout] push failed (category=${category}):`,
      e instanceof Error ? e.message : e,
    );
    return { ok: false, sent: 0, total: 0 };
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
