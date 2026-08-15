// Vercel cron — nightly "tomorrow's games" reminder email.
//
// Runs each evening. For each league: find tomorrow's scheduled games and
// email the opted-in alerts list (same audience as the weekly digest and
// rainout blast). Subscribers who picked an age group at signup get only
// that age group's games; subscribers without one get the full slate.
// Leagues with no games tomorrow send nothing — quiet nights stay quiet.
//
// Auth: CRON_SECRET, same pattern as pregame-reminder / weekly-digest
// (Bearer or X-Cron-Secret; fails closed when unset).
//
// Query params (manual/testing):
//   ?dry_run=1          → report (and return the first HTML) without sending
//   ?date=YYYY-MM-DD    → pretend "tomorrow" is this date (testing)
//   ?league=ID          → restrict to one league

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { sendGridBroadcast, sendGridConfigured } from "@/lib/email/sendgrid";
import { formatTime12 } from "@/lib/format-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorize(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false; // fail closed
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${expected}`) return true;
  return (req.headers.get("x-cron-secret") ?? "") === expected;
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

interface GameLine {
  time: string;
  field: string;
  away: string;
  home: string;
  ageGroup: string;
}

function gamesTable(games: GameLine[], navy: string): string {
  return games
    .map(
      (g) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;margin:6px 0">
      <tr>
        <td style="padding:10px 14px">
          <p style="margin:0;font:700 15px/1.35 Arial,sans-serif;color:#111">${esc(g.away)} at ${esc(g.home)}</p>
          <p style="margin:3px 0 0;font:400 13px/1.35 Arial,sans-serif;color:#666">${[
            g.time,
            g.field,
            g.ageGroup ? g.ageGroup.toUpperCase() : "",
          ]
            .filter(Boolean)
            .map(esc)
            .join(" · ")}</p>
        </td>
      </tr>
    </table>`,
    )
    .join("");
}

