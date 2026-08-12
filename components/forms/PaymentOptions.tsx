"use client";

// "You're registered, now pay" block on the registration success screen.
//
// Was CoyblPaymentOptions, which hardcoded Doug's Venmo handle, cheque address
// and a 3.25% fee in its copy. Island needed the same block with different
// details and a surcharge that is not a fixed percentage, so the details come
// from lib/league-payment instead. A tenant with no entry there gets the card
// option alone rather than a made-up handle to pay.
//
// The card fields render inline — no redirect off the site. /api/square-pay
// computes the amount server-side from the saved registration, so nothing here
// can influence what is charged.
//
// NEW YORK. Island passes Square's fee to the payer, which NY GBL 518 allows
// only when the card price is shown BEFORE the coach picks card. That is why
// this component fetches the quote itself rather than leaving the amount to
// the card form lower down the page: both prices have to be visible at the
// moment of choosing, not after.

import { useEffect, useState } from "react";
import { SquareCardForm } from "./SquareCardForm";
import { paymentDetailsFor } from "@/lib/league-payment";

interface Quote {
  fee_dollars: number;
  total_cents: number;
  surcharge_cents: number;
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function PaymentOptions({
  submissionId,
  leagueId,
}: {
  submissionId: string | null;
  leagueId: string;
}) {
  const [paidReceipt, setPaidReceipt] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  // "I'll pay later". The registration is ALREADY saved by the time this block
  // renders — payment is a separate step — so this is not a way out of
  // anything, it is an honest exit for a coach who has to check with their
  // club treasurer first. Without it the only options were pay now or close
  // the tab, and closing the tab looks like failure to someone who just
  // registered (Adam, 2026-08-12).
  const [deferred, setDeferred] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);

  const details = paymentDetailsFor(leagueId);
  const hasVenmo = Boolean(details?.venmoUrl && details?.venmoHandle);
  const hasCheck = Boolean(details?.checkPayableTo && details?.checkAddress);

  // Read-only; charges nothing. Failure just means the price line does not
  // render — the card form fetches and shows its own total regardless, so a
  // coach is never asked to pay an amount they have not seen.
  useEffect(() => {
    if (!submissionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/square-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ registrationId: submissionId }),
        });
        if (!res.ok) return;
        const j = (await res.json()) as Quote;
        if (!cancelled) setQuote(j);
      } catch {
        /* price line simply does not render */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

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

  const noFeeMethods = [hasVenmo && "Venmo", hasCheck && "check"]
    .filter(Boolean)
    .join(" or ");

  // Chose to pay later. Confirm the registration stuck and say exactly how to
  // pay when they are ready, rather than leaving them to guess.
  if (deferred) {
    return (
      <section className="cop-wrap">
        <h3 className="cop-head">No problem — your spot is saved</h3>
        <p className="cop-sub">
          Your team is registered. Nothing else is needed right now.
          {quote
            ? ` Your team fee is ${money(quote.fee_dollars)}, due in full before the season begins.`
            : " Your team fee is due in full before the season begins."}
        </p>
        {hasVenmo && (
          <p className="cop-sub">
            To pay by Venmo, send to{" "}
            <strong>{details!.venmoHandle}</strong> and put your team name in
            the note so the office can match it to your registration.
          </p>
        )}
        <p className="cop-foot">
          Prefer to pay by card? Just reply to your confirmation email and the
          league office will send you a payment link.
        </p>
        <button
          type="button"
          className="cop-btn"
          onClick={() => setDeferred(false)}
        >
          Actually, let me pay now
        </button>
      </section>
    );
  }

  return (
    <section className="cop-wrap">
      <h3 className="cop-head">Now pay your team fee</h3>

      {/* The two prices, side by side, before the coach chooses. This is the
          NY-compliant presentation: not a fee bolted on at the end. */}
      {quote && (
        <dl className="cop-prices">
          {noFeeMethods && (
            <div>
              <dt>By {noFeeMethods}</dt>
              <dd>{money(quote.fee_dollars)}</dd>
            </div>
          )}
          <div>
            <dt>By card</dt>
            <dd>{money(quote.total_cents / 100)}</dd>
          </div>
        </dl>
      )}

      <p className="cop-sub">
        Your spot is saved.{" "}
        {quote
          ? // "which is what the processor charges us" is only TRUE where the
            // surcharge is derived from real cost. Island's is; COYBL's flat
            // 3.25% over-collects slightly, so claiming it there would be a
            // false statement about someone else's money. Tenants that quote a
            // fixed percentage get the plain wording.
            `Paying by card adds ${money(quote.surcharge_cents / 100)}${
              details?.cardFeeLabel
                ? ""
                : ", which is what the card processor charges us"
            }${noFeeMethods ? `. ${noFeeMethods} have no fee` : ""}.`
          : details?.cardFeeLabel
            ? `Card payments add a ${details.cardFeeLabel} processing fee.${
                noFeeMethods ? ` ${noFeeMethods} have no fee.` : ""
              }`
            : "Pay by card below."}
      </p>

      <SquareCardForm
        registrationId={submissionId}
        onPaid={(receipt) => {
          setPaidReceipt(receipt);
          setPaid(true);
        }}
      />

      {(hasVenmo || hasCheck) && (
        <>
          <p className="cop-or">Or pay another way</p>
          <div className="cop-grid">
            {hasVenmo && (
              <a
                className="cop-btn"
                href={details!.venmoUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Pay with Venmo
                <span className="cop-note">{details!.venmoHandle}</span>
              </a>
            )}
            {hasCheck && (
              <div className="cop-btn cop-btn-static">
                Mail a check
                <span className="cop-note">
                  Payable to {details!.checkPayableTo}
                  <br />
                  {details!.checkAddress}
                </span>
              </div>
            )}
          </div>
          <p className="cop-foot">
            Paying by {noFeeMethods}? Put your team name in the note so the
            office can match it to your registration.
          </p>
        </>
      )}

      {/* Deliberately last, quiet, and a link rather than a button: it is a
          legitimate choice, not the one being encouraged. */}
      <p className="cop-later">
        Not ready to pay?{" "}
        <button type="button" onClick={() => setDeferred(true)}>
          I&rsquo;ll pay later
        </button>
      </p>
    </section>
  );
}
