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

/** League-office inbox for new-submission notifications, or null. */
export function notifyAddress(): string | null {
  const v = process.env.EMAIL_NOTIFY;
  return v && EMAIL_RE.test(v) ? v : null;
}

/** Minimal HTML escape for interpolating user input into email bodies. */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
