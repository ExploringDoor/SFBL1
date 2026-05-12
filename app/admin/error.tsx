"use client";

// Scoped error boundary for the /admin tree. Without this, any
// throw inside /admin (or any sub-route under it) bubbles up to
// the global app/error.tsx — which tears down the entire shell.
// With this in place the nav, ticker, and footer stay intact and
// the admin sees a contextual message + a Retry button instead
// of the full-page "Something went wrong" wipe.
//
// Closes audit M10 for the admin surface.

import { useEffect } from "react";

export default function AdminError({
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
        scope: "admin",
      }),
    }).catch(() => undefined);
    console.error("[admin/error.tsx]", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-xl font-bold text-amber-900 mb-2">
          Admin panel hit an error
        </h1>
        <p className="text-sm text-amber-900/90 leading-relaxed mb-4">
          Something on the admin dashboard threw an exception. The
          rest of the site is still working — you can keep using
          the public pages while we investigate. Try refreshing
          this tab; if it keeps happening, copy the ref below and
          ping the platform admin.
        </p>
        <div className="flex gap-3 flex-wrap">
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800"
          >
            Try again
          </button>
          <a
            href="/admin"
            className="rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
          >
            Back to admin home
          </a>
          <a
            href="/"
            className="rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
          >
            Public site
          </a>
        </div>
        {error.digest && (
          <p className="mt-4 text-[11px] font-mono text-amber-700/80">
            ref: {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
