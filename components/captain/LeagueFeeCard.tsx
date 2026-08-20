"use client";

// "Your league fee" — shown on a coach's My Team tab when their team still
// owes the league, with a pay-by-card button.
//
// Adam, 2026-08-12. Card payment used to exist ONLY on the success screen
// straight after registering: pick Venmo, close the tab, and there was no way
// back. The office could mint a link from the Payments tab, but that put Doug
// in the middle of every coach who changed their mind.
//
// Renders NOTHING when the team has paid, or has no fee on file, so a coach
// who is square with the league never sees a payment prompt.

import { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "@/lib/auth-client";
import { SquareCardForm } from "@/components/forms/SquareCardForm";
import { paymentDetailsFor } from "@/lib/league-payment";

interface Props {
  leagueId: string;
}

interface Fee {
  owes?: boolean;
  due?: number;
  paid?: number;
  canPayByCard?: boolean;
  /** The same balance on a card, surcharge included. Quoted by the server so
   *  both prices are on screen BEFORE the coach chooses, which New York GBL
   *  518 requires of Island and which the redirect never did: the first number
   *  a coach saw was the one already on Square's checkout page. */
  card_total_cents?: number;
}

/** What POST /api/captain-fee returns: this coach's OWN registration id, plus
 *  the server's price for it. Nothing here is trusted by the charge.
 *  /api/square-pay recomputes the amount from the registration and the ledger
 *  row, so this is for display and for naming which registration to charge. */
interface PayIntent {
  registrationId: string;
  fee_dollars: number;
  surcharge_cents: number;
  total_cents: number;
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function LeagueFeeCard({ leagueId }: Props) {
  const user = useUser();
  const [fee, setFee] = useState<Fee | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Set when the coach taps Pay by card. Held in STATE rather than rebuilt per
  // render because it is passed straight to SquareCardForm as its preset
  // quote, and a fresh object identity each render would remount the Square
  // iframe under the coach's fingers.
  const [intent, setIntent] = useState<PayIntent | null>(null);
  // Flipped locally the instant the charge succeeds, so the red "you owe $795"
  // panel is gone before any round trip. loadFee() re-reads the ledger right
  // after to confirm it.
  const [paid, setPaid] = useState(false);
  const [paidReceipt, setPaidReceipt] = useState<string | null>(null);
  // Replaces the `dead` local the old mount effect carried. loadFee is now
  // called from three places, including after a payment, so the guard has to
  // outlive any one effect.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Extracted from the mount effect so the same read can be replayed after a
  // payment, which is what makes the flip real rather than cosmetic.
  const loadFee = useCallback(async (): Promise<Fee | null> => {
    if (!user) return null;
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/captain-fee?leagueId=${encodeURIComponent(leagueId)}`,
        { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const j = (await res.json()) as Fee;
      if (alive.current) setFee(j);
      return j;
    } catch {
      /* silent: a fee card that fails to load should not break My Team */
      return null;
    }
  }, [leagueId, user]);

  useEffect(() => {
    // useUser() is undefined for the first render while auth resolves; without
    // this guard the fetch throws once and never retries.
    if (!user) return;
    void loadFee();
  }, [user, loadFee]);

  // Tap "Pay by card": ask the server what this coach owes and which
  // registration it is, then reveal the embedded card form in place.
  //
  // This used to redirect to a Square hosted Payment Link. The link recorded
  // nothing anybody reads, so a coach who paid $819.05 still showed as unpaid
  // on the Payments tab, was still chased by the reminder tool, and got no
  // receipt. A second tap minted a second link and Square took a second
  // $819.05, because each link carried its own crypto.randomUUID() idempotency
  // key. See the note in app/api/captain-fee/route.ts.
  async function startCard() {
    if (!user) return;
    setBusy(true);
    setErr("");
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/captain-fee", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ leagueId }),
      });
      const j = (await res.json()) as Partial<PayIntent> & { error?: string };
      if (res.ok && j.registrationId && typeof j.total_cents === "number") {
        setIntent({
          registrationId: j.registrationId,
          fee_dollars: Number(j.fee_dollars ?? 0),
          surcharge_cents: Number(j.surcharge_cents ?? 0),
          total_cents: j.total_cents,
        });
        return;
      }
      setErr(j.error ?? "Couldn't start card payment.");
    } catch {
      setErr("Couldn't start card payment. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  // A network failure after the card was tokenised may mean the money moved
  // and the answer never came back. Re-read the ledger before telling the
  // coach anything. /api/square-pay writes the team_payments row keyed on the
  // row this coach's own claim resolved, which is the same row
  // /api/captain-fee reads, so a charge that landed is visible here at once.
  async function reconcile(): Promise<boolean> {
    const j = await loadFee();
    if (j && j.owes === false) {
      setPaidReceipt(null);
      setPaid(true);
      return true;
    }
    return false;
  }

  // Paid in this session. The red panel is replaced outright rather than
  // merely hidden, so a coach cannot also send a Venmo for money they have
  // just paid. Colours are hardcoded like the panel below: Island flips the
  // colour tokens light at the tenant root, and a light card built from tokens
  // renders invisible there.
  if (paid) {
    return (
      <div
        style={{
          border: "1px solid #bbf7d0",
          background: "#f0fdf4",
          borderRadius: 10,
          padding: "14px 16px",
          marginBottom: 18,
        }}
      >
        <p style={{ margin: 0, fontWeight: 800, color: "#166534", fontSize: 15 }}>
          Payment received. Thank you.
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#14532d" }}>
          Your league fee is paid in full. A receipt is on its way to the email
          address on your registration.
        </p>
        {paidReceipt && (
          <a
            href={paidReceipt}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-block",
              marginTop: 10,
              fontSize: 13,
              fontWeight: 700,
              color: "#166534",
              textDecoration: "underline",
            }}
          >
            View your Square receipt
          </a>
        )}
      </div>
    );
  }

  if (!fee?.owes) return null;

  const details = paymentDetailsFor(leagueId);
  const cashDue = Number(fee.due ?? 0);
  const cardTotal =
    intent?.total_cents ??
    (typeof fee.card_total_cents === "number" ? fee.card_total_cents : null);
  const hasSurcharge =
    cardTotal !== null && cardTotal > Math.round(cashDue * 100);
  // "" when this tenant has published neither a Venmo handle nor a payee name.
  const other = otherMethods(details);

  return (
    <div
      style={{
        border: "1px solid #fecaca",
        background: "#fef2f2",
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: 18,
      }}
    >
      <p style={{ margin: 0, fontWeight: 800, color: "#991b1b", fontSize: 15 }}>
        League fee due: {money(cashDue)}
      </p>

      {/* BOTH PRICES, IN DOLLARS, BEFORE THE COACH CHOOSES.
          This used to read "Card payments add a 3.25% processing fee", which is
          COYBL's flat Ohio rate hardcoded into a component every tenant
          renders. Island cannot quote a single percentage at all: its surcharge
          is Square's exact cost of acceptance, which is what New York GBL 518
          requires, and that works out differently at every fee tier. So the
          dollars come from the server for EVERY tenant, and a tenant that also
          publishes a headline rate has it appended from
          lib/league-payment.cardFeeLabel. Island has none, on purpose; see the
          note there.

          Three states, not two. Saying "no added fee" when the total is merely
          unknown would be a false price on an Island screen.

          And the two surcharge wordings are not a style choice. A tenant with a
          cardFeeLabel charges a FLAT percentage: COYBL's 3.25% on $495 is
          $16.09 while Square actually takes about $15.12, so calling that
          difference "what the card processor charges" is a false statement
          about a third party. Island has no cardFeeLabel because its surcharge
          IS the exact cost, which is what New York General Business Law 518
          requires, so there the cost wording is the true one. */}
      <p style={{ margin: "6px 0 0", fontSize: 13, color: "#7f1d1d" }}>
        {hasSurcharge && cardTotal !== null ? (
          <>
            {money(cashDue)} by {other || "a method arranged with the league office"}{" "}
            with no added fee, or {money(cardTotal / 100)} by card. The{" "}
            {money(cardTotal / 100 - cashDue)} difference is{" "}
            {details?.cardFeeLabel ? (
              <>the league&rsquo;s flat {details.cardFeeLabel} card fee.</>
            ) : (
              <>what the card processor charges the league.</>
            )}
          </>
        ) : cardTotal !== null ? (
          <>
            You can pay by card here, or by{" "}
            {other || "a method arranged with the league office"}. There is no
            added fee for any method.
          </>
        ) : (
          <>
            You can pay by card here, or by{" "}
            {other || "a method arranged with the league office"}. The full card
            total is shown before you enter any card details.
          </>
        )}
      </p>

      {details?.venmoHandle && (
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#7f1d1d" }}>
          Venmo: <strong>{details.venmoHandle}</strong>. Put your team name in
          the note so the office can match it to your registration.
        </p>
      )}

      {err && (
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "#b91c1c", fontWeight: 600 }}>
          {err}
        </p>
      )}

      {fee.canPayByCard && !intent && (
        <button
          type="button"
          onClick={startCard}
          disabled={busy}
          className="le-cap-btn-primary"
          style={{
            marginTop: 12,
            padding: "10px 20px",
            borderRadius: 8,
            border: 0,
            fontWeight: 700,
            fontSize: 14,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy
            ? "Loading…"
            : cardTotal !== null
              ? `Pay ${money(cardTotal / 100)} by card`
              : "Pay by card"}
        </button>
      )}

      {/* INLINE, not a separate screen. This is a volunteer on a phone at a
          field: a route change costs a navigation, a second auth round trip and
          a back button that lands them somewhere they did not choose. Square's
          card fields are about 90px tall, so the panel grows by roughly one
          thumb. Rendering it only after the tap also means My Team never pulls
          the Web Payments SDK for the coaches who are not paying today. */}
      {intent && (
        <div style={{ marginTop: 14 }}>
          <SquareCardForm
            registrationId={intent.registrationId}
            presetQuote={intent}
            leagueId={leagueId}
            getAuthToken={() => user?.getIdToken() ?? Promise.resolve(null)}
            feeLabel="League fee"
            unavailableNote={
              <>
                Card payment isn&apos;t available right now.
                {details?.venmoHandle
                  ? ` Please send Venmo to ${details.venmoHandle}, or contact the league office.`
                  : " Please contact the league office."}
              </>
            }
            onNetworkFailure={reconcile}
            onPaid={(receipt) => {
              setPaidReceipt(receipt);
              setPaid(true);
              // Belt and braces. The panel has already flipped, so nobody is
              // waiting on this; it just confirms the ledger agrees.
              void loadFee();
            }}
          />
        </div>
      )}
    </div>
  );
}

/** "Venmo", "a check", "Venmo or a check", or "" for a tenant that has
 *  published neither.
 *
 *  Returning "" and letting the caller word the fallback is the point. Island
 *  has no cheque details on file deliberately (lib/league-payment says why),
 *  and helena, jfk, lbdc, lcybl and sfbl have no entry at all, so any
 *  hardcoded "Venmo or check" fallback would be telling coaches to use methods
 *  their league has never offered them. */
function otherMethods(
  details: ReturnType<typeof paymentDetailsFor>,
): string {
  return [
    details?.venmoHandle ? "Venmo" : "",
    details?.checkPayableTo ? "a check" : "",
  ]
    .filter(Boolean)
    .join(" or ");
}
