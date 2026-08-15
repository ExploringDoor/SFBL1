// Vercel cron — weekly email digest (scores + division leaders).
//
// For each league, builds one HTML email: the past week's final scores
// grouped by day, plus each division's current leader, plus a button back
// to the site. Sends it to that league's alert subscribers (the
// alerts_signup opt-in list) via SendGrid.
//
// Auth: same pattern as pregame-reminder — Vercel cron sends
//   `Authorization: Bearer ${CRON_SECRET}`; `X-Cron-Secret: ${CRON_SECRET}`
// is accepted for manual triggers. Fails closed when CRON_SECRET is unset,
// so nobody can trigger a send anonymously.
//
// Query params (manual/testing):
//   ?dry_run=1   → build the digest and RETURN it (html + recipient count)
//                  without sending. Lets you preview the email safely.
//   ?days=N      → look back N days for scores (default 7). Handy off-season
//                  to preview against the last games played.
//   ?league=ID   → restrict to one league (default: every league).
//
// Dormant until a league has alert signups AND SENDGRID_* is configured —
// with no recipients or no sender it reports skipped and sends nothing.

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { sendGridBroadcast, sendGridConfigured } from "@/lib/email/sendgrid";
import { loadAlertEmails } from "@/lib/email/alert-recipients";

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

interface TeamRow {
  name: string;
  division: string;
  ageGroup: string;
  w: number;
  l: number;
  t: number;
}

interface GameRow {
  date: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
}

