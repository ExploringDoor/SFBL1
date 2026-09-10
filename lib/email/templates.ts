// The emails this platform sends, as one set of builders.
//
// These used to be written inline in the route handlers, which meant the only
// way to see one was to trigger it for real — register a fake team, or charge
// a real card. /api/admin-email-preview needs the SAME html the routes send,
// and a second copy of it would drift the first time anyone edited a subject
// line. So the routes and the preview both build from here.
//
// Each builder returns { subject, html } and does its own escaping. Nothing
// here reads env or touches the network; that stays in lib/email/send.

import { esc } from "@/lib/email/send";

export interface Built {
  subject: string;
  html: string;
}

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

/** The coach's welcome, carrying the team sign-in code. */
export function coachCodeEmail(o: {
  who: string;
  team: string;
  teamCode: string | null;
  origin: string;
  leagueName: string;
  leagueAbbrev: string;
  tenantId: string;
}): Built {
  // No code means provisioning failed upstream. Still confirm the
  // registration, but do not promise a code we cannot supply.
  const codeBlock = o.teamCode
    ? `<p>Your team's sign-in code is:</p>` +
      `<p style="font:700 34px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.18em;` +
      `background:#f1f4f8;border:1px solid #d3dce7;border-radius:10px;padding:16px 22px;` +
      `display:inline-block;color:#13284a;">${esc(o.teamCode)}</p>` +
      `<p>Go to <a href="${esc(o.origin)}/captain">${esc(o.origin)}/captain</a>, pick ` +
      `<strong>${esc(o.team) || "your team"}</strong> from the list, and type that code. ` +
      `There is no account to create and no password to remember.</p>` +
      `<p>Keep it to your coaching staff. Anyone with the code can enter scores for your team.</p>`
    : `<p>Your team's sign-in code is being set up. The league office will send ` +
      `it shortly. If you don't hear back in a day or two, just reply here.</p>`;

  // This list has to match the tabs app/captain/page.tsx actually renders for
  // the tenant. "Log pitch counts" was promised to every league, but that tab
  // is COYBL-only and Island sets show_pitch_counts:false — so an Island coach
  // was sent looking for a feature not on their screen. Pitch counts are a
  // Little League baseball rule; Island is girls fastpitch.
  const canDo =
    o.tenantId === "coybl"
      ? "post your games, enter scores, log pitch counts, and upload your team logo"
      : "submit your scores, manage your roster and attendance, and upload your team logo";

  return {
    subject: `Welcome to ${o.leagueAbbrev}${o.team ? ` — ${o.team}` : ""}`,
    html:
      `<p>Hi ${esc(o.who) || "Coach"},</p>` +
      `<p>Thanks for registering${o.team ? ` <strong>${esc(o.team)}</strong>` : ""} with ` +
      `${esc(o.leagueName)}. We've got your registration.</p>` +
      codeBlock +
      `<p>From there you can ${canDo}.</p>` +
      `<p>A league director will confirm your division shortly. Questions? Just reply to this email.</p>` +
      `<p>— ${esc(o.leagueAbbrev)}</p>`,
  };
}

/** What the league office gets when a coach registers a team. */
export function officeRegistrationEmail(o: {
  leagueAbbrev: string;
  team: string;
  who: string;
  email: string;
  phone: string;
  ageGroup: string;
  division?: string;
  gamechangerLink?: string;
  /** How the coach said they intend to pay. Nothing can watch a Venmo land,
   *  so telling the office what to WATCH FOR is the next best thing. */
  payMethod?: string;
  insuranceOption?: string;
  usssaAddon?: boolean;
  homeField?: string;
  homeFieldName?: string;
}): Built {
  return {
    subject: `New ${o.leagueAbbrev} team registration: ${o.team || o.who || "(no name)"}`,
    html:
      `<p><strong>Team:</strong> ${esc(o.team)}</p>` +
      `<p><strong>Age group:</strong> ${esc(o.ageGroup)}</p>` +
      `<p><strong>Coach:</strong> ${esc(o.who)}</p>` +
      `<p><strong>Email:</strong> ${esc(o.email)}</p>` +
      `<p><strong>Phone:</strong> ${esc(o.phone)}</p>` +
      // "Option" is COYBL's insurance choice. Island never collects it, so the
      // line rendered permanently blank while the two things the office needs
      // — which league, and the GameChanger link the site pulls schedules from
      // — were missing entirely.
      (o.insuranceOption
        ? `<p><strong>Option:</strong> ${esc(o.insuranceOption)}` +
          `${o.usssaAddon ? " (USSSA add-on)" : ""}</p>`
        : "") +
      (o.division ? `<p><strong>League:</strong> ${esc(o.division)}</p>` : "") +
      (o.payMethod
        ? `<p><strong>Paying by:</strong> ${esc(o.payMethod)}</p>`
        : "") +
      (o.gamechangerLink
        ? `<p><strong>GameChanger:</strong> ${esc(o.gamechangerLink)}</p>`
        : "") +
      // The home-field claim is the whole reason the form asks. It does not
      // change the price — the office confirms it and applies the discount.
      (o.homeField === "yes"
        ? `<p><strong>Home field:</strong> YES — ${
            esc(o.homeFieldName) || "field not named"
          } (may qualify for the $200 discount)</p>`
        : "") +
      `<p>View it in the admin Registrations tab.</p>`,
  };
}

