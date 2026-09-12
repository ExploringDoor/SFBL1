"use client";

// Ordering a shirt: pick a size, say how you will pay, done.
//
// Deliberately NOT a cart. There is one product, it is collected at a field,
// and a basket with a checkout flow would be more moving parts than the whole
// shop is worth. Mike, 2026-09-06: "Card, Venmo, zelle - pick up at field."
//
// A SOLD-OUT SIZE IS SHOWN AND DISABLED, not removed. A size that vanishes
// reads as a website fault; a size struck through reads as "you are too late",
// which is the truth and stops the phone call.
//
// The server refuses an order it cannot fill, in a transaction, so the numbers
// on this page are a courtesy rather than the safeguard. If somebody takes the
// last large while this page is open, the message comes back from there.

import { useState } from "react";
import {
  MAX_PER_ORDER,
  MERCH_DIVISIONS,
  type MerchSize,
  type PayMethod,
} from "@/lib/merch";

interface Props {
  leagueId: string;
  itemId: string;
  itemName: string;
  price: number;
  stock: MerchSize[];
}

export function OrderForm({
  leagueId,
  itemId,
  itemName,
  price,
  stock,
}: Props) {
  const firstAvailable = stock.find((s) => s.count > 0)?.size ?? "";
  const [size, setSize] = useState(firstAvailable);
  const [quantity, setQuantity] = useState(1);
  // Card, always. The picker is gone (see the note below) and the server
  // decides the method regardless, but the value is still sent so the request
  // body keeps its shape.
  const payMethod: PayMethod = "card";
  const [division, setDivision] = useState("");
  const [teamName, setTeamName] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{
    id: string;
    total: number;
    method: PayMethod;
    /** Handle to pay, sent back with the order rather than rendered on the
     *  public page, so it is not sitting in the source for scrapers. */
    payTo: string | null;
  } | null>(null);

  const allGone = stock.every((s) => s.count <= 0);
  const left = stock.find((s) => s.size === size)?.count ?? 0;
  const maxForSize = Math.max(1, Math.min(MAX_PER_ORDER, left));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/merch-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leagueId,
          itemId,
          size,
          quantity,
          payMethod,
          division,
          teamName,
          playerName,
          name,
          email,
          phone,
        }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        orderId?: string;
        total?: number;
        payTo?: string | null;
        payUrl?: string | null;
      };
      if (!res.ok) {
        setError(d.error ?? "Could not place that order.");
        return;
      }
      // Card payers go straight to the existing payment page, which recomputes
      // the amount from the saved order.
      if (d.payUrl) {
        window.location.href = d.payUrl;
        return;
      }
      setPlaced({
        id: d.orderId ?? "",
        total: d.total ?? 0,
        method: payMethod,
        payTo: d.payTo ?? null,
      });
    } catch {
      setError("Could not reach the league. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // A card order never reaches here: the server returns payUrl and the browser
  // leaves for the card form. This is the fallback for the one case where it
  // does not, and it used to read "Send $30 on Venmo" — which, now that Venmo
  // and Zelle are gone (Melinda, 2026-09-11), would send somebody to pay a
  // way the office no longer accepts. It says what is actually true instead.
  if (placed) {
    return (
      <div className="str-placed" role="status">
        <p className="str-placed-head">Your {size} is reserved.</p>
        <p>
          We could not open the card form. Your order is saved, so nothing is
          lost. The league office will email you a link to pay for it.
        </p>
        <p className="str-placed-sub">
          You collect it at the field.
        </p>
      </div>
    );
  }

  if (allGone) {
    return <p className="str-soldout">Sold out. More may be ordered, ask at the field.</p>;
  }

  return (
    <form className="str-form" onSubmit={submit}>
      <div className="str-field">
        <span className="str-label">Size</span>
        <div className="str-sizepick">
          {stock.map((s) => {
            const out = s.count <= 0;
            return (
              <button
                key={s.size}
                type="button"
                disabled={out}
                aria-pressed={size === s.size}
                onClick={() => {
                  setSize(s.size);
                  setQuantity(1);
                  setError(null);
                }}
                className={
                  "str-sizebtn" +
                  (size === s.size ? " is-on" : "") +
                  (out ? " is-out" : "")
                }
              >
                {s.size}
                {out ? <em>sold out</em> : s.count <= 6 ? <em>{s.count} left</em> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="str-row">
        <label className="str-field">
          <span className="str-label">How many</span>
          <select
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className="str-input"
          >
            {Array.from({ length: maxForSize }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {/* NO PAYMENT PICKER. Melinda, 2026-09-11: "Remove the Venmo and Zelle
            options. We will only receive payment by credit card on the
            website." The office was reconciling peer-to-peer transfers by
            hand against a list, which is work the card path does for them.
            payMethod stays "card" and /api/merch-order forces it server side,
            so a stale tab cannot post venmo either. */}
      </div>

      {/* WHO THE SHIRT IS FOR. Collected because these are handed over at a
          field: the office sorts the pile by division, then team, then size,
          and none of that is possible from a buyer's name and email alone. */}
      <div className="str-row">
        <label className="str-field">
          <span className="str-label">Division</span>
          <select
            className="str-input"
            value={division}
            onChange={(e) => setDivision(e.target.value)}
            required
          >
            <option value="">Choose</option>
            {MERCH_DIVISIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="str-field">
          <span className="str-label">Team name</span>
          <input
            className="str-input"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            required
            maxLength={120}
          />
        </label>
        <label className="str-field">
          <span className="str-label">Player name</span>
          <input
            className="str-input"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            required
            maxLength={120}
          />
        </label>
      </div>

      <div className="str-row">
        <label className="str-field">
          <span className="str-label">Your name</span>
          <input
            className="str-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
          />
        </label>
        <label className="str-field">
          <span className="str-label">Email</span>
          <input
            className="str-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={200}
          />
        </label>
        <label className="str-field">
          <span className="str-label">Phone</span>
          <input
            className="str-input"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            maxLength={40}
          />
        </label>
      </div>

      {/* THE HANDLE, ON THE FORM. It used to appear only on the confirmation,
          to keep Mike's mobile out of a public page's source. He asked for it
          on the form (2026-09-07) and it is his number and his business, so it
          is here. It still only renders for the method actually chosen, so the
          page carries one of them rather than both. */}
      {error && <p className="str-error">{error}</p>}

      <button type="submit" className="str-order" disabled={busy || !size}>
        {busy
          ? "Placing…"
          : payMethod === "card"
            ? `Pay $${price * quantity} by card`
            : `Reserve for $${price * quantity}`}
      </button>
      <p className="str-fineprint">
        You collect your {itemName} at the field. Nothing is posted.
      </p>
    </form>
  );
}
