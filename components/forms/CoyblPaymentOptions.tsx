"use client";

// COYBL "you're registered, now pay" block, rendered on the registration
// success screen. Three ways to pay, per Doug:
//
//   1. Card  — Square hosted checkout (adds the 3.25% processing fee)
//   2. Venmo — no fee
//   3. Check — no fee
//
// The card button asks /api/square-checkout to create a Square Payment Link
// for THIS registration and sends the coach there. If Square isn't configured
// (no access token in the environment) that endpoint returns 503 and we show
// the fallback message instead of a dead button, so the page still works.

import { useState } from "react";
import { SquareCardForm } from "./SquareCardForm";
// Doug's payment details live in lib/coybl-payment so the reminder email the
// office sends the unpaid quotes the same handle and address this form does.
import {
  COYBL_VENMO_HANDLE as VENMO_HANDLE,
  COYBL_VENMO_URL as VENMO_URL,
  COYBL_CHECK_PAYABLE_TO as CHECK_PAYABLE_TO,
  COYBL_CHECK_ADDRESS as CHECK_ADDRESS,
} from "@/lib/coybl-payment";

export function CoyblPaymentOptions({
  submissionId,
}: {
  submissionId: string | null;
}) {
  const [paidReceipt, setPaidReceipt] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  // Paid by card — replace the whole block with a receipt, so nobody pays
  // twice by also sending a Venmo.
  if (paid) {
    return (
      <section className="cop-wrap">
        <h3 className="cop-head">Payment received</h3>
        <p className="cop-sub">
          Thanks. Your team fee is paid and your registration is complete.
          {paidReceipt ? " A receipt is available below." : ""}
        </p>
        {paidReceipt && (
          <a
            className="cop-btn"
            href={paidReceipt}
            target="_blank"
            rel="noopener noreferrer"
          >
            View receipt
          </a>
        )}
      </section>
    );
  }

  return (
    <section className="cop-wrap">
      <h3 className="cop-head">Now pay your team fee</h3>
      <p className="cop-sub">
        Your spot is saved. Pay by card below, or use Venmo or check. Card
        payments add a 3.25 percent processing fee. Venmo and check have no
        fee.
      </p>

      {/* Card fields render right here — no redirect off the site. */}
      <SquareCardForm
        registrationId={submissionId}
        onPaid={(receipt) => {
          setPaidReceipt(receipt);
          setPaid(true);
        }}
      />

      <p className="cop-or">Or pay another way</p>

      <div className="cop-grid">
        <a
          className="cop-btn"
          href={VENMO_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Pay with Venmo
          <span className="cop-note">{VENMO_HANDLE}</span>
        </a>

        <div className="cop-btn cop-btn-static">
          Mail a check
          <span className="cop-note">
            Payable to {CHECK_PAYABLE_TO}
            <br />
            {CHECK_ADDRESS}
          </span>
        </div>
      </div>

      <p className="cop-foot">
        Paying by Venmo or check? Put your team name in the note so the office
        can match it to your registration.
      </p>
    </section>
  );
}
