// Per-tenant schedule iCalendar feed. Subscribers (Google Calendar,
// Apple Calendar, Outlook) hit this URL and pull a fresh copy on
// their schedule. Filters: ?team=<teamId> for a single team's games.
//
// Middleware doesn't run on /api/* (excluded by the matcher in
// middleware.ts) — so we resolve the tenant ourselves from the
// Host header, mirroring middleware's logic.

import { getAdminDb } from "@/lib/firebase-admin";
import { parseHost, resolveTenant } from "@/lib/tenants";
import { formatICalDate, gameStartInstant } from "@/lib/format-time";
import { leagueTimeZone } from "@/lib/league-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const teamFilter = url.searchParams.get("team");

  // Tenant resolution from Host header.
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    "";
  const parsed = parseHost(host);
  const tenant = await resolveTenant(parsed);
  const tenantId = tenant?.id ?? null;
  if (!tenantId) {
    return new Response("Tenant required", { status: 400 });
  }

  const db = getAdminDb();
  const [gamesSnap, teamsSnap, leagueSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
    db.doc(`leagues/${tenantId}`).get(),
  ]);

  const teamNames: Record<string, string> = {};
  for (const d of teamsSnap.docs) {
    teamNames[d.id] = String(d.data().name ?? d.id);
  }
  const leagueName = String(leagueSnap.data()?.name ?? tenantId);
  // The zone the schedule is written in. ETBL (East Texas) is the first
  // Central-time tenant; before it every feed was stamped Eastern.
  const timeZone = leagueTimeZone(leagueSnap.data());
  // A youth basketball game is over in about an hour; a ballgame blocks the
  // afternoon. This is the event length subscribers see.
  const durationMs =
    (leagueSnap.data()?.sport === "basketball" ? 75 : 180) * 60 * 1000;

  let games = gamesSnap.docs.filter((d) => {
    const data = d.data();
    const status = String(data.status ?? "");
    if (status === "draft" || status === "ppd" || status === "rained_out") {
      return false;
    }
    if (teamFilter) {
      return data.home_team_id === teamFilter || data.away_team_id === teamFilter;
    }
    return true;
  });
  // Sort chronologically.
  games = games.sort((a, b) =>
    String(a.data().date ?? "").localeCompare(String(b.data().date ?? "")),
  );

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LeagueEngine//Schedule//EN",
    `X-WR-CALNAME:${escapeText(leagueName)}${teamFilter && teamNames[teamFilter] ? ` — ${escapeText(teamNames[teamFilter]!)}` : ""}`,
    `X-WR-TIMEZONE:${timeZone}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const doc of games) {
    const data = doc.data();
    const date = data.date ? String(data.date) : null;
    if (!date) continue;
    // Audit C3 fix (2026-05-15): the previous code parsed `game.date` as
    // UTC midnight when it was a plain "YYYY-MM-DD" string, leaving every
    // iCal subscriber's event shifted by their browser TZ offset.
    //
    // ETBL fix (2026-09-09): and after that it parsed the stitched wall
    // clock in the SERVER's zone — right on a laptop in New York, an hour
    // out on Vercel (UTC) and for any league that is not Eastern. The
    // wall clock is now resolved in the league's own zone.
    const start = gameStartInstant(
      date,
      data.time ? String(data.time) : null,
      timeZone,
    );
    if (!start) continue;
    const end = new Date(start.getTime() + durationMs);

    const home = teamNames[String(data.home_team_id ?? "")] ?? data.home_team_id;
    const away = teamNames[String(data.away_team_id ?? "")] ?? data.away_team_id;
    const status = String(data.status ?? "scheduled");
    const isFinal = status === "final" || status === "approved";
    const summary = isFinal
      ? `${away} ${data.away_score ?? 0} @ ${home} ${data.home_score ?? 0}`
      : `${away} @ ${home}`;
    const field = data.field ? String(data.field) : "";
    const uid = `${tenantId}-${doc.id}@leagueengine`;

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${formatICalDate(new Date())}`);
    lines.push(`DTSTART:${formatICalDate(start)}`);
    lines.push(`DTEND:${formatICalDate(end)}`);
    lines.push(`SUMMARY:${escapeText(summary)}`);
    if (field) lines.push(`LOCATION:${escapeText(field)}`);
    lines.push(`STATUS:${isFinal ? "CONFIRMED" : "TENTATIVE"}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  const filename = teamFilter
    ? `${tenantId}-${teamFilter}.ics`
    : `${tenantId}.ics`;
  return new Response(lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "public, max-age=300", // 5 min cache
    },
  });
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}
