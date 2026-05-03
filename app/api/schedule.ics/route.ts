// Per-tenant schedule iCalendar feed. Subscribers (Google Calendar,
// Apple Calendar, Outlook) hit this URL and pull a fresh copy on
// their schedule. Filters: ?team=<teamId> for a single team's games.

import { getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const teamFilter = url.searchParams.get("team");

  // Tenant resolution from middleware-set header.
  const tenantId = req.headers.get("x-tenant-id");
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
    "X-WR-TIMEZONE:America/New_York",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const doc of games) {
    const data = doc.data();
    const date = data.date ? String(data.date) : null;
    if (!date) continue;
    const start = new Date(date);
    if (Number.isNaN(start.getTime())) continue;
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000); // 3hr default

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

function formatICalDate(d: Date): string {
  // YYYYMMDDTHHMMSSZ
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}
