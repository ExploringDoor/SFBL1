// A malformed reply-to must never take down an otherwise deliverable message.
//
// Found in COYBL's pre-season audit, 2026-09-10. Umpire #11 registered as
// "Lawrencefelixhrnry@yahoo. com" — a space before the TLD. His own
// confirmation was undeliverable, which is correct and expected. But the
// OFFICE copy, addressed to Doug at a good address, ALSO failed, because it
// carried the same broken string as its reply-to and SendGrid rejects the
// whole message over it. The league never learned that umpire existed.
//
// Pinned here rather than left to a comment because the same pattern is on
// every public form that replies to the submitter: umpire registration,
// tournament entries and baseball orders all set reply-to from whatever a
// stranger typed.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL = { ...process.env };

async function sendWith(replyTo: string | undefined) {
  const calls: any[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: any) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, status: 202, text: async () => "" } as any;
  });
  const { sendEmail } = await import("@/lib/email/send");
  const res = await sendEmail({
    to: "office@example.com",
    subject: "s",
    html: "<p>h</p>",
    replyTo,
  });
  return { res, body: calls[0] };
}

describe("reply-to is sanitised, not trusted", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SENDGRID_API_KEY = "SG.test";
    process.env.SENDGRID_FROM = "COYBL <noreply@coybl.org>";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL };
  });

  it("still delivers when the reply-to has a space in it", async () => {
    const { res, body } = await sendWith("Lawrencefelixhrnry@yahoo. com");
    expect(res.ok).toBe(true);
    expect(body.reply_to).toBeUndefined();
  });

  it("keeps a valid reply-to", async () => {
    const { res, body } = await sendWith("coach@example.com");
    expect(res.ok).toBe(true);
    expect(body.reply_to).toEqual({ email: "coach@example.com" });
  });

  it("drops other malformed shapes rather than failing", async () => {
    for (const bad of ["no-at-sign", "two@@at.com", "trailing@dot.", "", "   "]) {
      const { res, body } = await sendWith(bad);
      expect(res.ok, `should still send with replyTo=${JSON.stringify(bad)}`).toBe(true);
      expect(body.reply_to).toBeUndefined();
    }
  });

  it("trims a valid address that arrived padded", async () => {
    const { body } = await sendWith("  coach@example.com  ");
    expect(body.reply_to).toEqual({ email: "coach@example.com" });
  });

  it("an invalid TO is still refused — that guard is unchanged", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 202, text: async () => "" }) as any);
    const { sendEmail } = await import("@/lib/email/send");
    const res = await sendEmail({ to: "broken@ address.com", subject: "s", html: "h" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("invalid recipient");
  });
});
