// POST /api/send-notification — fan-out a push to subscribed tokens.
//
// HTTP shell. The actual logic lives in `lib/notifications/send.ts`
// so the cron at /api/pregame-reminder can reuse it without faking
// up a bearer token to call its own sibling endpoint.
//
// Body shape (all matching DVSL send-notification.js:65 except `leagueId`
// which is required and replaces the implicit single-tenant scope):
//   {
//     leagueId: string,        // REQUIRED — the multi-tenant scope
//     title: string,
//     body: string,
//     category: NotificationCategory,
//     team?: string,
//     teams?: string[],
//     url?: string,            // deep-link target (relative path on the
//                              // league's site)
//     excludeToken?: string,
//     excludePlayerIds?: string[],
//     rosterOnly?: boolean,
//     adminOnly?: boolean,
//     sourceId?: string,       // dedupe key for chat messages, etc.
//     imageDataUrl?: string,
//   }
//
// Auth posture: caller must be a verified Firebase user with a
// non-null claim for the target leagueId. captain.html / admin.html /
// our captain endpoints all qualify. Match DVSL pattern.

import { NextResponse } from "next/server";
import {
  getAdminAuth,
  getAdminDb,
  getAdminMessaging,
} from "@/lib/firebase-admin";
import {
  isValidCategory,
  type NotificationCategory,
} from "@/lib/notifications/categories";
import { sendNotification } from "@/lib/notifications/send";

export const runtime = "nodejs";

interface SendBody {
  leagueId?: unknown;
  title?: unknown;
  body?: unknown;
  category?: unknown;
  team?: unknown;
  teams?: unknown;
  url?: unknown;
  excludeToken?: unknown;
  excludePlayerIds?: unknown;
  rosterOnly?: unknown;
  adminOnly?: unknown;
  sourceId?: unknown;
  imageDataUrl?: unknown;
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing bearer token" },
      { status: 401 },
    );
  }
  const idToken = auth.slice("Bearer ".length).trim();
  let decoded;
  try {
    // checkRevoked=true: pushes go to every subscriber's lock screen
    // — even a 1-hour window for a fired admin to spam is too much.
    decoded = await getAdminAuth().verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let raw: SendBody;
  try {
    raw = (await req.json()) as SendBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (typeof raw.leagueId !== "string" || !raw.leagueId) {
    return NextResponse.json(
      { error: "Body must include { leagueId }" },
      { status: 400 },
    );
  }
  const leagueId = raw.leagueId;

  // Caller must be a member of THIS league. Otherwise a SFBL captain
  // could trigger a KCSL push via crafted body. Admin-of-anywhere is
  // not enough; the claim must name THIS leagueId.
  const leagues = decoded.leagues as Record<string, string> | undefined;
  const callerClaim = leagues?.[leagueId];
  if (!callerClaim) {
    return NextResponse.json(
      { error: `Caller has no role in league "${leagueId}"` },
      { status: 403 },
    );
  }

  if (!isValidCategory(raw.category)) {
    return NextResponse.json(
      { error: "Body must include a known { category }" },
      { status: 400 },
    );
  }
  const category: NotificationCategory = raw.category;

  // Audit B1 (2026-05-09): narrow what non-admin callers can send
  // through this endpoint. Without this, any league member can craft
  // a push with arbitrary title/body and blast every subscribed
  // device.
  //   - admin           → can send any category (admin tooling needs it)
  //   - captain:<team>  → ONLY team_chat AND only to their own team
  //                       (matches the legitimate AttendanceTab flow
  //                       — captains nudging their roster for RSVPs)
  //   - any other claim → blocked (no legitimate direct-call use case)
  //
  // Server-internal callers (chat-message, captain-submit, etc.) hit
  // `sendNotification()` from lib/notifications/send.ts directly and
  // never come through this HTTP path, so this gate doesn't break
  // those flows. The cron at /api/pregame-reminder uses CRON_SECRET
  // and short-circuits before this code.
  if (callerClaim === "admin") {
    // allowed
  } else if (callerClaim.startsWith("captain:")) {
    if (category !== "team_chat") {
      return NextResponse.json(
        { error: "Captains can only send team_chat pushes" },
        { status: 403 },
      );
    }
    const captainTeamId = callerClaim.slice("captain:".length);
    const targets = new Set<string>();
    if (typeof raw.team === "string" && raw.team) targets.add(raw.team);
    if (Array.isArray(raw.teams)) {
      for (const t of raw.teams) {
        if (typeof t === "string" && t) targets.add(t);
      }
    }
    if (targets.size === 0 || ![...targets].every((t) => t === captainTeamId)) {
      return NextResponse.json(
        { error: "Captains can only send to their own team" },
        { status: 403 },
      );
    }
  } else {
    return NextResponse.json(
      { error: "Insufficient role to send notifications" },
      { status: 403 },
    );
  }

  if (typeof raw.title !== "string" || !raw.title) {
    return NextResponse.json(
      { error: "Body must include { title }" },
      { status: 400 },
    );
  }
  if (typeof raw.body !== "string") {
    return NextResponse.json(
      { error: "Body must include { body } (string)" },
      { status: 400 },
    );
  }

  // Audit B2 (2026-05-09): validate `url` before it's persisted in
  // pending_nav + rendered as a clickable inbox item. Without this,
  // any caller who passes the role check above could embed an off-
  // domain phishing link. Allow: empty/undefined, a relative path
  // ("/games/123"), or an absolute URL on the request's own origin.
  // Anything else → reject.
  let safeUrl: string | undefined;
  if (raw.url == null || raw.url === "") {
    safeUrl = undefined;
  } else if (typeof raw.url !== "string") {
    return NextResponse.json(
      { error: "{ url } must be a string when provided" },
      { status: 400 },
    );
  } else if (raw.url.startsWith("/") && !raw.url.startsWith("//")) {
    safeUrl = raw.url;
  } else {
    try {
      const target = new URL(raw.url);
      const reqOrigin = new URL(req.url).origin;
      if (target.origin === reqOrigin) {
        safeUrl = target.pathname + target.search + target.hash;
      } else {
        return NextResponse.json(
          { error: "{ url } must be relative or on the same origin" },
          { status: 400 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: "{ url } is not a valid URL" },
        { status: 400 },
      );
    }
  }

  const result = await sendNotification(
    getAdminDb(),
    getAdminMessaging(),
    {
      leagueId,
      title: raw.title,
      body: raw.body,
      category,
      team: typeof raw.team === "string" ? raw.team : undefined,
      teams: Array.isArray(raw.teams)
        ? raw.teams.filter((t): t is string => typeof t === "string")
        : undefined,
      url: safeUrl,
      excludeToken:
        typeof raw.excludeToken === "string" ? raw.excludeToken : undefined,
      excludePlayerIds: Array.isArray(raw.excludePlayerIds)
        ? raw.excludePlayerIds.filter(
            (p): p is string => typeof p === "string",
          )
        : undefined,
      rosterOnly: raw.rosterOnly === true,
      adminOnly: raw.adminOnly === true,
      sourceId:
        typeof raw.sourceId === "string" ? raw.sourceId : undefined,
      imageDataUrl:
        typeof raw.imageDataUrl === "string" ? raw.imageDataUrl : undefined,
      callerUid: decoded.uid,
    },
  );

  return NextResponse.json(result);
}
