// Per-tenant schedule as a CSV — flat one-row-per-game export the
// umpire assigner (and anyone) can open straight in Excel / Google
// Sheets (Adam, 2026-06: the old WP site let him copy the weekly
// schedule into Excel). Columns: Date, Time, Field, Division, Away,
// Home, Away Score, Home Score, Status. Optional ?div=<division>.
//
// Middleware doesn't run on /api/*, so we resolve the tenant from the
// Host header ourselves — same as schedule.ics.

import { getAdminDb } from "@/lib/firebase-admin";
import { parseHost, resolveTenant } from "@/lib/tenants";
import { formatTime12 } from "@/lib/format-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function splitDateTime(
  dateRaw: string,
  timeRaw: string,
): { date: string; time: string } {
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) &&
    (timeRaw === "" || /^\d{1,2}:\d{2}$/.test(timeRaw))
  ) {
    return { date: dateRaw, time: timeRaw };
  }
  const d = new Date(dateRaw);
  if (Number.isNaN(d.getTime())) {
    return { date: dateRaw.slice(0, 10), time: timeRaw };
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` };
}

// CSV-escape a cell: quote it if it has a comma/quote/newline; double
// any internal quotes.
function cell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const divFilter = url.searchParams.get("div");

  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const tenant = await resolveTenant(parseHost(host));
  const tenantId = tenant?.id ?? null;
  if (!tenantId) {
    return new Response("Tenant required", { status: 400 });
  }

  const db = getAdminDb();
  const [gamesSnap, teamsSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
  ]);

  const teamNames: Record<string, string> = {};
  for (const d of teamsSnap.docs) {
    teamNames[d.id] = String(d.data().name ?? d.id);
  }

  const rows = gamesSnap.docs
    .map((d) => {
      const g = d.data();
      const { date, time } = splitDateTime(
        String(g.date ?? ""),
        String(g.time ?? ""),
      );
      const status = String(g.status ?? "scheduled");
      const isFinal = status === "final" || status === "approved";
      return {
        date,
        time,
        field: String(g.field ?? ""),
        division: String(g.division ?? ""),
        away: teamNames[String(g.away_team_id ?? "")] ?? String(g.away_team_id ?? ""),
        home: teamNames[String(g.home_team_id ?? "")] ?? String(g.home_team_id ?? ""),
        awayScore: isFinal && g.away_score != null ? String(g.away_score) : "",
        homeScore: isFinal && g.home_score != null ? String(g.home_score) : "",
        status,
      };
    })
    // Drop only never-real games; keep scheduled/final/postponed/etc so
    // the assigner sees the full week with a Status column to filter on.
    .filter((r) => r.status !== "draft")
    .filter((r) => !divFilter || r.division === divFilter)
    .sort((a, b) =>
      a.date !== b.date
        ? a.date < b.date
          ? -1
          : 1
        : a.time < b.time
          ? -1
          : a.time > b.time
            ? 1
            : 0,
    );

  const header = [
    "Date",
    "Time",
    "Field",
    "Division",
    "Away",
    "Home",
    "Away Score",
    "Home Score",
    "Status",
  ].join(",");

  const body = rows
    .map((r) =>
      [
        r.date,
        formatTime12(r.time) || "",
        r.field,
        r.division,
        r.away,
        r.home,
        r.awayScore,
        r.homeScore,
        r.status,
      ]
        .map((v) => cell(String(v)))
        .join(","),
    )
    .join("\r\n");

  // Leading BOM so Excel reads UTF-8 (accents in names) correctly.
  const csv = "﻿" + header + "\r\n" + body + "\r\n";

  // Per-tenant filename (was hardcoded "sfbl-schedule.csv" for every league).
  const slug = String(
    (tenant?.config as { abbrev?: unknown } | null)?.abbrev ?? tenantId,
  )
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${slug || "league"}-schedule.csv"`,
      "cache-control": "no-store",
    },
  });
}
