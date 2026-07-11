// Broadcast email via SendGrid (Twilio SendGrid). Env-gated: a no-op unless
// SENDGRID_API_KEY + SENDGRID_FROM are set, so the app runs fine unconfigured.
//
// Env vars (set in Vercel):
//   SENDGRID_API_KEY — from app.sendgrid.com (Settings → API Keys)
//   SENDGRID_FROM    — a VERIFIED sender: "COYBL <noreply@coybl.net>" or
//                      just "noreply@coybl.net" (verify the sender/domain in
//                      SendGrid first)
//
// One API call sends to the whole list via per-recipient personalizations, so
// recipients never see each other's addresses (no CC/BCC leak). SendGrid caps
// a request at 1000 personalizations, so we chunk.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function sendGridConfigured(): boolean {
  return !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM);
}

function parseFrom(from: string): { email: string; name?: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (m && m[2]) return { email: m[2].trim(), name: m[1]?.trim() || undefined };
  return { email: from.trim() };
}

/**
 * Send one email (same subject/body) to many recipients. Returns how many
 * addresses it was accepted for. `skipped: true` means SendGrid isn't
 * configured yet.
 */
export async function sendGridBroadcast(opts: {
  recipients: string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<{ ok: boolean; sent: number; skipped?: boolean; error?: string }> {
  const key = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM;
  if (!key || !from) return { ok: false, sent: 0, skipped: true };

  const to = [
    ...new Set(opts.recipients.map((e) => e.trim().toLowerCase())),
  ].filter((e) => EMAIL_RE.test(e));
  if (to.length === 0) return { ok: true, sent: 0 };

  const sender = parseFrom(from);
  const CHUNK = 900;
  let sent = 0;
  for (let i = 0; i < to.length; i += CHUNK) {
    const batch = to.slice(i, i + CHUNK);
    try {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          personalizations: batch.map((email) => ({ to: [{ email }] })),
          from: sender,
          ...(opts.replyTo ? { reply_to: { email: opts.replyTo } } : {}),
          subject: opts.subject,
          content: [{ type: "text/html", value: opts.html }],
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return {
          ok: false,
          sent,
          error: `SendGrid ${res.status}: ${t.slice(0, 200)}`,
        };
      }
      sent += batch.length;
    } catch (e) {
      return {
        ok: false,
        sent,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
  return { ok: true, sent };
}
