// /api/admin-broadcast — commissioner sends an email + text blast to the
// league's Alerts sign-up list.
//
//   GET  ?leagueId=&ageGroup=  → { emailConfigured, smsConfigured, counts }
//        so the compose UI can show what's wired + how many recipients.
//   POST { leagueId, subject, message, sendEmail, sendSms, ageGroup?,
//          testEmail?, testPhone? }
//        → sends (or, with testEmail/testPhone, sends only to those).
//
// Auth: Firebase ID token whose claim for leagueId is "admin".
// Email = SendGrid, SMS = Twilio; both env-gated (no-op until keys are set).

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { sendGridBroadcast, sendGridConfigured } from "@/lib/email/sendgrid";
import {
  sendSmsBroadcast,
  twilioConfigured,
  toE164US,
} from "@/lib/sms/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Where a contact came from. "coaches" = the head coach on a team
 *  registration (the list that grows on its own as teams sign up);
 *  "subscribers" = the public Alerts sign-up form. */
type Source = "coaches" | "subscribers" | "all";

interface Contact {
  email: string | null;
  phone: string | null;
  ageGroup: string | null;
  notifyBy: string;
  source: "coaches" | "subscribers";
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function loadContacts(
  db: ReturnType<typeof getAdminDb>,
  leagueId: string,
): Promise<Contact[]> {
  const out: Contact[] = [];

  // Registered coaches. Every team registration carries the head coach's
  // email + phone + age group, so this list builds itself as teams sign up —
  // no contact import needed. They gave these for league business, so they
  // default to reachable on both channels (Twilio still appends "Reply STOP").
  const coaches = await db
    .collection(`leagues/${leagueId}/form_submissions/team_registration/items`)
    .get()
    .catch(() => null);
  for (const d of coaches?.docs ?? []) {
    const x = d.data();
    out.push({
      email: typeof x.email === "string" ? x.email.trim() : null,
      phone: typeof x.phone === "string" ? x.phone.trim() : null,
      ageGroup: typeof x.age_group === "string" ? x.age_group : null,
      notifyBy: "both",
      source: "coaches",
    });
  }

  // Public Alerts sign-ups (parents, fans). The form asks how they want to be
  // reached, so honor that choice; anything unset stays email-only rather than
  // texting someone who never asked for texts.
  const subs = await db
    .collection(`leagues/${leagueId}/form_submissions/alerts_signup/items`)
    .get()
    .catch(() => null);
  for (const d of subs?.docs ?? []) {
    const x = d.data();
    out.push({
      email: typeof x.email === "string" ? x.email.trim() : null,
      phone: typeof x.phone === "string" ? x.phone.trim() : null,
      ageGroup: typeof x.age_group === "string" ? x.age_group : null,
      notifyBy: typeof x.notify_by === "string" ? x.notify_by : "email",
      source: "subscribers",
    });
  }

  return out;
}

/** Narrow a loaded contact list to one source. */
function bySource(contacts: Contact[], source: Source): Contact[] {
  return source === "all"
    ? contacts
    : contacts.filter((c) => c.source === source);
}

/** Reachable-recipient counts (never the addresses themselves). */
function countsFor(contacts: Contact[]) {
  const { emails, phones } = audience(contacts, null);
  return { total: contacts.length, email: emails.length, sms: phones.length };
}

function audience(contacts: Contact[], ageGroup?: string | null) {
  const inScope = ageGroup
    ? contacts.filter((c) => c.ageGroup === ageGroup)
    : contacts;
  // "both"/unset → email; "text"/"both" → sms.
  const emails = inScope
    .filter((c) => c.email && c.notifyBy !== "text")
    .map((c) => c.email!);
  const phones = inScope
    .filter((c) => c.phone && (c.notifyBy === "text" || c.notifyBy === "both"))
    .map((c) => c.phone!)
    .filter((p) => toE164US(p));
  return {
    emails: [...new Set(emails.map((e) => e.toLowerCase()))],
    phones: [...new Set(phones)],
  };
}

async function requireAdmin(
  req: Request,
  leagueId: unknown,
): Promise<{ uid: string } | NextResponse> {
  const authHdr = req.headers.get("authorization");
  if (!authHdr?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(
      authHdr.slice("Bearer ".length).trim(),
    );
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  const leagues = (decoded.leagues ?? {}) as Record<string, string>;
  if (leagues[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not an admin of "${leagueId}"` },
      { status: 403 },
    );
  }
  return { uid: decoded.uid };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const leagueId = url.searchParams.get("leagueId");
  const ageGroup = url.searchParams.get("ageGroup") || null;
  const gate = await requireAdmin(req, leagueId);
  if (gate instanceof NextResponse) return gate;

  const source = (url.searchParams.get("source") || "all") as Source;

  const db = getAdminDb();
  const all = await loadContacts(db, leagueId!);
  const selected = bySource(all, source);
  const { emails, phones } = audience(selected, ageGroup);
  const ageGroups = [
    ...new Set(selected.map((c) => c.ageGroup).filter((a): a is string => !!a)),
  ].sort();
  return NextResponse.json({
    emailConfigured: sendGridConfigured(),
    smsConfigured: twilioConfigured(),
    counts: { total: selected.length, email: emails.length, sms: phones.length },
    // Per-source totals so the composer can label each audience option.
    // Counts only — never ship the actual addresses to the browser.
    sources: {
      coaches: countsFor(bySource(all, "coaches")),
      subscribers: countsFor(bySource(all, "subscribers")),
    },
    ageGroups,
  });
}

export async function POST(req: Request) {
  let body: {
    leagueId?: unknown;
    subject?: unknown;
    message?: unknown;
    sendEmail?: unknown;
    sendSms?: unknown;
    ageGroup?: unknown;
    source?: unknown;
    testEmail?: unknown;
    testPhone?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const gate = await requireAdmin(req, body.leagueId);
  if (gate instanceof NextResponse) return gate;

  const leagueId = body.leagueId as string;
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const wantEmail = body.sendEmail === true;
  const wantSms = body.sendSms === true;
  const ageGroup =
    typeof body.ageGroup === "string" && body.ageGroup ? body.ageGroup : null;
  const source: Source =
    body.source === "coaches" || body.source === "subscribers"
      ? body.source
      : "all";
  const testEmail =
    typeof body.testEmail === "string" ? body.testEmail.trim() : "";
  const testPhone =
    typeof body.testPhone === "string" ? body.testPhone.trim() : "";
  const isTest = !!(testEmail || testPhone);

  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }
  if (!wantEmail && !wantSms) {
    return NextResponse.json(
      { error: "Pick at least one channel (email or text)" },
      { status: 400 },
    );
  }

  const db = getAdminDb();
  const leagueName =
    ((await db.doc(`leagues/${leagueId}`).get().catch(() => null))?.data()
      ?.name as string) ?? "your league";

  // Resolve recipients.
  let emails: string[] = [];
  let phones: string[] = [];
  if (isTest) {
    if (testEmail) emails = [testEmail];
    if (testPhone) phones = [testPhone];
  } else {
    const contacts = bySource(await loadContacts(db, leagueId), source);
    const aud = audience(contacts, ageGroup);
    if (wantEmail) emails = aud.emails;
    if (wantSms) phones = aud.phones;
  }

  const result: Record<string, unknown> = { ok: true, test: isTest };

  // Email via SendGrid.
  if (wantEmail && emails.length) {
    const html =
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">` +
      esc(message).replace(/\n/g, "<br/>") +
      `<hr style="border:none;border-top:1px solid #ddd;margin:20px 0"/>` +
      `<p style="font-size:12px;color:#777">${
        source === "coaches"
          ? `You're receiving this as a registered ${esc(leagueName)} coach.`
          : source === "subscribers"
            ? `You're receiving this because you signed up for ${esc(leagueName)} alerts.`
            : `You're receiving this because you're on the ${esc(leagueName)} contact list.`
      }</p></div>`;
    const r = await sendGridBroadcast({
      recipients: emails,
      subject: subject || `${leagueName} update`,
      html,
    });
    result.email = r.skipped
      ? { skipped: true, note: "SendGrid not configured" }
      : { sent: r.sent, ok: r.ok, error: r.error };
  } else if (wantEmail) {
    result.email = { sent: 0, note: "no email recipients" };
  }

  // Text via Twilio.
  if (wantSms && phones.length) {
    if (!twilioConfigured()) {
      result.sms = { skipped: true, note: "Twilio not configured" };
    } else {
      const smsBody = `${message}\n\nReply STOP to opt out.`;
      const r = await sendSmsBroadcast(phones, smsBody);
      result.sms = r;
    }
  } else if (wantSms) {
    result.sms = { sent: 0, note: "no text recipients" };
  }

  // Audit (skip for tests).
  if (!isTest) {
    await db
      .collection(`leagues/${leagueId}/audit`)
      .add({
        kind: "broadcast_sent",
        by_uid: (gate as { uid: string }).uid,
        by_role: "admin",
        at: new Date().toISOString(),
        changes: {
          subject,
          channels: { email: wantEmail, sms: wantSms },
          ageGroup,
          source,
          counts: { email: emails.length, sms: phones.length },
        },
      })
      .catch(() => {});
  }

  return NextResponse.json(result);
}
