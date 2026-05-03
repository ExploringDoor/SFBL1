"use client";

import { useEffect, useState } from "react";
import { completeSignIn } from "@/lib/auth-client";

type State =
  | { kind: "verifying" }
  | { kind: "success"; uid: string; email: string | null }
  | { kind: "error"; message: string };

export default function LoginFinishPage() {
  const [state, setState] = useState<State>({ kind: "verifying" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await completeSignIn();
        if (cancelled) return;
        setState({ kind: "success", uid: user.uid, email: user.email });
        // Redirect to /admin shortly after success so the page state is
        // visible for a moment and the user knows what happened.
        setTimeout(() => {
          if (!cancelled) window.location.href = "/admin";
        }, 1500);
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Unknown error.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Finishing sign-in…</h1>

      {state.kind === "verifying" && (
        <p className="text-slate-600">Verifying your link…</p>
      )}

      {state.kind === "success" && (
        <section className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <p className="font-semibold text-emerald-900">Signed in.</p>
          <p className="text-emerald-800">Redirecting to admin…</p>
          <p className="font-mono text-xs text-emerald-700">
            uid: {state.uid}
            {state.email ? ` · ${state.email}` : ""}
          </p>
        </section>
      )}

      {state.kind === "error" && (
        <section className="space-y-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm">
          <p className="font-semibold text-red-900">Couldn't finish sign-in.</p>
          <p className="text-red-800">{state.message}</p>
          <p className="text-xs text-red-700">
            <a href="/login" className="underline">
              Try requesting a new link.
            </a>
          </p>
        </section>
      )}
    </main>
  );
}
