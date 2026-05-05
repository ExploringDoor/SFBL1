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
    decoded = await getAdminAuth().verifyIdToken(idToken);
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
      url: typeof raw.url === "string" ? raw.url : undefined,
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
