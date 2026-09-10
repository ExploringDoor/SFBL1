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
import { hasScope } from "@/lib/admin-roles";
import { sendGridBroadcast, sendGridConfigured } from "@/lib/email/sendgrid";
import { flyerUrl, isAllowedFlyerDataUrl } from "@/lib/flyer";
import {
  sendSmsBroadcast,
  twilioConfigured,
  toE164US,
} from "@/lib/sms/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Where a contact came from. "coaches" = the coaches on a team registration,
 *  head AND assistant (the list that grows on its own as teams sign up);
 *  "subscribers" = the public Alerts sign-up form. */
type Source = "coaches" | "subscribers" | "all";

interface Contact {
  /** Stable across reloads so the compose screen's ticks survive a refresh. */
  id: string;
  name: string;
  teamName: string;
  email: string | null;
  phone: string | null;
  ageGroup: string | null;
  notifyBy: string;
  source: "coaches" | "subscribers";
  /** Only on coach rows, so the compose screen can label who is who. */
  role?: "head" | "assistant";
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Whether a submission may appear in a send list at all.
 *
 *  Neither collection below was filtered, which had two consequences nobody
 *  had noticed. A submission the office trashed stayed reachable forever,
 *  because a soft delete sets `deleted` and nothing here read it. And a
 *  submission the spam filter caught was still offered as a recipient: on
 *  2026-08-20 Adam opened Send Message on COYBL and found three bot signups
 *  from 8 August sitting in the list, two of them the same Gmail mailbox
 *  wearing different dots.
 *
 *  Mailing those addresses is not just untidy. Every league here sends through
 *  ONE shared SendGrid account, so bouncing mail at a bot costs the sender
 *  reputation of every other client on it.
 */
function isSendable(x: FirebaseFirestore.DocumentData): boolean {
  if (x.deleted === true) return false;
  if (Array.isArray(x.spam_flags) && x.spam_flags.length > 0) return false;
  return true;
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
    if (!isSendable(x)) continue;
    const teamName = typeof x.team_name === "string" ? x.team_name.trim() : "";
    const ageGroup = typeof x.age_group === "string" ? x.age_group : null;
    const nameOf = (first: unknown, last: unknown) =>
      [first, last]
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter(Boolean)
        .join(" ");

    out.push({
      id: `coach:${d.id}`,
      name: nameOf(x.manager_first_name, x.manager_last_name),
      teamName,
      email: typeof x.email === "string" ? x.email.trim() : null,
      phone: typeof x.phone === "string" ? x.phone.trim() : null,
      ageGroup,
      notifyBy: "both",
      source: "coaches",
      role: "head",
    });

    // THE ASSISTANT COACH. Mike, 2026-09-06: "how do I send message to the
    // coach and asst coach? Head coach getting the message but not asst
    // coach." The registration has asked for their email and phone all along,
    // required on Island, and this list simply never read them: 64 of 79
    // assistants were on file and none had ever been sent anything.
    //
    // They are a SEPARATE contact rather than extra addresses on the head
    // coach, so the compose screen can show them, count them, and let the
    // office untick one.
    const asstEmail = typeof x.asst_email === "string" ? x.asst_email.trim() : "";
    const asstPhone = typeof x.asst_phone === "string" ? x.asst_phone.trim() : "";
    const headEmail = typeof x.email === "string" ? x.email.trim() : "";
    const headPhone = typeof x.phone === "string" ? x.phone.trim() : "";
    // MOST ASSISTANTS ARE NOT A SECOND PERSON. On Island 39 of 64 registrations
    // put the head coach's own address in the assistant box. Listing that as a
    // second recipient makes the compose screen claim an audience twice the
    // size of the one that exists, and the office would untick rows all day.
    // Only skip when BOTH channels repeat: a shared mailbox with a different
    // mobile is still a person worth texting.
    const sameEmail =
      !!asstEmail && asstEmail.toLowerCase() === headEmail.toLowerCase();
    const samePhone =
      !asstPhone || (toE164US(asstPhone) ?? asstPhone) === (toE164US(headPhone) ?? headPhone);
    const duplicateOfHead = sameEmail && samePhone;
    if ((asstEmail || asstPhone) && !duplicateOfHead) {
      out.push({
        id: `asst:${d.id}`,
        name: nameOf(x.asst_first_name, x.asst_last_name),
        teamName,
        email: asstEmail || null,
        phone: asstPhone || null,
        ageGroup,
        notifyBy: "both",
        source: "coaches",
        role: "assistant",
      });
    }
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
    if (!isSendable(x)) continue;
    out.push({
      id: `sub:${d.id}`,
      name: typeof x.name === "string" ? x.name.trim() : "",
      teamName: "",
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

function audience(
  contacts: Contact[],
  ageGroup?: string | null,
  excludeIds?: Set<string>,
) {
  // "5 people will get it" with no way to see or change who is a blast nobody
  // sends confidently. The compose screen lists them and unticks anyone it
  // should not reach; those ids are dropped here, before any address is
  // resolved (Adam, 2026-08-12).
  const notExcluded = excludeIds?.size
    ? contacts.filter((c) => !excludeIds.has(c.id))
    : contacts;
  const inScope = ageGroup
    ? notExcluded.filter((c) => c.ageGroup === ageGroup)
    : notExcluded;
  // "both"/unset → email; "text"/"both" → sms.
  const emails = inScope
    .filter((c) => c.email && c.notifyBy !== "text")
    .map((c) => c.email!);
  // Dedupe on the DIALLED number, not the typed one. The set below used the
  // raw string, so "631-555-1234" and "(631) 555-1234" were two recipients and
  // one person got two texts. It mattered little while every number came from
  // a different coach; it matters now that assistants are on the list and
  // often share a phone with their head coach, typed differently.
  const dialled = new Map<string, string>();
  for (const c of inScope) {
    if (!c.phone || !(c.notifyBy === "text" || c.notifyBy === "both")) continue;
    const e164 = toE164US(c.phone);
    if (!e164) continue;
    if (!dialled.has(e164)) dialled.set(e164, c.phone);
  }
  return {
    emails: [...new Set(emails.map((e) => e.toLowerCase()))],
    phones: [...dialled.values()],
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
  // SCOPED. hasScope() lets the full admin through as before, and also the one
  // scoped role that declares "broadcast" in lib/admin-roles.ts. Every other
  // admin route still tests `!== "admin"` directly and so refuses a scoped
  // caller outright, which is the intended default: access widens only where
  // someone wrote it down.
  if (!hasScope(decoded, leagueId, "broadcast")) {
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
    sources: {
      coaches: countsFor(bySource(all, "coaches")),
      subscribers: countsFor(bySource(all, "subscribers")),
    },
    // WHO is about to be emailed. This used to be counts only, on the
    // principle of never shipping addresses to the browser — but the person
    // reading this screen is a league admin who can already see every coach's
    // address in Form submissions, and "5 people will get it" with no way to
    // check who is a blast nobody sends confidently (Adam, 2026-08-12).
    //
    // Reachability is stated per row so an unticked-looking list is not a
    // mystery: a coach with no email cannot be emailed however the box looks.
    recipients: (ageGroup
      ? selected.filter((c) => c.ageGroup === ageGroup)
      : selected
    ).map((c) => ({
      id: c.id,
      name: c.name || c.teamName || c.email || "(no name)",
      teamName: c.teamName,
      email: c.email,
      ageGroup: c.ageGroup,
      source: c.source,
      emailable: Boolean(c.email && c.notifyBy !== "text"),
    })),
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
    /** Recipient ids the admin unticked on the compose screen. */
    excludeIds?: unknown;
    /** A flyer image as a data: URL, validated by isAllowedFlyerDataUrl. */
    flyer?: unknown;
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

  // The flyer, saved before anything is sent.
  //
  // Written to its OWN document per send and never overwritten: the email
  // lives in an inbox for years and keeps asking for this image, so a single
  // "current flyer" would turn every flyer he ever sent into the newest one
  // and eventually into a broken image.
  //
  // A test send stores one too. It has to, or the test would show a blank
  // where the flyer goes and prove nothing about the send that matters.
  let flyerHref = "";
  if (isAllowedFlyerDataUrl(body.flyer)) {
    try {
      const ref = await getAdminDb()
        .collection(`leagues/${leagueId}/broadcast_flyers`)
        .add({
          data_url: body.flyer,
          subject,
          created_at: new Date().toISOString(),
          created_by_uid: gate.uid ?? null,
        });
      const origin =
        req.headers.get("origin") ??
        (req.headers.get("host") ? `https://${req.headers.get("host")}` : "");
      if (origin) flyerHref = flyerUrl(origin, leagueId, ref.id);
    } catch (e) {
      // A flyer that will not save must not swallow the message. The text is
      // the part that matters; the office would rather it went without the
      // picture than not at all.
      console.error("[admin-broadcast] flyer save failed:", e);
    }
  }
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
    // Anyone the admin unticked on the compose screen is dropped before their
    // address is ever resolved.
    const excludeIds = new Set(
      Array.isArray(body.excludeIds)
        ? (body.excludeIds as unknown[]).filter(
            (v): v is string => typeof v === "string",
          )
        : [],
    );
    const aud = audience(contacts, ageGroup, excludeIds);
    if (wantEmail) emails = aud.emails;
    if (wantSms) phones = aud.phones;
  }

  const result: Record<string, unknown> = { ok: true, test: isTest };

  // Email via SendGrid.
  if (wantEmail && emails.length) {
    const html =
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">` +
      esc(message).replace(/\n/g, "<br/>") +
      // Width capped in the STYLE as well as the attribute: Outlook ignores
      // max-width on its own and would render a 1200px flyer at full size,
      // pushing the whole message sideways.
      (flyerHref
        ? `<p style="margin:18px 0 0"><a href="${esc(flyerHref)}">` +
          `<img src="${esc(flyerHref)}" alt="Flyer" width="560" ` +
          `style="display:block;width:100%;max-width:560px;height:auto;border:0"/></a></p>` +
          `<p style="font-size:12px;color:#777;margin:6px 0 0">` +
          `Images off? <a href="${esc(flyerHref)}">Open the flyer</a>.</p>`
        : "") +
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
      // A text cannot carry an image without MMS, so the flyer goes in as a
      // link. Better than dropping it silently: the people on the text list
      // are often the ones who never open email.
      const smsBody =
        `${message}` +
        (flyerHref ? `\n\nFlyer: ${flyerHref}` : "") +
        `\n\nReply STOP to opt out.`;
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
