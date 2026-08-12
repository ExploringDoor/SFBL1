// Fee and surcharge rules. No network, no crypto, no server-only imports —
// this is imported by CLIENT components (the admin's manual payment recorder)
// as well as by the API routes, and lib/square.ts pulls in node:crypto, which
// cannot be bundled for the browser.
//
// Keeping the arithmetic here is also what stops the two paths drifting: the
// admin's Venmo/cheque recorder used to carry its own copy of COYBL's fee
// table, so recording a manual payment for an Island team wrote $495 against
// a team that owes $795 and marked them paid in full.



function testFeeOverride(): number | null {
  const raw = process.env.LEAGUE_TEST_FEE ?? process.env.COYBL_TEST_FEE;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 3.25% card processing fee, passed to the payer (per Doug). Card only —
 *  Venmo and check have no surcharge.
 *
 *  COYBL ONLY. Island cannot use a flat percentage — see nyCompliantTotal(). */
export const CARD_SURCHARGE = 0.0325;

// 2027 COYBL fees. Mirrors the copy on /team-registration.
const FEE_WITH_INSURANCE = 495;
const FEE_WITHOUT_INSURANCE = 425;
const USSSA_ADDON = 50;

// Island Fastpitch fees. Mirrors the League page: weeknight / weekend /
// college are all $795, 8U Weekend is $500. The $200 home-field discount is
// deliberately NOT applied here — Mike adjusts qualifying teams by hand after
// registration (his call, 2026-08-11), because self-claiming at checkout gets
// claimed by teams that do not qualify.
const ISLAND_FEE_DEFAULT = 795;
const ISLAND_FEE_8U = 500;

// What Square actually charges for an online card payment. The surcharge is
// derived from this rather than being a round number, which is a legal
// requirement in New York, not a preference — see nyCompliantTotal().
const SQUARE_PCT = 0.029;
const SQUARE_FIXED = 0.3;

/**
 * Total to charge a card so the league nets EXACTLY `fee`, with the surcharge
 * equal to Square's real cost of acceptance and no more.
 *
 * New York General Business Law 518 (in force since Feb 2024) allows passing
 * the card fee on, but only if
 *   (a) the card price is displayed up front, not added at the end, and
 *   (b) the surcharge does not EXCEED the merchant's actual cost.
 * Violations are up to $500 each, which across a 50-team season is real money.
 *
 * A flat 3.25% like COYBL's fails (b): on $795 Square takes $23.36 (2.94%),
 * so 3.25% would over-collect by $2.48 per team.
 *
 * Solving `total - (total*pct + fixed) = fee` gives the total below. Rounded
 * DOWN to the cent on purpose: rounding up could put the surcharge a fraction
 * over true cost, which is the side of the line that carries a penalty.
 */
export function nyCompliantTotal(fee: number): number {
  const exact = (fee + SQUARE_FIXED) / (1 - SQUARE_PCT);
  return Math.floor(exact * 100) / 100;
}

/** Registration fee in whole dollars, derived from the submitted answers.
 *
 *  Tenant-scoped: the two leagues price completely differently, and reading
 *  COYBL's insurance/USSSA answers off an Island registration silently
 *  produced COYBL's $495 for an Island team. leagueId is required rather than
 *  optional so a new caller cannot forget it and get COYBL's numbers. */
export function feeFor(
  leagueId: string,
  data: Record<string, unknown>,
): number {
  const testFee = testFeeOverride();
  if (testFee !== null) return testFee;

  if (leagueId === "island") {
    // 8U Weekend is the only cheaper tier; every other age and league is $795.
    return String(data.age_group ?? "").trim() === "8U"
      ? ISLAND_FEE_8U
      : ISLAND_FEE_DEFAULT;
  }

  const option = String(data.insurance_option ?? "");
  const usssa = String(data.usssa_addon ?? "");
  // option-2 is "we provide our own insurance"; anything else falls back to
  // the league-provides-insurance price, which is the safe default.
  const base =
    option === "option-2" ? FEE_WITHOUT_INSURANCE : FEE_WITH_INSURANCE;
  return base + (usssa === "yes" ? USSSA_ADDON : 0);
}

/** What the card is actually charged, in cents, including the surcharge. */
export function chargeCents(leagueId: string, feeDollars: number): number {
  // Island passes on Square's exact cost (New York rules); COYBL keeps Doug's
  // flat 3.25%, which is lawful in Ohio.
  if (leagueId === "island") {
    return Math.round(nyCompliantTotal(feeDollars) * 100);
  }
  return Math.round(feeDollars * (1 + CARD_SURCHARGE) * 100);
}

/** The surcharge alone, in dollars — for showing the coach what the card
 *  option adds BEFORE they choose it, which New York requires. */
export function surchargeFor(leagueId: string, feeDollars: number): number {
  return Math.round((chargeCents(leagueId, feeDollars) - feeDollars * 100)) / 100;
}
