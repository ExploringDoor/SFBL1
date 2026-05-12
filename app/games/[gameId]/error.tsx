"use client";

// Scoped error boundary for /games/<gameId>. The box-score page is
// the most-shared deep-link in the league — a captain dropping a
// link in iMessage opens this for everyone at once. Without a
// nested error.tsx, any throw here tore down the entire shell on
// every recipient's phone.
//
// Closes audit M10 for the box-score surface.

import { useEffect } from "react";

export default function GameError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    fetch("/api/errors-log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        digest: error.digest ?? null,
        stack: error.stack ?? null,
        url: typeof window !== "undefined" ? window.location.href : null,
        ua: typeof navigator !== "undefined" ? navigator.userAgent : null,
        scope: "games/[gameId]",
      }),
    }).catch(() => undefined);
    console.error("[games/[gameId]/error.tsx]", error);
  }, [error]);

  return (
    <main className="container py-10">
      <div
        style={{
          padding: "24px 20px",
          background: "rgba(0,0,0,0.03)",
          border: "1px dashed rgba(0,0,0,0.12)",
          borderRadius: 12,
          textAlign: "center",
          maxWidth: 520,
          margin: "0 auto",
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 8 }}>⚾</div>
        <h1
          className="font-display"
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: "var(--text-strong)",
            margin: "0 0 8px",
          }}
        >
          Couldn&rsquo;t load this game
        </h1>
        <p
          style={{
            color: "var(--muted)",
            fontSize: 14,
            lineHeight: 1.55,
            margin: "0 0 16px",
          }}
        >
          The box score didn&rsquo;t come through. The rest of the
          schedule is still up.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "8px 18px",
              background: "var(--brand-primary)",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <a
            href="/schedule"
            style={{
              padding: "8px 18px",
              border: "1px solid rgba(0,0,0,0.15)",
              borderRadius: 8,
              color: "var(--text-strong)",
              fontWeight: 700,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            Back to schedule
          </a>
        </div>
        {error.digest && (
          <p
            style={{
              marginTop: 18,
              fontSize: 11,
              color: "var(--muted)",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            ref: {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
