// Vercel cron — pregame reminder push.
//
// Runs every 15 minutes (see vercel.json). For each league:
//   - Find scheduled (not final, not postponed/cancelled) games whose
//     start time falls inside a 30-minute window centered on T-60min
//     (i.e. starts in 45-75 minutes from now)
//   - Skip games already flagged `pregame_reminder_sent: true`
//   - Fire a `pregame` category push to subscribers of either team
//   - Mark the game `pregame_reminder_sent: true` for exactly-once
//     delivery
//
// Why a 30-min window centered on 60min: the cron fires every 15 min,
// so any scheduled game start time falls inside at least one window
// before it begins. The flag gives us idempotency in case the cron
// fires twice during the same window (rare but possible if a deploy
// kicks an extra invocation).
//
// Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}` per
// vercel.json. Endpoint fails closed if CRON_SECRET env isn't set, so
// nobody can hit this endpoint anonymously and trigger a fan-out.
// X-Cron-Secret header also accepted for manual triggers (e.g.
// `curl -H "X-Cron-Secret: $SECRET" https://.../api/pregame-reminder`).
//
// Multi-tenant: iterates every league under /leagues. The
// sendNotification() lib already gates by leagueId so each push only
// reaches that league's subscribers.

import { NextResponse } from "next/server";
import {
  getAdminDb,
  getAdminMessaging,
} from "@/lib/firebase-admin";
import { sendNotification } from "@/lib/notifications/send";

export const runtime = "nodejs";
// Don't cache the cron response.
export const dynamic = "force-dynamic";

// 30-minute window centered on 60min before game start. With cron
// firing every 15 min, every game crosses inside at least once.
const WINDOW_BEFORE_MS = 75 * 60 * 1000; // 75 min before
const WINDOW_NEAR_MS = 45 * 60 * 1000; // 45 min before

function authorize(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Fail closed if secret isn't configured — no anonymous triggers.
    return false;
  }
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader === `Bearer ${expected}`) return true;
  const xCron = req.headers.get("x-cron-secret") ?? "";
  if (xCron === expected) return true;
  return false;
}

interface ReminderResult {
  leagueId: string;
  gameId: string;
  status: "sent" | "no-subscribers" | "send-error";
  sent?: number;
  error?: string;
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();
  const messaging = getAdminMessaging();
  const now = Date.now();
  const windowEnd = now + WINDOW_BEFORE_MS; // games starting <= 75 min from now
  const windowStart = now + WINDOW_NEAR_MS; // games starting >= 45 min from now

  // List every league. Top-level /leagues collection.
  const leaguesSnap = await db.collection("leagues").get();

  const results: ReminderResult[] = [];

  for (const leagueDoc of leaguesSnap.docs) {
    const leagueId = leagueDoc.id;

    // Pull scheduled games. We can't compose a `where('date', '>=', ...)
    // with a `where('pregame_reminder_sent', '==', false)` without an
    // extra composite index, and the games-per-league count is small
    // (single-season leagues are ~50-200 games), so we just fetch all
    // scheduled games and filter in memory.
    const gamesSnap = await db
      .collection(`leagues/${leagueId}/games`)
      .where("status", "==", "scheduled")
      .get();

    const teamsSnap = await db
      .collection(`leagues/${leagueId}/teams`)
      .get();
    const teamNames: Record<string, string> = {};
    const teamShorts: Record<string, string> = {};
    for (const d of teamsSnap.docs) {
      const data = d.data();
      teamNames[d.id] = String(data.name ?? d.id);
      teamShorts[d.id] = String(data.abbrev ?? data.short ?? d.id);
    }

    for (const gameDoc of gamesSnap.docs) {
      const game = gameDoc.data();
      if (game.pregame_reminder_sent === true) continue;
      if (game.status !== "scheduled") continue; // belt + suspenders
      if (!game.date) continue;

      const startMs = new Date(String(game.date)).getTime();
      if (!Number.isFinite(startMs)) continue;
      if (startMs < windowStart || startMs > windowEnd) continue;

      const awayId = String(game.away_team_id ?? "");
      const homeId = String(game.home_team_id ?? "");
      const awayShort = teamShorts[awayId] ?? awayId;
      const homeShort = teamShorts[homeId] ?? homeId;

      const timeStr = (() => {
        try {
          return new Date(String(game.date)).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          });
        } catch {
          return "";
        }
      })();
      const fieldStr = game.field ? String(game.field) : "";
      const bodyParts = [timeStr, fieldStr].filter(Boolean);

      try {
        const sendResult = await sendNotification(db, messaging, {
          leagueId,
          title: `⚾ Game in 1 hour: ${awayShort} @ ${homeShort}`,
          body: bodyParts.join(" · ") || "Game starts soon",
          category: "pregame",
          teams: [awayId, homeId].filter(Boolean),
          url: "/schedule",
          callerUid: "cron:pregame",
        });

        // Mark idempotency flag REGARDLESS of subscriber count — even
        // if zero people are subscribed to pregame, we don't want to
        // retry every 15 min for the same game until kickoff.
        await gameDoc.ref.set(
          {
            pregame_reminder_sent: true,
            pregame_reminder_sent_at: new Date().toISOString(),
          },
          { merge: true },
        );

        results.push({
          leagueId,
          gameId: gameDoc.id,
          status: sendResult.total === 0 ? "no-subscribers" : "sent",
          sent: sendResult.sent,
        });
      } catch (e) {
        // Don't mark the flag on send failure — let the next cron run
        // try again. (Different from no-subscribers, which IS a final
        // state.)
        results.push({
          leagueId,
          gameId: gameDoc.id,
          status: "send-error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    now: new Date(now).toISOString(),
    leagues_checked: leaguesSnap.size,
    games_processed: results.length,
    results,
  });
}
