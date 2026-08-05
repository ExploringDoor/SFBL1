// A team's sign-in code.
//
// COYBL coaches sign in by picking their team and typing a 5-digit code
// (Adam, 2026-08-04). No account, no password to choose, nothing to reset.
// The code is generated when the coach registers and emailed to them, and the
// league office can read or regenerate it from the admin panel.
//
// 5 digits is 90,000 codes. That is small enough to guess given unlimited
// tries, so /api/public-captain-claim locks a team out after repeated wrong
// codes. The code is a convenience credential for entering youth-baseball
// scores, not a secret worth protecting like a password, and it is weighed
// accordingly: easy to read down a phone line, hard to grind through.

import { randomInt } from "node:crypto";

/**
 * A fresh 5-digit code, 10000-99999.
 *
 * Never starts with 0. A leading zero survives a round trip through this
 * server fine, but it does not survive a coach reading "04820" off a phone
 * screen, or a spreadsheet that helpfully drops it.
 */
export function generateTeamCode(): string {
  return String(randomInt(10000, 100000));
}

/** Is this a well-formed team code? */
export function isTeamCode(v: unknown): v is string {
  return typeof v === "string" && /^[0-9]{5}$/.test(v.trim());
}