function reminderHtml(opts: {
  leagueName: string;
  siteUrl: string;
  navy: string;
  dateLabel: string;
  games: GameLine[];
}): string {
  const { leagueName, siteUrl, navy, dateLabel, games } = opts;
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;padding:24px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:92%;background:#fff;border-radius:12px;overflow:hidden">
      <tr><td style="background:${navy};padding:22px 28px">
        <p style="margin:0;font:800 20px/1.1 Arial,sans-serif;color:#fff">${esc(leagueName)}</p>
        <p style="margin:4px 0 0;font:700 12px/1.2 Arial,sans-serif;color:#c9a227;text-transform:uppercase;letter-spacing:.12em">Game Day Tomorrow</p>
      </td></tr>
      <tr><td style="padding:22px 28px">
        <p style="margin:0 0 12px;font:800 17px/1.3 Arial,sans-serif;color:${navy}">${esc(dateLabel)}</p>
        ${gamesTable(games, navy)}
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto 6px"><tr><td style="background:#c9a227;border-radius:8px">
          <a href="${esc(siteUrl)}/schedule" style="display:inline-block;padding:12px 26px;font:800 15px/1 Arial,sans-serif;color:${navy};text-decoration:none">Full Schedule &amp; Directions</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:14px 28px 22px;border-top:1px solid #eee">
        <p style="margin:0;font:400 12px/1.5 Arial,sans-serif;color:#999">You are receiving this because you signed up for ${esc(leagueName)} alerts. Reply to this email to be removed.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const onlyLeague = url.searchParams.get("league");
  const dateOverride = url.searchParams.get("date");
  const tomorrow =
    dateOverride && /^\d{4}-\d{2}-\d{2}$/.test(dateOverride)
      ? dateOverride
      : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const db = getAdminDb();
  const leagueIds = onlyLeague
    ? [onlyLeague]
    : (await db.collection("leagues").get()).docs.map((d) => d.id);

  const results: unknown[] = [];
  let firstHtml = "";

  for (const leagueId of leagueIds) {
    // Tomorrow's playable games.
    const gamesSnap = await db
      .collection(`leagues/${leagueId}/games`)
      .where("date", "==", tomorrow)
      .get();
    const playable = gamesSnap.docs
      .map((d) => d.data() as Record<string, unknown>)
      .filter((g) => {
        const s = String(g.status ?? "scheduled");
        return s === "scheduled" || s === "live";
      });
    if (playable.length === 0) {
      results.push({ leagueId, skipped: "no games tomorrow" });
      continue;
    }

    // Team names + age groups.
    const teamsSnap = await db.collection(`leagues/${leagueId}/teams`).get();
    const teamName = new Map<string, string>();
    const teamAge = new Map<string, string>();
    for (const d of teamsSnap.docs) {
      const t = d.data() as Record<string, unknown>;
      teamName.set(d.id, typeof t.name === "string" ? t.name : d.id);
      teamAge.set(d.id, typeof t.ageGroup === "string" ? t.ageGroup : "");
    }

    const lines: GameLine[] = playable.map((g) => {
      const home = String(g.home_team_id ?? "");
      const away = String(g.away_team_id ?? "");
      const rawTime = typeof g.time === "string" ? g.time : "";
      return {
        time: rawTime ? formatTime12(rawTime) : "",
        field: typeof g.field === "string" ? g.field : "",
        home: teamName.get(home) ?? home,
        away: teamName.get(away) ?? away,
        ageGroup: teamAge.get(home) || teamAge.get(away) || "",
      };
    });

    // League branding.
    const leagueDoc = await db.doc(`leagues/${leagueId}`).get();
    const cfg = (leagueDoc.data() ?? {}) as {
      name?: string;
      brand?: { primary?: string };
      site_url?: string;
    };
    const leagueName = cfg.name ?? leagueId.toUpperCase();
    const siteUrl = cfg.site_url ?? `https://${leagueId}.vercel.app`;
    const navy = cfg.brand?.primary ?? "#14213d";
    const dateLabel = prettyDate(tomorrow);

    // Subscribers, split by chosen age group ("" = wants everything).
    const subsSnap = await db
      .collection(`leagues/${leagueId}/form_submissions/alerts_signup/items`)
      .get();
    const byAge = new Map<string, string[]>();
    for (const doc of subsSnap.docs) {
      const x = doc.data() as {
        email?: unknown;
        notify_by?: unknown;
        age_group?: unknown;
      };
      const email = typeof x.email === "string" ? x.email.trim() : "";
      if (!email || x.notify_by === "text") continue;
      const age =
        typeof x.age_group === "string" ? x.age_group.trim().toLowerCase() : "";
      if (!byAge.has(age)) byAge.set(age, []);
      byAge.get(age)!.push(email.toLowerCase());
    }

    let sent = 0;
    const batches: { age: string; recipients: number; games: number }[] = [];
    for (const [age, emails] of byAge) {
      const scoped = age
        ? lines.filter((l) => l.ageGroup.toLowerCase() === age)
        : lines;
      if (scoped.length === 0) continue; // their age group has no games
      const html = reminderHtml({
        leagueName,
        siteUrl,
        navy,
        dateLabel,
        games: scoped,
      });
      if (!firstHtml) firstHtml = html;
      batches.push({ age: age || "(all)", recipients: emails.length, games: scoped.length });
      if (dryRun) continue;
      const res = await sendGridBroadcast({
        recipients: [...new Set(emails)],
        subject: `${leagueName}: games tomorrow (${dateLabel})`,
        html,
      });
      sent += res.sent;
    }

    results.push({
      leagueId,
      date: tomorrow,
      games: playable.length,
      batches,
      ...(dryRun
        ? { wouldSend: batches.length > 0 && sendGridConfigured() }
        : { sent }),
    });
  }

  return NextResponse.json(
    {
      ok: true,
      dryRun,
      tomorrow,
      leagues: results,
      ...(dryRun && firstHtml ? { previewHtml: firstHtml } : {}),
    },
    { status: 200 },
  );
}
