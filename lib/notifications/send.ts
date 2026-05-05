// Server-side push fan-out — pure logic + Firestore + FCM, no HTTP.
//
// Both /api/send-notification (user-triggered) and /api/pregame-reminder
// (Vercel cron, no user) call this. Extracting the logic keeps the
// HTTP route thin and means the cron doesn't have to fake a bearer
// token to talk to its own send endpoint.
//
// What lives here:
//   - Token query (where leagueId == X) — multi-tenant guard at the
//     query layer
//   - matchTokens filter chain (imported from ./match)
//   - FCM send loop with data-only payload (iOS PWA invariant)
//   - Dead-token batched prune
//   - /push_log append
//
// What does NOT live here:
//   - Auth / claim verification — caller's responsibility
//   - HTTP request parsing — caller's responsibility
//   - Anything that depends on the request shape

import type { Firestore } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";
import {
  isValidCategory,
  type NotificationCategory,
} from "./categories";
import {
  isDeadTokenError,
  matchTokens,
  type SendPayload,
  type TokenRow,
} from "./match";

export interface SendNotificationInput {
  leagueId: string;
  title: string;
  body: string;
  category: NotificationCategory;
  team?: string;
  teams?: string[];
  url?: string;
  excludeToken?: string;
  excludePlayerIds?: string[];
  rosterOnly?: boolean;
  adminOnly?: boolean;
  sourceId?: string;
  imageDataUrl?: string;
  // Optional caller identity for /push_log. The user-API caller passes
  // their decoded.uid; the cron passes a synthetic identifier like
  // "cron:pregame".
  callerUid?: string;
}

export interface SendNotificationResult {
  ok: true;
  sent: number;
  failed: number;
  total: number;
  pruned: number;
  rejected: ReturnType<typeof matchTokens>["rejected"];
}

