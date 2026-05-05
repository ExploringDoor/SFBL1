"use client";

// /login/finish — completes the magic-link sign-in. Smart-redirects
// based on the user's role on the active tenant (instead of always
// dumping them at /admin where most users see a "you don't have
// access" page).
//
//   - admin       → /admin
//   - captain     → /captain
//   - anyone else → /profile  (player landing — availability + chat
//                              + notifications. The tab they need is
//                              probably what they were trying to
//                              reach when they hit Sign In.)
//
// If we ever add a `?next=` redirect-back-here flow (push tap →
// signed out → sign in → return to original deep-link), it'd plug
// in here, taking precedence over the role-based default.

import { useEffect, useState } from "react";
import { completeSignIn } from "@/lib/auth-client";

type State =
  | { kind: "verifying" }
  | { kind: "success"; uid: string; email: string | null; redirectTo: string }
  | { kind: "error"; message: string };

export default function LoginFinishPage() {
  const [state, setState] = useState<State>({ kind: "verifying" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await completeSignIn();
        if (cancelled) return;
        // Honour ?next= if supplied. Same-origin, leading slash only —
        // don't let an attacker craft a magic link that lands users on
        // an external phishing page.
        const params = new URLSearchParams(window.location.search);
        const nextParam = params.get("next");
        let redirectTo: string;
        if (
          typeof nextParam === "string" &&
          nextParam.startsWith("/") &&
          !nextParam.startsWith("//")
        ) {
          redirectTo = nextParam;
        } else {
          // Resolve role for current tenant, redirect to the right
          // landing page. We force-refresh the ID token so claims
          // granted recently propagate immediately.
          const tokenResult = await user.getIdTokenResult(true);
          if (cancelled) return;
          const tenantHost = window.location.host;
          // Best-effort tenant detection — the leagues claim is
          // keyed by tenant slug, which middleware passes in the
          // x-tenant-id header but isn't accessible client-side
          // here. We pick the FIRST league with admin or captain
          // claim as the redirect signal. For users in a single
          // league this just works; multi-league users may land on
          // an unexpected role's surface but the nav lets them
          // navigate.
          const leagues =
            (tokenResult.claims.leagues as Record<string, string> | undefined) ?? {};
          const entries = Object.entries(leagues);
          const adminEntry = entries.find(([, role]) => role === "admin");
          const captainEntry = entries.find(
            ([, role]) =>
              typeof role === "string" && role.startsWith("captain:"),
          );
          if (adminEntry) {
            redirectTo = "/admin";
          } else if (captainEntry) {
            redirectTo = "/captain";
          } else {
            redirectTo = "/profile";
          }
          // Suppress unused-var lint when host isn't used.
          void tenantHost;
        }
        setState({
          kind: "success",
          uid: user.uid,
          email: user.email,
          redirectTo,
        });
        setTimeout(() => {
          if (!cancelled) window.location.href = redirectTo;
        }, 1200);
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
          <p className="text-emerald-800">
            Redirecting to{" "}
            <span className="font-mono">{state.redirectTo}</span>…
          </p>
          <p className="font-mono text-xs text-emerald-700">
            {state.email ? state.email : `uid: ${state.uid}`}
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
