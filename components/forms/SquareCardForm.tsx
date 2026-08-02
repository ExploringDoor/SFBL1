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

import { useEffect, useRef, useState } from "react";

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

export function SquareCardForm({
  registrationId,
  onPaid,
}: {
  registrationId: string | null;
  onPaid: (receiptUrl: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<SquareCard | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "unavailable" | "paying"
  >("loading");
  const [error, setError] = useState<string | null>(null);

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
  }, []);

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

      const res = await fetch("/api/square-pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ registrationId, sourceId: result.token }),
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
      setError("Something went wrong taking the payment. Please try again.");
      setState("ready");
    }
  }

  if (state === "unavailable") {
    return (
      <p className="cop-note-block">
        Card payment isn&apos;t available right now. Please use Venmo or check
        below, or contact the league office.
      </p>
    );
  }

  return (
    <div className="sqc-wrap">
      {state === "loading" && (
        <p className="cop-note-block">Loading secure card form...</p>
      )}
      {/* Square draws its card fields inside this element. */}
      <div ref={containerRef} className="sqc-field" />
      {error && <div className="cop-error">{error}</div>}
      {state !== "loading" && (
        <button
          type="button"
          className="cop-btn cop-btn-primary sqc-pay"
          onClick={pay}
          disabled={state === "paying"}
        >
          {state === "paying" ? "Processing..." : "Pay now"}
        </button>
      )}
    </div>
  );
}