export async function sendNotification(
  db: Firestore,
  messaging: Messaging,
  input: SendNotificationInput,
): Promise<SendNotificationResult> {
  if (!isValidCategory(input.category)) {
    throw new Error(`Invalid category: ${String(input.category)}`);
  }

  const payload: SendPayload = {
    leagueId: input.leagueId,
    category: input.category,
    team: input.team,
    teams: input.teams,
    rosterOnly: input.rosterOnly === true,
    adminOnly: input.adminOnly === true,
    excludeToken: input.excludeToken,
    excludePlayerIds: input.excludePlayerIds,
  };

  // Step 1 — leagueId enforced at query layer. Cross-tenant tokens
  // never enter memory.
  const snap = await db
    .collection("notification_tokens")
    .where("leagueId", "==", input.leagueId)
    .get();

  const tokens: TokenRow[] = snap.docs.map((d) => {
    const data = d.data();
    return {
      docId: d.id,
      token: String(data.token ?? ""),
      leagueId: String(data.leagueId ?? ""),
      categories: Array.isArray(data.categories)
        ? data.categories.map(String)
        : [],
      teams: Array.isArray(data.teams) ? data.teams.map(String) : [],
      authed_teams: Array.isArray(data.authed_teams)
        ? data.authed_teams.map(String)
        : [],
      is_captain_authed: data.is_captain_authed === true,
      is_admin: data.is_admin === true,
      player_id:
        typeof data.player_id === "string" ? data.player_id : null,
      auth_uid: typeof data.auth_uid === "string" ? data.auth_uid : "",
    };
  });

  const { matched, rejected } = matchTokens(tokens, payload);

  if (matched.length === 0) {
    await logPush(db, {
      leagueId: input.leagueId,
      title: input.title,
      body: input.body,
      category: input.category,
      sent: 0,
      failed: 0,
      total: 0,
      note: "No matching subscribers",
      uid: input.callerUid ?? "system",
      sourceId: input.sourceId ?? null,
    });
    return { ok: true, sent: 0, failed: 0, total: 0, pruned: 0, rejected };
  }

  // ── FCM send loop, data-only payload (DVSL spec §1 — iOS PWA) ───
  const sendResults = await Promise.all(
    matched.map(async (row) => {
      try {
        await messaging.send({
          token: row.token,
          data: {
            title: input.title,
            body: input.body,
            leagueId: input.leagueId,
            category: input.category,
            ...(input.url ? { url: input.url } : {}),
            ...(input.sourceId ? { sourceId: input.sourceId } : {}),
            ...(input.imageDataUrl ? { imageUrl: input.imageDataUrl } : {}),
          },
          webpush: { headers: { Urgency: "high", TTL: "86400" } },
        });
        return { docId: row.docId, ok: true as const };
      } catch (e) {
        return {
          docId: row.docId,
          ok: false as const,
          dead: isDeadTokenError(e),
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

  let sent = 0;
  let failed = 0;
  const deadDocIds: string[] = [];
  // Successful sends mapped to their token row — used to write
  // pending_nav docs (one per delivered push) so users see history
  // in their in-app notification bell.
  const successfulRows: TokenRow[] = [];
  for (const r of sendResults) {
    if (r.ok) {
      sent++;
      const row = matched.find((m) => m.docId === r.docId);
      if (row) successfulRows.push(row);
    } else {
      failed++;
      if (r.dead) deadDocIds.push(r.docId);
    }
  }

  if (deadDocIds.length) {
    const batch = db.batch();
    for (const id of deadDocIds) {
      batch.delete(db.doc(`notification_tokens/${id}`));
    }
    await batch.commit().catch((e) => {
      console.warn("[send-notification] dead-token prune failed:", e);
    });
  }

  // ── Write pending_nav for the in-app notification bell ──────────
  // One doc per delivered push, keyed at /pending_nav/{auto_id}.
  // The bell component reads these for the user's current FCM token,
  // shows unread count + dropdown. Dismissing marks `dismissed_at`.
  // Match DVSL's `/api/check-pending-nav` shape.
  //
  // Batched at 400 to stay under Firestore writeBatch limit (matches
  // every other batch op in this codebase). Fire-and-forget — failure
  // means the user sees no bell entry but the OS push already
  // delivered, so impact is small. Logged for diagnosis.
  if (successfulRows.length) {
    const nowIso = new Date().toISOString();
    let rowIdx = 0;
    while (rowIdx < successfulRows.length) {
      const chunk = successfulRows.slice(rowIdx, rowIdx + 400);
      rowIdx += 400;
      const batch = db.batch();
      for (const row of chunk) {
        const ref = db.collection("pending_nav").doc();
        batch.set(ref, {
          token: row.token,
          auth_uid: row.auth_uid ?? "",
          leagueId: input.leagueId,
          title: input.title,
          body: input.body,
          url: input.url ?? "/",
          category: input.category,
          sourceId: input.sourceId ?? null,
          ts: nowIso,
          dismissed_at: null,
        });
      }
      await batch.commit().catch((e) => {
        console.warn("[send-notification] pending_nav write failed:", e);
      });
    }
  }

  await logPush(db, {
    leagueId: input.leagueId,
    title: input.title,
    body: input.body,
    category: input.category,
    sent,
    failed,
    total: matched.length,
    pruned: deadDocIds.length,
    uid: input.callerUid ?? "system",
    sourceId: input.sourceId ?? null,
  });

  return {
    ok: true,
    sent,
    failed,
    total: matched.length,
    pruned: deadDocIds.length,
    rejected,
  };
}

// /push_log/{auto_id} — append-only audit trail.
async function logPush(
  db: Firestore,
  entry: {
    leagueId: string;
    title: string;
    body: string;
    category: string;
    sent: number;
    failed: number;
    total: number;
    pruned?: number;
    note?: string;
    uid: string;
    sourceId: string | null;
  },
) {
  await db
    .collection("push_log")
    .add({ ...entry, at: new Date().toISOString() })
    .catch((e) => {
      console.warn("[send-notification] logPush failed:", e);
    });
}
