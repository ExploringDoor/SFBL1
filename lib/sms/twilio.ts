// Broadcast SMS via Twilio. Env-gated: a no-op unless TWILIO_ACCOUNT_SID +
// TWILIO_AUTH_TOKEN + TWILIO_FROM are set.
//
// Env vars (set in Vercel):
//   TWILIO_ACCOUNT_SID — from console.twilio.com
//   TWILIO_AUTH_TOKEN  — from console.twilio.com (keep secret)
//   TWILIO_FROM        — a Twilio phone number in E.164, e.g. "+16145550123"
//
// Twilio auto-handles STOP/START/HELP opt-out replies for the sending number,
// so unsubscribes are compliant without extra wiring. There is one API call
// per recipient, so callers should bound the concurrency.

export function twilioConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM
  );
}

/**
 * Normalize a US phone to E.164 (+1XXXXXXXXXX). Returns null if it doesn't look
 * like a 10-digit US number (or 11 digits starting with 1).
 */
export function toE164US(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = String(raw).replace(/[^\d]/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (raw.trim().startsWith("+")) return raw.trim(); // already E.164-ish
  return null;
}

export async function sendSms(
  to: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) return { ok: false, error: "not configured" };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: `Twilio ${res.status}: ${t.slice(0, 160)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Send the same text to many recipients with bounded concurrency. */
export async function sendSmsBroadcast(
  recipients: string[],
  body: string,
  concurrency = 8,
): Promise<{ sent: number; failed: number; errors: string[] }> {
  const nums = [
    ...new Set(recipients.map((r) => toE164US(r)).filter((n): n is string => !!n)),
  ];
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (let i = 0; i < nums.length; i += concurrency) {
    const batch = nums.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((n) => sendSms(n, body)));
    for (const r of results) {
      if (r.ok) sent++;
      else {
        failed++;
        if (r.error && errors.length < 5) errors.push(r.error);
      }
    }
  }
  return { sent, failed, errors };
}
