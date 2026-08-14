// Best-effort transactional email via Resend's REST API.
//
// Env-gated: with no RESEND_API_KEY / EMAIL_FROM the whole thing is a
// no-op (logs and returns skipped) — so the app runs fine with email
// unconfigured, and turning it on is purely setting env vars. No SDK
// dependency; just fetch to Resend's REST endpoint.
//
// Env vars (set in Vercel):
//   RESEND_API_KEY — from resend.com (free tier ~3k emails/mo)
//   EMAIL_FROM     — a VERIFIED sender on your domain, e.g.
//                    "SFBL <noreply@sfbl.com>" (verify sfbl.com in
//                    Resend first)
//   EMAIL_NOTIFY   — league-office inbox that gets a ping on each new
//                    registration (e.g. playball@sfbl.com)

import { sendGridConfigured, sendGridOne } from "./sendgrid";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  if (!opts.to || !EMAIL_RE.test(opts.to)) {
    return { ok: false, error: "invalid recipient" };
  }
  // Prefer SendGrid when configured (COYBL); other tenants fall back to Resend.
  if (sendGridConfigured()) {
    return sendGridOne(opts);
  }
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) {
    // Not configured — no-op so registration still succeeds.
    console.log(
      "[email] skipped (no email provider configured):",
      opts.subject,
    );
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Every league-office inbox that should be told about a registration, a
 * payment, a captain's message or a disputed score.
 *
 * EMAIL_NOTIFY takes a comma or semicolon separated list, because a league
 * office is rarely one person — Mike runs Island with an assistant and both
 * need the score disputes (asked 2026-08-13).
 *
 * This used to be a single address tested against EMAIL_RE, and putting two in
 * it FAILED SILENTLY: the comma broke the regex, notifyAddress() returned null,
 * and every call site treats null as "no office configured" and sends nothing.
 * So the obvious thing to try turned all office email off with no error.
 *
 * Duplicates are dropped so the same person is not mailed twice when a list
 * has been pasted together from two places.
 */
export function notifyAddresses(): string[] {
  return (process.env.EMAIL_NOTIFY ?? "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s, i, a) => EMAIL_RE.test(s) && a.indexOf(s) === i);
}

/**
 * The FIRST league-office inbox, or null.
 *
 * For Reply-To, which takes one address. When choosing who RECEIVES something,
 * use notifyAddresses() — otherwise everyone after the first is silently
 * dropped, which is the bug this pair exists to prevent.
 */
export function notifyAddress(): string | null {
  return notifyAddresses()[0] ?? null;
}

/**
 * Send one message to EVERY league-office inbox, and report how many landed.
 *
 * Every office notification goes through here rather than each route reading
 * the address itself, so adding a second recipient is one env var and not a
 * hunt through five call sites for the one that still says `to: notify`.
 *
 * Best-effort by design: office mail must never fail the thing that triggered
 * it. A coach's registration, a card payment and a score report all succeed
 * whether or not the office hears about it, so a bad address for one recipient
 * cannot stop the others being told.
 *
 * Returns 0 when no office is configured, which callers use to decide whether
 * to stamp an "email sent" flag.
 */
export async function notifyOffice(opts: {
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<number> {
  let sent = 0;
  for (const to of notifyAddresses()) {
    try {
      const r = await sendEmail({ ...opts, to });
      if (r.ok) sent++;
      else if (!r.skipped) {
        console.error("[email] office notify failed", { to, error: r.error });
      }
    } catch (err) {
      console.error("[email] office notify threw", { to, err });
    }
  }
  return sent;
}

/** Minimal HTML escape for interpolating user input into email bodies. */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
