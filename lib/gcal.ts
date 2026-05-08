// Google Calendar sync helpers.
//
// Strategy: server-side sync via the Firebase service account (no
// per-user OAuth). One shared calendar per league, owned by the
// service account, set to public-read so subscribers see events
// without authentication.
//
// Setup an admin has to do ONCE per Google Cloud project:
//   1. Enable the Google Calendar API
//      → console.cloud.google.com → APIs & Services → Library
//      → search "Google Calendar API" → Enable
//   2. Service account already exists from Firebase Admin SDK setup
//      (see lib/firebase-admin.ts). Adding the calendar scope is
//      automatic via the auth flow below — no extra grants needed.
//
// Per-league setup (via Admin "Calendar" tab → "Set up sync"):
//   1. Service account creates a new calendar named after the league
//   2. Sets ACL so anyone with the calendar URL can view (public)
//   3. Stores `calendar_id` on /leagues/{id}/site_config/gcal
//
// On every schedule mutation in /api/admin-schedule, we call the
// helpers below to keep events in sync. Each game doc carries a
// `gcal_event_id` field after first sync; we patch by id thereafter.
//
// Failure mode: GCal calls are best-effort. If the API errors, we
// log and continue — the source-of-truth schedule in Firestore is
// unaffected. A "Sync now" button on the admin page does a full
// reconcile to recover.

import { google, type calendar_v3 } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

let cachedClient: calendar_v3.Calendar | null = null;
export function calendar(): calendar_v3.Calendar {
  if (cachedClient) return cachedClient;
  // Reuse the service account credentials that Firebase Admin SDK is
  // already configured with. In dev (emulator), credentials come
  // from FIREBASE_SERVICE_ACCOUNT_PATH or default app credentials.
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const auth = new google.auth.GoogleAuth({
    scopes: SCOPES,
    ...(saPath ? { keyFile: saPath } : {}),
  });
  cachedClient = google.calendar({ version: "v3", auth });
  return cachedClient;
}

// Quick check: is GCal sync configured for this environment? Returns
// false in emulator mode without service account credentials so we
// don't hammer the network with calls that will 401.
export function gcalAvailable(): boolean {
  if (process.env.GCAL_SYNC_DISABLED === "true") return false;
  // Need either an explicit service account file or to be running on
  // GCP/Vercel where ADC works.
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) return true;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  if (process.env.VERCEL) return true;
  return false;
}

export interface GameForSync {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM, optional
  field: string;
  away_team_name: string;
  home_team_name: string;
  division: string;
  status: string;
  gcal_event_id?: string;
}

interface SetupResult {
  calendarId: string;
  publicUrl: string;
}

// Create a new shared calendar for a league. Public-read; service
// account is the owner. Returns calendar id + the public subscribe
// URL admin can hand to players.
export async function setupLeagueCalendar(
  leagueName: string,
  timeZone: string = "America/New_York",
): Promise<SetupResult> {
  const cal = calendar();
  const inserted = await cal.calendars.insert({
    requestBody: {
      summary: `${leagueName} Schedule`,
      description: `Official schedule for ${leagueName}. Updates auto-sync from the league website.`,
      timeZone,
    },
  });
  const calendarId = inserted.data.id;
  if (!calendarId) {
    throw new Error("Calendar API returned no calendar id");
  }
  // Make it publicly readable.
  await cal.acl.insert({
    calendarId,
    requestBody: {
      role: "reader",
      scope: { type: "default" }, // anyone with the link
    },
  });
  // Public subscribe URL (Google Calendar's standard pattern).
  const publicUrl = `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(
    calendarId,
  )}`;
  return { calendarId, publicUrl };
}

function buildEventBody(
  game: GameForSync,
  timeZone: string,
): {
  summary: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  description: string;
  status: "confirmed" | "cancelled";
} {
  const isCancelled =
    game.status === "cancelled" || game.status === "postponed";
  const summary = `${game.away_team_name} @ ${game.home_team_name}${
    game.division ? ` (${game.division})` : ""
  }${isCancelled ? ` — ${game.status.toUpperCase()}` : ""}`;
  const description = [
    game.field ? `Field: ${game.field}` : "",
    game.division ? `Division: ${game.division}` : "",
    `Status: ${game.status}`,
    `Game ID: ${game.id}`,
  ]
    .filter(Boolean)
    .join("\n");

  // If the game has a time, build a 2-hour event (typical baseball
  // game runs ~2-3 hrs; 2 is a sensible default for calendar block).
  // Otherwise treat as all-day event on the date.
  if (game.time && /^\d{1,2}:\d{2}$/.test(game.time)) {
    const startIso = `${game.date}T${game.time.padStart(5, "0")}:00`;
    // Add 2 hours.
    const startDate = new Date(`${startIso}-00:00`);
    const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const endIso =
      `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(
        endDate.getDate(),
      )}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:00`;
    return {
      summary,
      start: { dateTime: startIso, timeZone },
      end: { dateTime: endIso, timeZone },
      ...(game.field ? { location: game.field } : {}),
      description,
      status: isCancelled ? "cancelled" : "confirmed",
    };
  }
  // All-day fallback. End date is exclusive in GCal's spec.
  const next = new Date(`${game.date}T12:00:00`);
  next.setDate(next.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const endDateStr = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(
    next.getDate(),
  )}`;
  return {
    summary,
    start: { date: game.date },
    end: { date: endDateStr },
    ...(game.field ? { location: game.field } : {}),
    description,
    status: isCancelled ? "cancelled" : "confirmed",
  };
}

export async function upsertGameEvent(
  calendarId: string,
  game: GameForSync,
  timeZone: string = "America/New_York",
): Promise<string> {
  const cal = calendar();
  const body = buildEventBody(game, timeZone);
  if (game.gcal_event_id) {
    // Patch existing event.
    try {
      const updated = await cal.events.patch({
        calendarId,
        eventId: game.gcal_event_id,
        requestBody: body,
      });
      return updated.data.id ?? game.gcal_event_id;
    } catch (e) {
      // Event was deleted directly on Google Calendar (admin manually
      // removed it). Fall through to insert.
      console.warn(
        `[gcal] patch failed for ${game.gcal_event_id}, will re-insert:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  const created = await cal.events.insert({
    calendarId,
    requestBody: body,
  });
  if (!created.data.id) {
    throw new Error("Calendar API returned no event id on insert");
  }
  return created.data.id;
}

export async function deleteGameEvent(
  calendarId: string,
  eventId: string,
): Promise<void> {
  const cal = calendar();
  try {
    await cal.events.delete({ calendarId, eventId });
  } catch (e) {
    // Already gone — fine.
    const code = (e as { code?: number }).code;
    if (code !== 404 && code !== 410) throw e;
  }
}
