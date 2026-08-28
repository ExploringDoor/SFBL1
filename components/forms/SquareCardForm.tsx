"use client";

// Embedded Square card form. The card fields render INSIDE our page (Square's
// Web Payments SDK draws them in a secure iframe), so the coach never leaves
// coybl.net — matching how the Small Town Select / Texas Select sites take
// payment.
//
// Flow:
//   1. ask /api/square-config for the app id + location id (public values)
//   2. load Square's SDK script and attach a card field
//   3. on submit, tokenize the card in the browser and send only that
//      single-use token to /api/square-pay, which computes the amount and
//      charges it
//
// Raw card numbers never touch our server or our database.

import { useEffect, useRef, useState, type ReactNode } from "react";

const SDK_PROD = "https://web.squarecdn.com/v1/square.js";
const SDK_SANDBOX = "https://sandbox.web.squarecdn.com/v1/square.js";

interface SquareConfig {
  configured: boolean;
  appId?: string;
  locationId?: string;
  env?: "production" | "sandbox";
}

// Minimal shape of the bits of the SDK we touch.
interface SquareCard {
  attach: (selector: string | HTMLElement) => Promise<void>;
  tokenize: () => Promise<{
    status: string;
    token?: string;
    errors?: { message?: string }[];
  }>;
  destroy?: () => Promise<void>;
}
interface SquarePayments {
  card: () => Promise<SquareCard>;
}
declare global {
  interface Window {
    Square?: {
      payments: (appId: string, locationId: string) => SquarePayments;
    };
  }
}

