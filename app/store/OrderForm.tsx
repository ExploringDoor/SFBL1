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
import { MAX_PER_ORDER, PAY_METHODS, type MerchSize, type PayMethod } from "@/lib/merch";

interface Props {
  leagueId: string;
  itemId: string;
  itemName: string;
  price: number;
  stock: MerchSize[];
  /** Where to send Venmo and Zelle payers. Empty until the league sets them. */
  venmo?: string;
  zelle?: string;
}

export function OrderForm({
  leagueId,
  itemId,
  itemName,
  price,
  stock,
  venmo,
  zelle,
}: Props) {
  const firstAvailable = stock.find((s) => s.count > 0)?.size ?? "";
  const [size, setSize] = useState(firstAvailable);
  const [quantity, setQuantity] = useState(1);
  const [payMethod, setPayMethod] = useState<PayMethod>("card");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ id: string; total: number; method: PayMethod } | null>(null);

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
          name,
          email,
          phone,
        }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        orderId?: string;
        total?: number;
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
      setPlaced({ id: d.orderId ?? "", total: d.total ?? 0, method: payMethod });
    } catch {
      setError("Could not reach the league. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (placed) {
    const how =
      placed.method === "venmo"
        ? venmo
          ? `Send $${placed.total} on Venmo to ${venmo}.`
          : `Send $${placed.total} on Venmo. The league office will confirm the handle.`
        : placed.method === "zelle"
          ? zelle
            ? `Send $${placed.total} on Zelle to ${zelle}.`
            : `Send $${placed.total} on Zelle. The league office will confirm the details.`
          : `Bring $${placed.total} when you collect it.`;
    return (
      <div className="str-placed" role="status">
        <p className="str-placed-head">Your {size} is reserved.</p>
        <p>{how}</p>
        <p className="str-placed-sub">
          Pick it up at the field. Put your name on the payment so the office can
          match it to your order.
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
        <label className="str-field">
          <span className="str-label">How you will pay</span>
          <select
            value={payMethod}
            onChange={(e) => setPayMethod(e.target.value as PayMethod)}
            className="str-input"
          >
            {PAY_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
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
            maxLength={40}
          />
        </label>
      </div>

      {error && <p className="str-error">{error}</p>}

      <button type="submit" className="str-order" disabled={busy || !size}>
        {busy
          ? "Placing…"
          : payMethod === "card"
            ? `Pay $${price * quantity} by card`
            : `Reserve for $${price * quantity}`}
      </button>
      <p className="str-fineprint">
        {itemName}, collected at the field. Nothing is posted.
      </p>
    </form>
  );
}
