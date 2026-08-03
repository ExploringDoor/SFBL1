// The "here is your team password" email.
//
// Island's coaches do not have accounts. Each TEAM has a password, and any
// coach holding it can open the team portal. So the moment an admin sets a
// team's password we mail it to whoever is on file as that team's manager,
// with instructions, instead of the league office texting fifty coaches by
// hand (Adam, 2026-08-03).
//
// Fires on team creation and on any later password change, which doubles as
// the resend path: change the password, everyone on file gets the new one.
//
// Deliberately plain about what the password is FOR. A coach who gets a
// password with no context assumes it is spam.

import { sendEmail, notifyAddress, esc } from "@/lib/email/send";

export interface CaptainWelcomeInput {
  to: string;
  coachName?: string;
  teamName: string;
  password: string;
  leagueName: string;
  leagueAbbrev: string;
  /** Site origin, so the sign-in link is absolute and clickable in mail. */
  origin: string;
  /** True when this replaces an existing password rather than being the first. */
  isReset?: boolean;
}

export async function sendCaptainWelcome(
  input: CaptainWelcomeInput,
): Promise<void> {
  const {
    to,
    coachName,
    teamName,
    password,
    leagueName,
    leagueAbbrev,
    origin,
    isReset,
  } = input;

  const signInUrl = `${origin.replace(/\/$/, "")}/captain`;
  const greeting = coachName ? `Hi ${esc(coachName)},` : "Hi Coach,";

  const intro = isReset
    ? `<p>Your team password for <strong>${esc(teamName)}</strong> has been updated. The new one is below — the old one no longer works.</p>`
    : `<p>Your coach access for <strong>${esc(teamName)}</strong> is ready. Here is everything you need to get in.</p>`;

  await sendEmail({
    to,
    subject: isReset
      ? `${leagueAbbrev}: new team password for ${teamName}`
      : `${leagueAbbrev}: your ${teamName} coach password`,
    html:
      `<p>${greeting}</p>` +
      intro +
      // The password gets its own block. Coaches read this on a phone and
      // will copy it by eye, so it needs to be big, monospaced and isolated
      // from the surrounding text.
      `<div style="margin:18px 0;padding:16px 18px;border:1px solid #d5dde5;border-radius:10px;background:#f6f9fc;">` +
      `<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#5b6b7c;margin-bottom:6px;">Your team password</div>` +
      `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:24px;font-weight:700;letter-spacing:.04em;color:#0b2e4f;">${esc(password)}</div>` +
      `</div>` +
      `<p style="font-weight:700;margin-bottom:6px;">How to sign in</p>` +
      `<ol style="margin:0 0 16px;padding-left:20px;line-height:1.7;">` +
      `<li>Go to <a href="${esc(signInUrl)}">${esc(signInUrl)}</a></li>` +
      `<li>Pick <strong>${esc(teamName)}</strong> from the team list</li>` +
      `<li>Enter the password above</li>` +
      `</ol>` +
      `<p style="margin:0 0 6px;font-weight:700;">What you can do once you are in</p>` +
      `<ul style="margin:0 0 16px;padding-left:20px;line-height:1.7;">` +
      `<li>Report your game scores</li>` +
      `<li>See your schedule and results in one place</li>` +
      `<li>Upload your team logo</li>` +
      `</ul>` +
      `<p style="font-size:13px;color:#555;">This password is for your whole coaching staff, so share it with your assistants. Anyone with it can report scores as ${esc(teamName)}, so please do not post it publicly. Need it changed? Reply to this email.</p>` +
      `<p>— ${esc(leagueName)}</p>`,
    replyTo: notifyAddress() ?? undefined,
  });
}

// Readable generated password: two short words plus two digits, e.g.
// "reef-storm-84". Avoids look-alike characters entirely, because these get
// read off a phone screen and typed on another one — a coach cannot tell
// l from 1 or O from 0, and every one of those is a support message.
const WORDS = [
  "arc", "ash", "bat", "bay", "bolt", "cove", "dash", "dawn", "dune", "east",
  "fern", "fox", "gale", "gem", "gold", "harbor", "iron", "jet", "kite", "lark",
  "moss", "north", "oak", "onyx", "peak", "pine", "quartz", "reef", "ridge",
  "sand", "shore", "storm", "surf", "tide", "vale", "wave", "west", "wind",
];

export function generateTeamPassword(): string {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)]!;
  let a = pick();
  let b = pick();
  while (b === a) b = pick();
  const n = 10 + Math.floor(Math.random() * 90);
  return `${a}-${b}-${n}`;
}
