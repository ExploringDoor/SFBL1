"use client";

// Root error boundary. app/error.tsx only catches failures INSIDE the root
// layout's tree — if the root layout itself throws (or hydration dies at the
// root), Next skips it and renders this instead. Without this file such a
// crash produced Next's bare built-in screen and, worse, was never reported
// to /errors, so the platform dashboard showed nothing while the site was
// down. That was the audit's "a broken site goes unnoticed" gap.
//
// Because it replaces the root layout, this file must render its own <html>
// and <body>, and it cannot rely on the app's fonts, CSS variables, or
// providers. Everything here is inline and self-contained on purpose.

import { useEffect } from "react";

export default function RootError({
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
        fatal: true,
      }),
    }).catch(() => {
      /* never let the reporter throw on top of the crash */
    });
    console.error("[global-error.tsx]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f7f7f8",
          color: "#111",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          padding: "24px",
        }}
      >
        <main style={{ maxWidth: 480, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 10px", fontWeight: 800 }}>
            This page didn&apos;t load
          </h1>
          <p style={{ margin: "0 0 20px", lineHeight: 1.5, color: "#444" }}>
            Something went wrong on our end. The league office has been
            notified. Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              border: "none",
              borderRadius: 8,
              padding: "11px 22px",
              background: "#111",
              color: "#fff",
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: 18, fontSize: 12, color: "#888" }}>
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