// yyyy-mm-dd (UTC) N days before `ref`.
function daysAgoISO(ref: Date, n: number): string {
  const d = new Date(ref.getTime() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function prettyDate(iso: string): string {
  // iso "YYYY-MM-DD" → "Mon, Jun 30". Parse as UTC to avoid tz drift.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function pct(t: TeamRow): number {
  const gp = t.w + t.l + t.t;
  return gp > 0 ? (t.w + 0.5 * t.t) / gp : 0;
}

function buildDigestHtml(opts: {
  leagueName: string;
  siteUrl: string;
  brandColor: string;
  scoresByDay: { date: string; games: GameRow[] }[];
  leaders: { division: string; team: string; record: string }[];
}): string {
  const { leagueName, siteUrl, brandColor, scoresByDay, leaders } = opts;
  const navy = brandColor || "#14213d";

  const scoresBlock = scoresByDay.length
    ? scoresByDay
        .map(
          (day) => `
      <p style="margin:18px 0 6px;font:700 13px/1.2 Arial,sans-serif;color:${navy};text-transform:uppercase;letter-spacing:.06em">${esc(
        prettyDate(day.date),
      )}</p>
      ${day.games
        .map(
          (g) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;margin:6px 0">
          <tr>
            <td style="padding:10px 14px;font:600 15px/1.3 Arial,sans-serif;color:#111">${esc(
              g.away,
            )}</td>
            <td style="padding:10px 14px;font:800 16px/1.3 Arial,sans-serif;color:#111;text-align:right;white-space:nowrap">${g.awayScore}</td>
          </tr>
          <tr>
            <td style="padding:0 14px 10px;font:600 15px/1.3 Arial,sans-serif;color:#111">${esc(
              g.home,
            )}</td>
            <td style="padding:0 14px 10px;font:800 16px/1.3 Arial,sans-serif;color:#111;text-align:right;white-space:nowrap">${g.homeScore}</td>
          </tr>
        </table>`,
        )
        .join("")}`,
        )
        .join("")
    : `<p style="margin:14px 0;font:400 15px/1.5 Arial,sans-serif;color:#555">No games this week. Check the site for the upcoming schedule.</p>`;

  const leadersBlock = leaders.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0">
        ${leaders
          .map(
            (l) => `
          <tr>
            <td style="padding:7px 0;border-bottom:1px solid #eee;font:400 14px/1.3 Arial,sans-serif;color:#555">${esc(
              l.division,
            )}</td>
            <td style="padding:7px 0;border-bottom:1px solid #eee;font:700 14px/1.3 Arial,sans-serif;color:#111;text-align:right">${esc(
              l.team,
            )} <span style="color:#888;font-weight:400">(${esc(l.record)})</span></td>
          </tr>`,
          )
          .join("")}
      </table>`
    : "";

  return `<!doctype html>
<html><body style="margin:0;background:#f4f5f7;padding:0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:92%;background:#fff;border-radius:12px;overflow:hidden">
        <tr><td style="background:${navy};padding:22px 28px">
          <p style="margin:0;font:800 20px/1.1 Arial,sans-serif;color:#fff">${esc(
            leagueName,
          )}</p>
          <p style="margin:4px 0 0;font:700 12px/1.2 Arial,sans-serif;color:#c9a227;text-transform:uppercase;letter-spacing:.12em">Weekly Update</p>
        </td></tr>
        <tr><td style="padding:22px 28px">
          <p style="margin:0 0 4px;font:800 16px/1.2 Arial,sans-serif;color:${navy};text-transform:uppercase">This week's scores</p>
          ${scoresBlock}
          ${
            leadersBlock
              ? `<p style="margin:26px 0 4px;font:800 16px/1.2 Arial,sans-serif;color:${navy};text-transform:uppercase">Division leaders</p>${leadersBlock}`
              : ""
          }
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px auto 6px">
            <tr><td style="background:#c9a227;border-radius:8px">
              <a href="${esc(
                siteUrl,
              )}/standings" style="display:inline-block;padding:12px 26px;font:800 15px/1 Arial,sans-serif;color:${navy};text-decoration:none">View Full Standings</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:16px 28px 24px;border-top:1px solid #eee">
          <p style="margin:0;font:400 12px/1.5 Arial,sans-serif;color:#999">You are receiving this because you signed up for ${esc(
            leagueName,
          )} alerts. Reply to this email to be removed.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function digestForLeague(
  db: FirebaseFirestore.Firestore,
  leagueId: string,
  refNow: Date,
  days: number,
) {
  const leagueDoc = await db.doc(`leagues/${leagueId}`).get();
  const cfg = (leagueDoc.data() ?? {}) as {
    name?: string;
    brand?: { primary?: string };
    site_url?: string;
  };
  const leagueName = cfg.name ?? leagueId.toUpperCase();
  const siteUrl = cfg.site_url ?? `https://${leagueId}.vercel.app`;
  const brandColor = cfg.brand?.primary ?? "#14213d";

  // Teams: id -> row (name, division, stored record).
  const teamsSnap = await db.collection(`leagues/${leagueId}/teams`).get();
  const teams = new Map<string, TeamRow>();
  for (const d of teamsSnap.docs) {
    const t = d.data() as Record<string, unknown>;
    teams.set(d.id, {
      name: typeof t.name === "string" ? t.name : d.id,
      division: typeof t.division === "string" ? t.division : "",
      ageGroup: typeof t.ageGroup === "string" ? t.ageGroup : "",
      w: typeof t.w === "number" ? t.w : 0,
      l: typeof t.l === "number" ? t.l : 0,
      t: typeof t.t === "number" ? t.t : 0,
    });
  }

  // Recent final scores in the window.
  const since = daysAgoISO(refNow, days);
  const today = refNow.toISOString().slice(0, 10);
  const gamesSnap = await db.collection(`leagues/${leagueId}/games`).get();
  const recent: GameRow[] = [];
  for (const d of gamesSnap.docs) {
    const g = d.data() as Record<string, unknown>;
    const status = String(g.status ?? "");
    if (status !== "final" && status !== "approved") continue;
    const date = String(g.date ?? "").slice(0, 10);
    if (!date || date < since || date > today) continue;
    if (g.home_score == null || g.away_score == null) continue;
    recent.push({
      date,
      home: teams.get(String(g.home_team_id))?.name ?? String(g.home_team_id),
      away: teams.get(String(g.away_team_id))?.name ?? String(g.away_team_id),
      homeScore: Number(g.home_score),
      awayScore: Number(g.away_score),
    });
  }
  // Group by day, newest first.
  const byDay = new Map<string, GameRow[]>();
  for (const g of recent.sort((a, b) => (a.date < b.date ? 1 : -1))) {
    if (!byDay.has(g.date)) byDay.set(g.date, []);
    byDay.get(g.date)!.push(g);
  }
  const scoresByDay = [...byDay.entries()].map(([date, games]) => ({
    date,
    games,
  }));

  // Division leaders: top team by pct in each division (stored records).
  const byDiv = new Map<string, TeamRow[]>();
  for (const t of teams.values()) {
    if (t.w + t.l + t.t === 0) continue; // skip teams with no record
    const key = t.division || t.ageGroup || "League";
    if (!byDiv.has(key)) byDiv.set(key, []);
    byDiv.get(key)!.push(t);
  }
  const leaders = [...byDiv.entries()]
    .map(([division, rows]) => {
      const top = rows.sort((a, b) => pct(b) - pct(a) || b.w - a.w)[0]!;
      return {
        division,
        team: top.name,
        record: `${top.w}-${top.l}${top.t ? `-${top.t}` : ""}`,
      };
    })
    .sort((a, b) => a.division.localeCompare(b.division));

  const html = buildDigestHtml({
    leagueName,
    siteUrl,
    brandColor,
    scoresByDay,
    leaders,
  });
  const subject = `${leagueName} Weekly Update`;
  return { leagueName, subject, html, gameCount: recent.length, leaders };
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const days = Math.min(
    400,
    Math.max(1, Number(url.searchParams.get("days")) || 7),
  );
  const onlyLeague = url.searchParams.get("league");

  const db = getAdminDb();
  const refNow = new Date();

  const leagueIds = onlyLeague
    ? [onlyLeague]
    : (await db.collection("leagues").get()).docs.map((d) => d.id);

  const results: unknown[] = [];
  let firstHtml = "";
  for (const leagueId of leagueIds) {
    const digest = await digestForLeague(db, leagueId, refNow, days);
    const recipients = await loadAlertEmails(db, leagueId);
    if (!firstHtml) firstHtml = digest.html;

    if (dryRun) {
      results.push({
        leagueId,
        subject: digest.subject,
        gameCount: digest.gameCount,
        leaderCount: digest.leaders.length,
        recipients: recipients.length,
        wouldSend: recipients.length > 0 && sendGridConfigured(),
      });
      continue;
    }

    if (recipients.length === 0) {
      results.push({ leagueId, skipped: "no recipients" });
      continue;
    }
    const send = await sendGridBroadcast({
      recipients,
      subject: digest.subject,
      html: digest.html,
    });
    results.push({ leagueId, sent: send.sent, skipped: send.skipped ?? false });
  }

  return NextResponse.json(
    {
      ok: true,
      dryRun,
      days,
      leagues: results,
      // In dry-run, return the first league's HTML so it can be previewed.
      ...(dryRun ? { previewHtml: firstHtml } : {}),
    },
    { status: 200 },
  );
}
