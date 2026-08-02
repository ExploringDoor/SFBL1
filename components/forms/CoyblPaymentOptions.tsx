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

// Doug's payment details. Venmo handle and the check address he gave us.
const VENMO_HANDLE = "@Doug-Hare-2";
const VENMO_URL = "https://venmo.com/u/Doug-Hare-2";
const CHECK_PAYABLE_TO = "COYBL";
// Matches the address already shown below the form. Doug once said "Etna"
// while the league docs and the live page say Pataskala (same street, and
// 43062 is the Pataskala ZIP). Kept consistent with the live page; worth one
// confirmation from Doug.
const CHECK_ADDRESS = "152 Glen Crossing Drive, Pataskala, OH 43062";

export function CoyblPaymentOptions({
  submissionId,
}: {
  submissionId: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function payByCard() {
    if (!submissionId) {
      setError(
        "We couldn't match this to your registration. Please pay by Venmo or check, or contact the league office.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/square-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ registrationId: submissionId }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !j.url) {
        setError(j.error ?? "Couldn't start card payment. Try Venmo or check.");
        return;
      }
      window.location.href = j.url;
    } catch {
      setError("Couldn't reach the card processor. Try Venmo or check.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cop-wrap">
      <h3 className="cop-head">Now pay your team fee</h3>
      <p className="cop-sub">
        Your spot is saved. Pick whichever is easiest. Card payments add a
        3.25 percent processing fee. Venmo and check have no fee.
      </p>

      {error && <div className="cop-error">{error}</div>}

      <div className="cop-grid">
        <button
          type="button"
          className="cop-btn cop-btn-primary"
          onClick={payByCard}
          disabled={busy}
        >
          {busy ? "Starting checkout..." : "Pay by card"}
          <span className="cop-note">Visa, Mastercard, Amex</span>
        </button>

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
