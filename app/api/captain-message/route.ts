// POST /api/captain-message — a coach emails their own team's families.
//
// Doug approved this on 2026-08-05: head coach AND assistant coach may both
// send. They share one sign-in code so the site genuinely cannot tell them
// apart, which makes "head coach only" unenforceable rather than merely
// undesirable.
//
// Body:
//   { leagueId, action: "preview" }          → { ok, recipients, skipped }
//   { leagueId, action: "send", subject, message }
//                                            → { ok, sent, failed, skipped }
//
// Scope: ALWAYS the caller's own team, taken from their captain claim. The
// team is never read from the body, so a coach cannot address another team's
// families by editing the request.
//
// Addresses come from players/{id}/_private/contact.email, which is the
// "Parent / Guardian Email" on the roster. Those docs are admin-or-self by
// rule, so this route reads them with the Admin SDK rather than widening
// anything.
//
// Privacy: one email per family, sent individually. No CC, no BCC, no list of
// other people's addresses in a header where a parent could harvest them.
//
// Reply-to is the coach, so a parent replying reaches them and not the league.
// A copy goes to the league office so there is a record if a family ever
// complains about what was sent.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { esc, notifyAddress, sendEmail } from "@/lib/email/send";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SUBJECT = 140;
const MAX_MESSAGE = 5000;

interface Family {
  playerId: string;
  playerName: string;
  email: string;
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

  let body: {
    leagueId?: unknown;
    action?: unknown;
    subject?: unknown;
    message?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !/^[a-z0-9_-]+$/.test(leagueId)) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }

  // The caller's own team, from their claim. Never from the body.
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[
    leagueId
  ];
  if (typeof claim !== "string" || !claim.startsWith("captain:")) {
    return NextResponse.json(
      { error: "You need to be signed in as a coach for this team." },
      { status: 403 },
    );
  }
  const teamId = claim.slice("captain:".length);
  if (!teamId) {
    return NextResponse.json({ error: "No team on your login." }, { status: 403 });
  }

  const db = getAdminDb();
  const [teamSnap, playersSnap, leagueSnap, contactSnap] = await Promise.all([
    db.doc(`leagues/${leagueId}/teams/${teamId}`).get(),
    db
      .collection(`leagues/${leagueId}/players`)
      .where("team_id", "==", teamId)
      .get(),
    db.doc(`leagues/${leagueId}`).get(),
    db.doc(`leagues/${leagueId}/teams/${teamId}/_private/contact`).get(),
  ]);
  if (!teamSnap.exists) {
    return NextResponse.json({ error: "Team not found." }, { status: 404 });
  }
  const teamName = String(teamSnap.data()?.name ?? teamId);
  const leagueName = String(leagueSnap.data()?.name ?? "the league");

  // Active players only — a removed player's family should not keep getting
  // team email.
  const active = playersSnap.docs.filter((d) => {
    const x = d.data();
    if (x.active === false || x.orphan === true) return false;
    if (x.status && x.status !== "active") return false;
    return true;
  });

  const privates = await Promise.all(
    active.map((d) =>
      db
        .doc(`leagues/${leagueId}/players/${d.id}/_private/contact`)
        .get()
        .catch(() => null),
    ),
  );

  const families: Family[] = [];
  const skipped: { playerName: string }[] = [];
  const seen = new Set<string>();
  active.forEach((d, i) => {
    const playerName = String(d.data().name ?? d.id);
    const email = String(privates[i]?.data()?.email ?? "").trim();
    if (!email || !EMAIL_RE.test(email)) {
      skipped.push({ playerName });
      return;
    }
    // Siblings on one team share a parent address; send once.
    const key = email.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    families.push({ playerId: d.id, playerName, email });
  });

  if (body.action !== "send") {
    return NextResponse.json({
      ok: true,
      teamName,
      recipients: families.map((f) => ({
        playerName: f.playerName,
        email: f.email,
      })),
      skipped,
    });
  }

  const subject =
    typeof body.subject === "string" ? body.subject.trim().slice(0, MAX_SUBJECT) : "";
  const message =
    typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE) : "";
  if (!subject) {
    return NextResponse.json({ error: "Add a subject." }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "Add a message." }, { status: 400 });
  }
  if (families.length === 0) {
    return NextResponse.json(
      { error: "No family email addresses on your roster yet." },
      { status: 400 },
    );
  }

  // Who it is from, for the signature and reply-to. First manager on file.
  const managers = Array.isArray(contactSnap.data()?.managers)
    ? (contactSnap.data()!.managers as { name?: string; email?: string }[])
    : [];
  const from = managers.find(
    (m) => typeof m?.email === "string" && EMAIL_RE.test(m.email.trim()),
  );
  const fromEmail = from?.email?.trim() ?? "";
  const fromName = String(from?.name ?? "").trim();

  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;color:#0f172a">` +
    `<p style="font-size:13px;color:#64748b;margin:0 0 14px">` +
    `A message from your ${esc(teamName)} coach &middot; ${esc(leagueName)}` +
    `</p>` +
    `<div style="white-space:pre-wrap;line-height:1.6">${esc(message)}</div>` +
    `<p style="margin-top:22px;color:#334155">` +
    `${esc(fromName || "Your coach")}<br />` +
    `<span style="color:#64748b">${esc(teamName)}</span></p>` +
    `<p style="font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:10px">` +
    `You're getting this because your player is on this ${esc(leagueName)} roster. ` +
    `Reply to reach the coach directly.</p>` +
    `</div>`;

  let sent = 0;
  const failed: { email: string; error: string }[] = [];
  for (const f of families) {
    try {
      const res = await sendEmail({
        to: f.email,
        subject: `[${teamName}] ${subject}`,
        html,
        replyTo: fromEmail || undefined,
      });
      if (res.ok) sent++;
      else
        failed.push({
          email: f.email,
          error: res.skipped ? "email is not configured" : (res.error ?? "failed"),
        });
    } catch (e) {
      failed.push({
        email: f.email,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Record of what went out, so the office can answer a complaint without
  // asking the coach what they wrote.
  try {
    await db.collection(`leagues/${leagueId}/team_messages`).add({
      team_id: teamId,
      team_name: teamName,
      subject,
      message,
      sent_by_uid: decoded.uid,
      sent_by_email: fromEmail || null,
      recipient_count: sent,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[captain-message] could not log the send", err);
  }

  // Copy to the league office. Best-effort: a failure here must not make a
  // successful send to families look broken.
  try {
    const office = notifyAddress();
    if (office) {
      await sendEmail({
        to: office,
        subject: `[copy] ${teamName} messaged their families: ${subject}`,
        html:
          `<p style="color:#475569;font-size:13px">Copy for the league record. ` +
          `Sent to ${sent} famil${sent === 1 ? "y" : "ies"} by ` +
          `${esc(fromName || "a coach")}${fromEmail ? ` &lt;${esc(fromEmail)}&gt;` : ""}.</p>` +
          html,
        replyTo: fromEmail || undefined,
      });
    }
  } catch (err) {
    console.error("[captain-message] office copy failed", err);
  }

  return NextResponse.json({ ok: true, sent, failed, skipped });
}