function loadSdk(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Square) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("sdk")));
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("sdk"));
    document.head.appendChild(s);
  });
}

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export function SquareCardForm({
  registrationId,
  onPaid,
  kind = "team_registration",
  feeLabel = "Team fee",
  presetQuote = null,
  leagueId,
  getAuthToken,
  unavailableNote,
  onNetworkFailure,
}: {
  registrationId: string | null;
  onPaid: (receiptUrl: string | null) => void;
  /** Which form is being paid for. Forwarded to both the quote and the
   *  charge: the College Clinic lives in its own collection and is priced
   *  per player, so without this a $175 place quotes and charges a team's
   *  $795. */
  kind?:
    | "team_registration"
    | "clinic_registration"
    | "tournament_registration"
    | "baseball_order";
  /** What the line item is called in the amount breakdown. A parent buying
   *  one clinic place for one girl was shown "Team fee $175.00", which is not
   *  what they are buying and not a phrase they can reconcile against their
   *  card statement. Defaulted so every existing caller is unchanged. */
  feeLabel?: string;
  /** A quote the caller ALREADY has, so this component does not fetch a
   *  second one. The coach portal gets its quote from /api/captain-fee, which
   *  had to read the ledger anyway to know the coach owes anything; asking
   *  /api/square-quote for the same number is a round trip the coach spends
   *  staring at an empty panel. Both come from the same feeFor/chargeCents so
   *  they cannot disagree. DISPLAY ONLY: it is never sent to the charge.
   *  Callers must hold this in state, not rebuild it per render, or the Square
   *  iframe remounts under the payer's fingers. */
  presetQuote?: {
    fee_dollars: number;
    surcharge_cents: number;
    total_cents: number;
  } | null;
  /** Sent with the charge, alongside getAuthToken, so /api/square-pay can
   *  check the registration belongs to the signed-in coach's team and can
   *  find the office's own ledger row. Both or neither: square-pay ignores
   *  one without the other. */
  leagueId?: string;
  /** Called at SUBMIT time, not at mount. A Firebase id token lasts an hour
   *  and a coach may leave this open longer than that, so the token has to be
   *  fetched when it is used rather than captured when the form appeared. */
  getAuthToken?: () => Promise<string | null>;
  /** Shown when Square is not configured. The default points at "Venmo or
   *  check below", which is true on the registration success screen and false
   *  in the coach portal, where there is nothing below. */
  unavailableNote?: ReactNode;
  /** Last resort after a network failure that happened AFTER the card was
   *  tokenised, where the money may have moved and the response never
   *  arrived. Return true if you established the payment did land, and no
   *  error is shown. */
  onNetworkFailure?: () => Promise<boolean>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<SquareCard | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "unavailable" | "paying"
  >("loading");
  const [error, setError] = useState<string | null>(null);
  // What this card will actually be charged. Fetched before the button is
  // usable so nobody is asked to pay an amount they have not seen.
  const [quote, setQuote] = useState<{
    fee_dollars: number;
    surcharge_cents: number;
    total_cents: number;
  } | null>(presetQuote);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const cfg = (await fetch("/api/square-config", {
          cache: "no-store",
        }).then((r) => r.json())) as SquareConfig;

        if (cancelled) return;
        if (!cfg.configured || !cfg.appId || !cfg.locationId) {
          setState("unavailable");
          return;
        }

        await loadSdk(cfg.env === "production" ? SDK_PROD : SDK_SANDBOX);
        if (cancelled || !window.Square) {
          if (!cancelled) setState("unavailable");
          return;
        }

        // Ask what this registration owes.
        //
        // NOT non-fatal any more. It used to hide the amount and leave an
        // enabled button reading "Pay now", so a failed quote meant a coach
        // could be charged $819.05 having never been shown a number. That is
        // both a bad way to treat someone and, where the fee is passed on, the
        // thing New York GBL 518 specifically forbids: the total has to be
        // disclosed BEFORE checkout. No price, no button.
        // Skipped when the caller already supplied one. Still fatal when it
        // is needed and fails, for the reason in the note above.
        if (!presetQuote && registrationId) {
          try {
            const q = await fetch("/api/square-quote", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ registrationId, kind }),
            }).then((r) => (r.ok ? r.json() : null));
            if (!cancelled && q && typeof q.total_cents === "number") {
              setQuote(q);
            } else if (!cancelled) {
              setState("unavailable");
              return;
            }
          } catch {
            if (!cancelled) {
              setState("unavailable");
              return;
            }
          }
        }

        const payments = window.Square.payments(cfg.appId, cfg.locationId);
        const card = await payments.card();
        if (cancelled) return;
        if (containerRef.current) {
          await card.attach(containerRef.current);
          cardRef.current = card;
          setState("ready");
        }
      } catch {
        if (!cancelled) setState("unavailable");
      }
    })();

    return () => {
      cancelled = true;
      cardRef.current?.destroy?.().catch(() => {});
    };
  }, [registrationId]);

  async function pay() {
    if (!cardRef.current) return;
    if (!registrationId) {
      setError(
        "We couldn't match this to your registration. Please pay by Venmo or check.",
      );
      return;
    }
    setError(null);
    setState("paying");
    try {
      const result = await cardRef.current.tokenize();
      if (result.status !== "OK" || !result.token) {
        setError(
          result.errors?.[0]?.message ??
            "Please check the card details and try again.",
        );
        setState("ready");
        return;
      }

      // NO AMOUNT IS SENT, and there is no field here that could carry one.
      // /api/square-pay recomputes it from the saved registration and, on the
      // coach path, clamps it to the office's own ledger row. The quote above
      // is display only.
      const token =
        getAuthToken && leagueId ? await getAuthToken().catch(() => null) : null;
      const res = await fetch("/api/square-pay", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          registrationId,
          sourceId: result.token,
          kind,
          ...(token && leagueId ? { leagueId } : {}),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        receipt_url?: string | null;
      };
      if (!res.ok || !j.ok) {
        setError(j.error ?? "That payment didn't go through.");
        setState("ready");
        return;
      }
      onPaid(j.receipt_url ?? null);
    } catch {
      // A network failure HERE is the one case where the card may already have
      // been charged and the answer never reached us. "Please try again" is
      // then the worst possible instruction. Ask the caller to check the
      // ledger before saying anything: /api/square-pay writes the team_payments
      // row in the same breath as the charge.
      if (onNetworkFailure) {
        const settled = await onNetworkFailure().catch(() => false);
        if (settled) return;
      }
      setError("Something went wrong taking the payment. Please try again.");
      setState("ready");
    }
  }

  if (state === "unavailable") {
    // Wrapped in .sqc-wrap deliberately. This <p> reads var(--muted), and
    // Island flips the colour tokens light at the tenant root, so a bare
    // .cop-note-block renders near-white text on the light panel it sits in.
    // .sqc-wrap is already in the restore list in app/island-theme.css, so
    // wrapping fixes it without adding a thirteenth entry to that list.
    return (
      <div className="sqc-wrap">
        <p className="cop-note-block">
          {unavailableNote ?? (
            <>
              Card payment isn&apos;t available right now. Please use Venmo or
              check below, or contact the league office.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="sqc-wrap">
      {state === "loading" && (
        <p className="cop-note-block">Loading secure card form...</p>
      )}
      {quote && (
        <dl className="sqc-amount">
          <div>
            <dt>{feeLabel}</dt>
            <dd>{usd(quote.fee_dollars * 100)}</dd>
          </div>
          <div>
            <dt>Card processing fee</dt>
            <dd>{usd(quote.surcharge_cents)}</dd>
          </div>
          <div className="sqc-amount-total">
            <dt>Total</dt>
            <dd>{usd(quote.total_cents)}</dd>
          </div>
        </dl>
      )}

      {/* Square draws its card fields inside this element. */}
      <div ref={containerRef} className="sqc-field" />
      {error && <div className="cop-error">{error}</div>}
      {/* The button always carries the amount. If there is no quote there is
          no button — see the note on the quote fetch above. */}
      {state !== "loading" && quote && (
        <button
          type="button"
          className="cop-btn cop-btn-primary sqc-pay"
          onClick={pay}
          disabled={state === "paying"}
        >
          {state === "paying" ? "Processing..." : `Pay ${usd(quote.total_cents)}`}
        </button>
      )}
    </div>
  );
}
