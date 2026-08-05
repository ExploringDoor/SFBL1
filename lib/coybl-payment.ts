// COYBL's payment details, in one place.
//
// These used to live only inside CoyblPaymentOptions (a client component), so
// the payment-reminder email had no way to reach them without copying the
// Venmo handle and check address into a second file. Two copies of a mailing
// address is how a league ends up telling half its coaches to send checks to
// an address that changed.
//
// Confirmed by Doug 2026-08-02: "We live in Etna Township, not in a
// corporation. Our address is 152 Glen Crossing Drive - Etna, 43062." The
// older P.O. Box in Pataskala is no longer valid.

export const COYBL_VENMO_HANDLE = "@Doug-Hare-2";
export const COYBL_VENMO_URL = "https://venmo.com/u/Doug-Hare-2";
export const COYBL_CHECK_PAYABLE_TO = "COYBL";
export const COYBL_CHECK_ADDRESS = "152 Glen Crossing Drive, Etna, OH 43062";

/** Card surcharge, as a percentage, for wording in coach-facing copy. */
export const COYBL_CARD_FEE_LABEL = "3.25 percent";
