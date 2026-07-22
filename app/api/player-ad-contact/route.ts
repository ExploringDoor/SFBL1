// POST /api/player-ad-contact — relay a reply to whoever posted a player ad.
//
// The public board deliberately carries no contact details (see
// /api/admin-player-ads). This is how someone answers an ad without either
// side's address being published: the responder posts a message here, the
// server looks the poster's email up out of the PRIVATE submission and sends
// it on. The responder never learns the poster's address, and the poster gets
// the responder's only because the responder chose to supply it.
//
// The poster's address goes in the `to` header of an email nobody else sees;
// it is never returned in the HTTP response. Do not add it to the JSON.
//
// Only APPROVED ads are contactable — an ad sitting in the moderation queue,
// or one that was rejected, must not be reachable by guessing its id.
//
// Body: { adId, from_name, from_email, message }

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { parseHost, resolveTenant } from "@/lib/tenants";
import { sendEmail, esc } from "@/lib/email/send";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Per-IP, same shape as /api/league-form. Lower ceiling: this one sends mail
// to a third party, so it is the more attractive thing to abuse.
const rate = new Map<string, { count: number; reset: number }>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 3;

export async function POST(req: Request) {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const tenant = await resolveTenant(parseHost(host));
  const tenantId = tenant?.id ?? null;
  if (!tenantId) {
    return NextResponse.json({ error: "no tenant" }, { status: 400 });
  }

  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const entry = rate.get(ip);
  if (entry && now < entry.reset) {
    if (entry.count >= RATE_LIMIT) {
      return NextResponse.json(
        { error: "Too many messages. Try again in a few minutes." },
        { status: 429 },
      );
    }
    entry.count++;
  } else {
    rate.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
  }

  let body: {
    adId?: unknown;
    from_name?: unknown;
    from_email?: unknown;
    message?: unknown;
    website?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Honeypot — same silent-200 as the intake form.
  if (typeof body.website === "string" && body.website.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const adId = typeof body.adId === "string" ? body.adId.trim() : "";
  const fromName =
    typeof body.from_name === "string" ? body.from_name.trim() : "";
  const fromEmail =
    typeof body.from_email === "string" ? body.from_email.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!adId) return NextResponse.json({ error: "adId required" }, { status: 400 });
  if (!fromName) {
    return NextResponse.json({ error: "Your name is required" }, { status: 400 });
  }
  if (!EMAIL_RE.test(fromEmail)) {
    return NextResponse.json(
      { error: "A valid email is required so they can reply" },
      { status: 400 },
    );
  }
  if (message.length < 5) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }
  if (message.length > 4000) {
    return NextResponse.json({ error: "Message is too long" }, { status: 400 });
  }

  const db = getAdminDb();

  // Gate on the PUBLIC doc: its existence is what "approved" means. Reading the
  // private submission first would make unapproved ads contactable by id.
  const pub = await db.doc(`leagues/${tenantId}/player_ads/${adId}`).get();
  if (!pub.exists) {
    return NextResponse.json({ error: "Ad not found" }, { status: 404 });
  }

  const priv = await db
    .doc(`leagues/${tenantId}/form_submissions/player_ad/items/${adId}`)
    .get();
  const owner = priv.data() ?? {};
  const to = typeof owner.email === "string" ? owner.email : "";
  if (!EMAIL_RE.test(to)) {
    return NextResponse.json(
      { error: "That ad has no reachable contact on file." },
      { status: 409 },
    );
  }

  const leagueName =
    (tenant?.config as { name?: string } | undefined)?.name ?? "the league";
  const adLine = [
    pub.data()?.age_group,
    pub.data()?.position,
    pub.data()?.town,
  ]
    .filter(Boolean)
    .join(" · ");

  const sent = await sendEmail({
    to,
    // replyTo is what lets the poster answer directly. It is the RESPONDER's
    // address, which they supplied for exactly this purpose.
    replyTo: fromEmail,
    subject: `${leagueName}: someone answered your player ad`,
    html: `
      <p><strong>${esc(fromName)}</strong> replied to your ${esc(leagueName)} player ad${
        adLine ? ` (${esc(adLine)})` : ""
      }.</p>
      <p style="white-space:pre-wrap;border-left:3px solid #ccc;padding-left:12px">${esc(
        message,
      )}</p>
      <p>Reply to this email to reach them, or contact them at
        <a href="mailto:${esc(fromEmail)}">${esc(fromEmail)}</a>.</p>
      <hr>
      <p style="color:#666;font-size:12px">Your contact details were not shown
        on the ${esc(leagueName)} website. This message was relayed to you.</p>
    `,
  });

  // Log the relay for moderation/abuse review. Contact details of BOTH parties
  // live here, in the default-deny form_submissions tree, not on the public doc.
  await db
    .collection(`leagues/${tenantId}/form_submissions/player_ad_contact/items`)
    .add({
      ad_id: adId,
      from_name: fromName,
      from_email: fromEmail,
      message,
      delivered: sent.ok,
      email_skipped: sent.skipped ?? false,
      sent_at: new Date().toISOString(),
      ip,
    });

  // `sent.skipped` means RESEND_API_KEY / EMAIL_FROM are unset. Say so rather
  // than claiming delivery — otherwise a league with no mail configured shows
  // "Message sent" forever while nothing arrives.
  if (sent.skipped) {
    return NextResponse.json({
      ok: true,
      delivered: false,
      note: "Saved, but league email is not configured yet.",
    });
  }
  return NextResponse.json({ ok: true, delivered: sent.ok });
}
