// Can this registration still be settled by card, given what the LEDGER says?
//
// WHY THIS EXISTS AT ALL. /api/square-pay computes the amount from the SAVED
// REGISTRATION, with feeFor(leagueId, data). It never reads team_payments. That
// was survivable while the only ways in were the success screen seconds after
// registering and a Square hosted link the office minted on demand and a coach
// used within the hour. /pay/{registrationId} lives in a text thread forever,
// so the state of the ledger months later is now part of the money question.
//
// TWO WAYS THE LEDGER CAN MAKE A CARD CHARGE WRONG.
//
// 1. SOMETHING IS ALREADY PAID. PaymentQuickRecord in FormSubmissionsViewer and
//    the Payments tab both write Venmo, check and cash onto team_payments and
//    NEVER touch the submission, so square-pay's data.payment check cannot see
//    them. A fully settled team must not pay twice. A PART settled team must
//    not either, and that is the case that bites: square-pay would charge the
//    WHOLE fee again, not the balance. On Island that is the documented
//    workflow, not an edge case. lib/fees.ts records that the $200 home field
//    discount is applied by Mike by hand after registration, and the only
//    editable money box on a team row is "Team paid $", so a discounted team
//    reads as due 795, paid 595. Letting that through takes $819.05 on top of
//    the $595 the coach already sent, with no refund path anywhere in this
//    codebase.
//
// 2. THE OFFICE HAS RE-PRICED THE TEAM. /api/admin-team-payment accepts and
//    stores amount_due. Everything that writes it today writes feeFor: teams
//    are provisioned with amount_due: feeFor(leagueId, data) in
//    lib/provision-team.ts, square-pay writes amount_due: fee, and
//    PaymentQuickRecord posts amount_due: due from the same feeFor. So on every
//    tenant today the two agree and this check never fires. The moment they
//    disagree, the ledger is the office's number and the card must not quote
//    the old one.
//
// NO IMPORTS ON PURPOSE. Numbers in, message out. That is what makes it
// testable without an emulator and what stops the page and the endpoint
// drifting into two different answers.

export interface LedgerState {
  /** team_payments.amount_due, in dollars. Zero or missing means the ledger has
   *  no opinion about the price. */
  ledgerDue: number;
  /** team_payments.amount_paid, in dollars. */
  ledgerPaid: number;
  /** What feeFor derives from the saved registration, in dollars. This is what
   *  the card would actually be charged, before surcharge. */
  registrationFee: number;
  /** LEAGUE_TEST_FEE or COYBL_TEST_FEE is set. feeFor then returns the test fee
   *  (1.33) while the ledger still holds the real 795, so the price comparison
   *  below would reject the one safe way to run a full end to end test. */
  testFeeActive?: boolean;
}

/** The reason a card charge must be refused, ready to show a payer, or null
 *  when the charge may proceed. */
export function cardBlockReason(s: LedgerState): string | null {
  const paid = Number.isFinite(s.ledgerPaid) ? s.ledgerPaid : 0;
  const due = Number.isFinite(s.ledgerDue) ? s.ledgerDue : 0;

  if (paid > 0) {
    return (
      "The league already has a payment recorded for this team, so no card was " +
      "charged. Contact the league office to check the balance before paying " +
      "anything else."
    );
  }

  // Cents, because 795 and 794.9999999 are the same fee and floats are not.
  if (
    !s.testFeeActive &&
    due > 0 &&
    Math.round(due * 100) !== Math.round(s.registrationFee * 100)
  ) {
    return (
      "The league office has adjusted the fee for this team, so no card was " +
      "charged. Contact the office and they will take the payment."
    );
  }

  return null;
}