/** The coach's receipt after a card payment. */
export function paymentReceiptEmail(o: {
  firstName: string;
  team: string;
  feeCents: number;
  totalCents: number;
  receiptUrl?: string | null;
}): Built {
  const surcharge = o.totalCents - o.feeCents;
  return {
    subject: `Payment received — ${o.team}`,
    html:
      `<p>Hi ${esc(o.firstName) || "Coach"},</p>` +
      `<p>Thanks — we have received your team fee for ` +
      `<strong>${esc(o.team)}</strong>.</p>` +
      `<table style="border-collapse:collapse;margin:14px 0">` +
      `<tr><td style="padding:4px 18px 4px 0;color:#555">Team fee</td>` +
      `<td style="padding:4px 0;text-align:right"><strong>${money(o.feeCents)}</strong></td></tr>` +
      (surcharge > 0
        ? `<tr><td style="padding:4px 18px 4px 0;color:#555">Card processing fee</td>` +
          `<td style="padding:4px 0;text-align:right">${money(surcharge)}</td></tr>`
        : "") +
      `<tr><td style="padding:8px 18px 4px 0;border-top:1px solid #ddd"><strong>Paid</strong></td>` +
      `<td style="padding:8px 0 4px;text-align:right;border-top:1px solid #ddd">` +
      `<strong>${money(o.totalCents)}</strong></td></tr>` +
      `</table>` +
      (o.receiptUrl
        ? `<p><a href="${esc(o.receiptUrl)}">View your Square receipt</a></p>`
        : "") +
      `<p>Keep this for your records. Questions? Just reply to this email.</p>`,
  };
}

/** What the office gets when a card payment lands. */
export function officePaymentEmail(o: {
  team: string;
  firstName: string;
  lastName: string;
  payerEmail?: string;
  feeCents: number;
  totalCents: number;
  receiptUrl?: string | null;
}): Built {
  const surcharge = o.totalCents - o.feeCents;
  return {
    subject: `Payment received: ${o.team} — ${money(o.totalCents)}`,
    html:
      `<p><strong>${esc(o.team)}</strong> has paid by card.</p>` +
      `<p>Amount: <strong>${money(o.totalCents)}</strong> ` +
      `(fee ${money(o.feeCents)}${surcharge > 0 ? `, card ${money(surcharge)}` : ""})</p>` +
      `<p>Coach: ${esc(o.firstName)} ${esc(o.lastName)}` +
      (o.payerEmail ? ` &lt;${esc(o.payerEmail)}&gt;` : "") +
      `</p>` +
      (o.receiptUrl
        ? `<p><a href="${esc(o.receiptUrl)}">View your Square receipt</a></p>`
        : "") +
      `<p>It is on the admin Payments tab.</p>`,
  };
}

/** The parent's receipt after a clinic place is paid for by card.
 *
 *  Separate from paymentReceiptEmail rather than a mode on it. That one is a
 *  COACH receipt: it opens "Hi Coach", thanks them for a team fee, and names a
 *  team. Sending it to a parent produced a receipt addressed to a coach, for a
 *  team fee, for a team called "your team", naming no player, which Mike then
 *  could not match to a child. Two audiences, two templates, and the team one
 *  stays untouched for every other tenant. */
