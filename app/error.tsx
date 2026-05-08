"use client";

// Global error boundary — caught when any Client or Server Component
// in the app tree throws and there's no nearer error.tsx to handle
// it. Next 14 requires this file to be a Client Component.
//
// We log the error to /errors collection in Firestore (per CLAUDE.md
// — "log errors to /errors Firestore collection, view in platform
// admin dashboard") via a fire-and-forget POST so the platform admin
// can see what's breaking in the wild.
//
// User sees a clean apology page with a "Try again" button (digest
// helps engineers grep server logs for the failure) — never a raw
// stack trace.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Best-effort log. Don't throw if the report itself fails.
    fetch("/api/errors-log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        digest: error.digest ?? null,
        stack: error.stack ?? null,
        url: typeof window !== "undefined" ? window.location.href : null,
        ua:
          typeof navigator !== "undefined" ? navigator.userAgent : null,
      }),
    }).catch(() => {
      // swallow
    });
    // Also surface to console for local dev.
    console.error("[error.tsx]", error);
  }, [error]);

  return (
    <main
      style={{
        maxWidth: 560,
        margin: "10vh auto",
        padding: "0 24px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 16 }}>
        ⚾
      </div>
      <h1
        style={{
          fontSize: 28,
          fontWeight: 800,
          color: "#0f172a",
          margin: "0 0 12px",
        }}
      >
        Something went wrong
      </h1>
      <p
        style={{
          color: "#475569",
          fontSize: 15,
          lineHeight: 1.6,
          margin: "0 0 24px",
        }}
      >
        We hit an unexpected error loading this page. The league
        commissioner has been notified. You can try again, or head
        back to the home page.
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "10px 20px",
            background: "var(--brand-primary, #002d72)",
            color: "white",
            border: "none",
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        <a
          href="/"
          style={{
            padding: "10px 20px",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            color: "#334155",
            fontWeight: 700,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Home
        </a>
      </div>
      {error.digest && (
        <p
          style={{
            marginTop: 32,
            fontSize: 11,
            color: "#94a3b8",
            fontFamily: "ui-monospace, 'SF Mono', monospace",
          }}
        >
          ref: {error.digest}
        </p>
      )}
    </main>
  );
}
