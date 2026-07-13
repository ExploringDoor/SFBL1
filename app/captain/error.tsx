"use client";

// Scoped error boundary for the /captain portal. Mirrors
// app/admin/error.tsx: keeps the shell + public pages alive when
// the captain dashboard throws, gives the captain a contextual
// message instead of the full-page "Something went wrong" wipe.
//
// Closes audit M10 for the captain surface.

import { useEffect } from "react";
import { useTenant } from "@/lib/tenant-context";
import { captainNoun } from "@/lib/tenants";

export default function CaptainError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { config } = useTenant();
  const captain = captainNoun(config);
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
        scope: "captain",
      }),
    }).catch(() => undefined);
    console.error("[captain/error.tsx]", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-xl font-bold text-amber-900 mb-2">
          {captain} portal hit an error
        </h1>
        <p className="text-sm text-amber-900/90 leading-relaxed mb-4">
          Something in the {captain} dashboard threw an exception.
          Your account and the rest of the site are fine — try
          again, or head back to the public site. If this keeps
          happening, message the commissioner with the ref below.
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
            href="/captain"
            className="rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
          >
            {captain} home
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
