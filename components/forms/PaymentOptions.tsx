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
  kind = "team_registration",
  noun = "team fee",
}: {
  submissionId: string | null;
  leagueId: string;
  /** Which form this payment settles. The College Clinic stores its
   *  submissions in a different collection and is priced per player, so both
   *  the quote and the charge have to be told which one they are looking at. */
  kind?: "team_registration" | "clinic_registration";
  /** What to call the money on screen. "team fee" is wrong for a clinic
   *  place bought by one family. */
  noun?: string;
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

  // A clinic place is capped and held in payment order, so several strings
  // below have to say something different from the team-fee wording.
  const isClinic = kind === "clinic_registration";
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
          body: JSON.stringify({ registrationId: submissionId, kind }),
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
  }, [submissionId, kind]);

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
        {/* A CLINIC PLACE IS NOT SAVED UNTIL IT IS PAID, and this screen used
            to say the opposite.
            Every line of the team copy was wrong for a clinic: "your spot is
            saved" when the cap is 40 and places go in payment order, "your
            team is registered" for a single player, "before the season
            begins" for a one-day event, and "put your team name in the note"
            when there is no team.
            Alyssa Schroeder submitted three times in twelve minutes on
            2026-08-20 and never paid. This screen telling her nothing else
            was needed is the most likely reason. */}
        {isClinic ? (
          <>
            <h3 className="cop-head">Your place is not held yet</h3>
            <p className="cop-sub">
              We have the registration, but the clinic is capped and places are
              held in the order they are paid for.
              {quote
                ? ` The fee is ${money(quote.fee_dollars)}.`
                : ""}{" "}
              Pay when you are ready and the place is locked in.
            </p>
            {hasVenmo && (
              <p className="cop-sub">
                To pay by Venmo, send to{" "}
                <strong>{details!.venmoHandle}</strong> and put the{" "}
                <strong>player&rsquo;s name</strong> in the note so the office
                can match it to this registration.
              </p>
            )}
            <p className="cop-foot">
              Prefer to pay by card? Reply to your confirmation email and the
              league office will send a payment link.
            </p>
          </>
        ) : (
          <>
            <h3 className="cop-head">No problem — your spot is saved</h3>
            <p className="cop-sub">
              Your team is registered. Nothing else is needed right now.
              {quote
                ? ` Your ${noun} is ${money(quote.fee_dollars)}, due in full before the season begins.`
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
          </>
        )}
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
        {/* For a team, registering IS the spot. For a clinic it is not: the
            cap is 40 and places go in payment order, so promising a saved
            spot here would be the same lie as the deferred screen told. */}
        {isClinic
          ? "We have the registration. Paying now locks the place in. "
          : "Your spot is saved. "}
        {quote
          ? // "which is what the processor charges us" is only TRUE where the
            // surcharge is derived from real cost. Island's is; COYBL's flat
            // 3.25% over-collects slightly, so claiming it there would be a
            // false statement about someone else's money. Tenants that quote a
            // fixed percentage get the plain wording. And a zero-surcharge
            // tenant (the league absorbs the card fee) cannot say the processor
            // charges $0 — every method is simply the flat price.
            quote.surcharge_cents === 0
            ? "There's no added fee for any payment method."
            : `Paying by card adds ${money(quote.surcharge_cents / 100)}${
              details?.cardFeeLabel
                ? ""
                : ", which is what the card processor charges us"
            }${
              noFeeMethods
                ? `. ${noFeeMethods} ${hasVenmo && hasCheck ? "have" : "has"} no fee`
                : ""
            }.`
          : details?.cardFeeLabel
            ? `Card payments add a ${details.cardFeeLabel} processing fee.${
                noFeeMethods
                  ? ` ${noFeeMethods} ${hasVenmo && hasCheck ? "have" : "has"} no fee.`
                  : ""
              }`
            : "Pay by card below."}
      </p>

      <SquareCardForm
        registrationId={submissionId}
        kind={kind}
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
        {isClinic ? "Not ready to pay? " : "Not ready to pay? "}
        <button type="button" onClick={() => setDeferred(true)}>
          I&rsquo;ll pay later
        </button>
        {/* Said at the point of choosing, not afterwards. Someone deferring a
            clinic place needs to know it is not being held for them. */}
        {isClinic && (
          <span className="cop-later-note">
            {" "}
            The place is not held until it is paid.
          </span>
        )}
      </p>
    </section>
  );
}
