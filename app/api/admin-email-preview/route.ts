// POST /api/admin-email-preview — send yourself every email this league can
// send, with sample data, so the wording can be reviewed without registering a
// fake team or charging a real card.
//
// Why this exists: Adam asked to see the templates. Triggering the real forms
// only shows the COACH's copies — the office notifications go to EMAIL_NOTIFY
// (Mike), so the person reviewing never sees half of them. And the payment
// receipt cannot be triggered at all without moving real money.
//
// Body: { leagueId, to }  →  { ok, sent: [...] }
//
// Admin-only, and `to` is the only address it will ever send to, so this
// cannot be used to mail anyone else. Subjects are prefixed [PREVIEW] so a
// sample can never be mistaken for a real registration or a real receipt.

import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";
import { sendEmail, notifyAddress, esc } from "@/lib/email/send";
import {
  coachCodeEmail,
  officeRegistrationEmail,
  paymentReceiptEmail,
  officePaymentEmail,
  waiverConfirmationEmail,
} from "@/lib/email/templates";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  let body: { leagueId?: unknown; to?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (typeof leagueId !== "string" || !/^[a-z0-9_-]+$/.test(leagueId)) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  if (!EMAIL_RE.test(to)) {
    return NextResponse.json({ error: "a valid `to` address is required" }, { status: 400 });
  }
  const leagues = decoded.leagues as Record<string, string> | undefined;
  if (leagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const name = leagueId === "island" ? "Island Fastpitch" : leagueId;
  const abbrev = leagueId === "island" ? "IFP" : leagueId.toUpperCase();
  const origin = new URL(req.url).origin;

  const sample = {
    who: "Chris Morgan",
    firstName: "Chris",
    lastName: "Morgan",
    team: "Long Island Lightning 12U",
    email: "chris.morgan@example.com",
    phone: "631-555-0148",
    ageGroup: "12U",
    division: "weekend",
    gamechanger: "https://web.gc.com/teams/example",
    code: "48213",
    feeCents: 79500,
    totalCents: 81905,
    receiptUrl: "https://squareup.com/receipt/preview/EXAMPLE",
  };

  const previews: { label: string; subject: string; html: string }[] = [
    {
      label: "1. Coach — registration + sign-in code",
      ...coachCodeEmail({
        who: sample.who,
        team: sample.team,
        teamCode: sample.code,
        origin,
        leagueName: name,
        leagueAbbrev: abbrev,
        tenantId: leagueId,
      }),
    },
    {
      label: "2. Office — new registration",
      ...officeRegistrationEmail({
        leagueAbbrev: abbrev,
        team: sample.team,
        who: sample.who,
        email: sample.email,
        phone: sample.phone,
        ageGroup: sample.ageGroup,
        division: sample.division,
        gamechangerLink: sample.gamechanger,
      }),
    },
    {
      label: "3. Coach — card payment receipt",
      ...paymentReceiptEmail({
        firstName: sample.firstName,
        team: sample.team,
        feeCents: sample.feeCents,
        totalCents: sample.totalCents,
        receiptUrl: sample.receiptUrl,
      }),
    },
    {
      label: "4. Office — payment received",
      ...officePaymentEmail({
        team: sample.team,
        firstName: sample.firstName,
        lastName: sample.lastName,
        payerEmail: sample.email,
        feeCents: sample.feeCents,
        totalCents: sample.totalCents,
        receiptUrl: sample.receiptUrl,
      }),
    },
    {
      label: "5. Coach — team waiver received",
      ...waiverConfirmationEmail({
        who: sample.who,
        team: sample.team,
        leagueName: name,
        leagueAbbrev: abbrev,
      }),
    },
  ];

  const sent: string[] = [];
  const failed: { label: string; error: string }[] = [];
  for (const p of previews) {
    const banner =
      `<div style="border:2px dashed #c00;padding:10px;margin-bottom:16px;` +
      `color:#c00;font:700 13px system-ui">PREVIEW — sample data, not a real ` +
      `registration or payment. ${esc(p.label)}</div>`;
    const r = await sendEmail({
      to,
      subject: `[PREVIEW] ${p.subject}`,
      html: banner + p.html,
      replyTo: notifyAddress() ?? undefined,
    });
    if (r.ok) sent.push(p.label);
    else failed.push({ label: p.label, error: r.error ?? "unknown" });
  }

  return NextResponse.json({ ok: failed.length === 0, to, sent, failed });
}
