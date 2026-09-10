// Where a league's money goes, per tenant, in one place.
//
// COYBL's details already lived in lib/coybl-payment.ts because the
// payment-reminder email needed them as well as the form — two copies of a
// mailing address is how half a league ends up posting cheques to an address
// that changed. Island now needs the same, so this is the shared lookup and
// coybl-payment.ts stays as COYBL's data (the reminder email still imports it
// directly).
//
// A tenant with no entry gets `null`, and the payment screen renders the card
// option alone rather than inventing a handle to pay.

import {
  COYBL_VENMO_HANDLE,
  COYBL_VENMO_URL,
  COYBL_CHECK_PAYABLE_TO,
  COYBL_CHECK_ADDRESS,
} from "@/lib/coybl-payment";

export interface LeaguePaymentDetails {
  venmoHandle?: string;
  venmoUrl?: string;
  /** Zelle is a bank transfer to a phone number or email, with no app link to
   *  deep-link into, so this is shown as text for the payer to copy. */
  zelleHandle?: string;
  checkPayableTo?: string;
  checkAddress?: string;
  /** How the card surcharge is described in coach-facing copy. Island cannot
   *  use a percentage — see the note below. */
  cardFeeLabel?: string;
}

const DETAILS: Record<string, LeaguePaymentDetails> = {
  coybl: {
    venmoHandle: COYBL_VENMO_HANDLE,
    venmoUrl: COYBL_VENMO_URL,
    checkPayableTo: COYBL_CHECK_PAYABLE_TO,
    checkAddress: COYBL_CHECK_ADDRESS,
    cardFeeLabel: "3.25 percent",
  },

  // Island Fastpitch. Handle confirmed by Mike via Adam, 2026-08-11.
  //
  // No cheque details on purpose: Mike has not given a payable-to name or a
  // mailing address, and a payment screen that guesses either is worse than
  // one that offers card and Venmo only. Add them here when he supplies them.
  //
  // cardFeeLabel is deliberately ABSENT. Island's surcharge is Square's exact
  // cost, so it is not a fixed percentage — it is 2.94% at $795 and 3.05% at
  // $500. Quoting a single number in the copy would be wrong at most fee
  // tiers, and in New York wrong in the direction that carries a penalty. The
  // screen shows the real dollar amounts from /api/square-quote instead.
  island: {
    venmoHandle: "@mikeislandusssa",
    venmoUrl: "https://venmo.com/u/mikeislandusssa",
    // Same number the store has shown since 2026-09-06. Added here so a coach
    // who picks Zelle on the registration form is not sent looking for a
    // number the payment screen never showed them.
    zelleHandle: "631-831-4793",
  },

  // Windmill Fastpitch. Flat $325, no card surcharge (the league absorbs it, so
  // no cardFeeLabel). Venmo handle + check payable-to come from the league's own
  // site; the exact check mailing address is still TODO from Ken, so the check
  // block points coaches at the office until he confirms it.
  windmill: {
    venmoHandle: "@WindmillFastpitch",
    venmoUrl: "https://venmo.com/u/WindmillFastpitch",
    checkPayableTo: "Windmill Fastpitch Softball",
    checkAddress:
      "Give your check to your league contact, or email Windmill_Softball@hotmail.com for where to send it.",
  },
};

export function paymentDetailsFor(
  leagueId: string | null | undefined,
): LeaguePaymentDetails | null {
  if (!leagueId) return null;
  return DETAILS[leagueId] ?? null;
}
