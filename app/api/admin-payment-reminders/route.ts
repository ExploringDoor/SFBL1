// POST /api/admin-payment-reminders — email the teams who still owe the
// league, so the office is not chasing 196 coaches by hand.
//
// Body:
//   { leagueId, action: "preview", teamIds?: string[] }
//     → { ok, recipients: [{ teamId, teamName, email, balance }], skipped: [...] }
//   { leagueId, action: "send", teamIds?: string[] }
//     → { ok, sent, failed, skipped }
//
// teamIds is OPTIONAL and acts as a filter: the admin UI passes exactly the
// teams currently on screen, so "10U only" or a search result sends to that
// subset instead of the whole league. Omitted means every unpaid team.
//
// Who counts as unpaid: amount_paid is 0 or missing on team_payments. A
// partial payment is deliberately NOT chased automatically, since a coach who
// has sent most of the money should get a human email, not a form letter.
//
// Where the address comes from: teams/{id}/_private/contact.managers[], and
// failing that the email on the team's own registration. Same fallback the
// Captains view uses, because teams registered before provisioning wrote the
// contact doc have the address only in the second place.
//
// Admin-only. Every send stamps reminder_sent_at / reminder_count on the
// ledger row so the office can see who has already been nudged and when.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { esc, sendEmail } from "@/lib/email/send";
import {
  COYBL_CARD_FEE_LABEL,
  COYBL_CHECK_ADDRESS,
  COYBL_CHECK_PAYABLE_TO,
  COYBL_VENMO_HANDLE,
  COYBL_VENMO_URL,
} from "@/lib/coybl-payment";

export const runtime = "nodejs";