export function clinicReceiptEmail(o: {
  parentFirstName: string;
  player: string;
  feeCents: number;
  totalCents: number;
  receiptUrl?: string | null;
}): Built {
  const surcharge = o.totalCents - o.feeCents;
  const who = o.player || "your player";
  return {
    subject: `College Clinic place confirmed, ${who}`,
    html:
      `<p>Hi ${esc(o.parentFirstName) || "there"},</p>` +
      `<p>Thank you. <strong>${esc(who)}</strong> has a place at the College Clinic ` +
      `and the fee is paid.</p>` +
      `<table style="border-collapse:collapse;margin:14px 0">` +
      `<tr><td style="padding:4px 18px 4px 0;color:#555">Clinic fee</td>` +
      `<td style="padding:4px 0;text-align:right"><strong>${money(o.feeCents)}</strong></td></tr>` +
      (surcharge > 0
        ? `<tr><td style="padding:4px 18px 4px 0;color:#555">Card processing fee</td>` +
          `<td style="padding:4px 0;text-align:right">${money(surcharge)}</td></tr>`
        : "") +
      `<tr><td style="padding:8px 18px 4px 0;border-top:1px solid #ddd"><strong>Paid</strong></td>` +
      `<td style="padding:8px 0 4px;text-align:right;border-top:1px solid #ddd">` +
      `<strong>${money(o.totalCents)}</strong></td></tr>` +
      `</table>` +
      (o.receiptUrl
        ? `<p><a href="${esc(o.receiptUrl)}">View your Square receipt</a></p>`
        : "") +
      `<p>Bring a glove, bat, helmet, cleats and water. Wear your travel team ` +
      `uniform if you have one.</p>` +
      `<p>Keep this for your records. Questions, just reply to this email.</p>`,
  };
}

/** What the office gets when a clinic place is paid for.
 *
 *  Leads with the player, the grad year and the age group, because those are
 *  the three things Mike groups the day by, and the team version led with a
 *  team name that for a clinic is always empty. */
export function officeClinicPaymentEmail(o: {
  player: string;
  gradYear?: string;
  ageGroup?: string;
  parent: string;
  payerEmail?: string;
  feeCents: number;
  totalCents: number;
  receiptUrl?: string | null;
}): Built {
  const surcharge = o.totalCents - o.feeCents;
  const who = o.player || "(unnamed player)";
  return {
    subject: `College Clinic PAID: ${who}${o.gradYear ? ` (${o.gradYear})` : ""} ${money(o.totalCents)}`,
    html:
      `<p><strong>${esc(who)}</strong> has a paid place at the College Clinic.</p>` +
      `<p>` +
      (o.gradYear ? `Grad year: ${esc(o.gradYear)}<br/>` : "") +
      (o.ageGroup ? `Age group: ${esc(o.ageGroup)}<br/>` : "") +
      `Parent: ${esc(o.parent)}` +
      (o.payerEmail ? ` &lt;${esc(o.payerEmail)}&gt;` : "") +
      `</p>` +
      `<p>Amount: <strong>${money(o.totalCents)}</strong> ` +
      `(fee ${money(o.feeCents)}${surcharge > 0 ? `, card ${money(surcharge)}` : ""})</p>` +
      (o.receiptUrl
        ? `<p><a href="${esc(o.receiptUrl)}">View the Square receipt</a></p>`
        : "") +
      `<p>It is on the College Clinic tab in Admin, Form intake. Clinic places ` +
      `are not on the Payments tab: that is the team ledger, and a clinic place ` +
      `is not a team.</p>`,
  };
}

/** Confirmation that a signed team waiver arrived. */
export function waiverConfirmationEmail(o: {
  who: string;
  team: string;
  leagueName: string;
  leagueAbbrev: string;
}): Built {
  return {
    subject: `We got your ${o.leagueAbbrev} team waiver`,
    html:
      `<p>Hi ${esc(o.who) || "there"},</p>` +
      `<p>Thanks for signing the waiver for ${esc(o.leagueName)}. ` +
      `We have it on file — nothing else is needed.</p>` +
      (o.team ? `<p><strong>Team:</strong> ${esc(o.team)}</p>` : "") +
      `<p>Questions? Reply to this email or text the league office.</p>` +
      `<p>— ${esc(o.leagueAbbrev)}</p>`,
  };
}