const TEAM_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One team we can actually write to. */
interface Recipient {
  teamId: string;
  teamName: string;
  email: string;
  name: string;
  balance: number;
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function reminderHtml(r: Recipient, leagueName: string, origin: string) {
  const owed = r.balance > 0 ? money(r.balance) : "";
  return `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;color:#0f172a">
  <p>Hi${r.name ? ` ${esc(r.name)}` : ""},</p>
  <p>
    We don't have a registration payment on file yet for
    <strong>${esc(r.teamName)}</strong>${owed ? `. The balance due is <strong>${owed}</strong>` : ""}.
  </p>
  <p>You can pay any of these ways:</p>
  <ul style="padding-left:18px;line-height:1.6">
    <li>
      <strong>Card</strong> at
      <a href="${esc(origin)}/team-registration">${esc(origin)}/team-registration</a>
      (adds a ${COYBL_CARD_FEE_LABEL} processing fee)
    </li>
    <li>
      <strong>Venmo</strong> to
      <a href="${COYBL_VENMO_URL}">${COYBL_VENMO_HANDLE}</a> (no fee)
    </li>
    <li>
      <strong>Check</strong> payable to ${esc(COYBL_CHECK_PAYABLE_TO)},
      mailed to ${esc(COYBL_CHECK_ADDRESS)} (no fee)
    </li>
  </ul>
  <p>
    Paying by Venmo or check? Put <strong>${esc(r.teamName)}</strong> in the
    note so we can match it to your registration.
  </p>
  <p style="color:#475569;font-size:13px">
    Already sent it? Ignore this, and reply so we can get the ledger straight.
  </p>
  <p>Thanks,<br />${esc(leagueName)}</p>
</div>`.trim();
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(
      auth.slice("Bearer ".length).trim(),
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: { leagueId?: unknown; action?: unknown; teamIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !/^[a-z0-9_-]+$/.test(leagueId)) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  const leagues = decoded.leagues as Record<string, string> | undefined;
  if (leagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }
  const action = body.action === "send" ? "send" : "preview";

  // Optional subset, so the UI can send to just what is on screen.
  let filter: Set<string> | null = null;
  if (Array.isArray(body.teamIds)) {
    filter = new Set(
      body.teamIds.filter(
        (x): x is string => typeof x === "string" && TEAM_ID_RE.test(x),
      ),
    );
    if (filter.size === 0) {
      return NextResponse.json(
        { error: "teamIds was empty after validation" },
        { status: 400 },
      );
    }
  }

  const db = getAdminDb();
  const [teamSnap, paySnap, leagueSnap] = await Promise.all([
    db.collection(`leagues/${leagueId}/teams`).get(),
    db.collection(`leagues/${leagueId}/team_payments`).get(),
    db.doc(`leagues/${leagueId}`).get(),
  ]);
  const leagueName = String(leagueSnap.data()?.name ?? "the league");
  // The public host, not the internal one Vercel invokes the function on. A
  // reminder email whose "pay by card" link points at a *.vercel.app internal
  // URL is a link no coach can use.
  const fwdHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = fwdHost
    ? `${req.headers.get("x-forwarded-proto") ?? "https"}://${fwdHost}`
    : new URL(req.url).origin;

  const pay = new Map<string, Record<string, unknown>>();
  for (const d of paySnap.docs) pay.set(d.id, d.data());

  // Teams still owing, before we know whether we can reach them.
  const owing = teamSnap.docs.filter((d) => {
    if (d.data().active === false) return false;
    if (filter && !filter.has(d.id)) return false;
    return Number(pay.get(d.id)?.amount_paid ?? 0) <= 0;
  });

  const recipients: Recipient[] = [];
  const skipped: { teamId: string; teamName: string; reason: string }[] = [];

  // Contact docs are one read per team, so fetch them together rather than in
  // sequence. 196 teams sequentially is a request that times out.
  const contacts = await Promise.all(
    owing.map((d) =>
      db
        .doc(`leagues/${leagueId}/teams/${d.id}/_private/contact`)
        .get()
        .catch(() => null),
    ),
  );

  owing.forEach((d, i) => {
    const t = d.data();
    const teamName = String(t.name ?? d.id);
    const p = pay.get(d.id) ?? {};
    const balance = Math.max(
      0,
      Number(p.amount_due ?? 0) - Number(p.amount_paid ?? 0),
    );

    const managers = Array.isArray(contacts[i]?.data()?.managers)
      ? (contacts[i]!.data()!.managers as { name?: string; email?: string }[])
      : [];
    let email = "";
    let name = "";
    for (const m of managers) {
      const e = typeof m?.email === "string" ? m.email.trim() : "";
      if (e && EMAIL_RE.test(e)) {
        email = e;
        name = typeof m?.name === "string" ? m.name : "";
        break;
      }
    }
    // Same fallback the Captains view uses: teams registered before the
    // provisioning fix have their address only on the team doc.
    if (!email && typeof t.registered_email === "string") {
      const e = t.registered_email.trim();
      if (EMAIL_RE.test(e)) email = e;
    }

    if (!email) {
      skipped.push({ teamId: d.id, teamName, reason: "no email on file" });
      return;
    }
    recipients.push({ teamId: d.id, teamName, email, name, balance });
  });

  if (action === "preview") {
    return NextResponse.json({ ok: true, recipients, skipped });
  }

  // Send. One failure must not abort the rest, so each is caught and counted.
  let sent = 0;
  const failed: { teamName: string; email: string; error: string }[] = [];
  for (const r of recipients) {
    try {
      const res = await sendEmail({
        to: r.email,
        subject: `${leagueName}: registration payment for ${r.teamName}`,
        html: reminderHtml(r, leagueName, origin),
      });
      if (res.ok) {
        sent++;
        await db
          .doc(`leagues/${leagueId}/team_payments/${r.teamId}`)
          .set(
            {
              team_name: r.teamName,
              reminder_sent_at: new Date().toISOString(),
              reminder_count: (Number(pay.get(r.teamId)?.reminder_count) || 0) + 1,
            },
            { merge: true },
          );
      } else {
        failed.push({
          teamName: r.teamName,
          email: r.email,
          error: res.skipped ? "email is not configured" : (res.error ?? "failed"),
        });
      }
    } catch (e) {
      failed.push({
        teamName: r.teamName,
        email: r.email,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({ ok: true, sent, failed, skipped });
}
