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
  | {
      kind: "success";
      uid: string;
      email: string | null;
      redirectTo: string;
      bridged: boolean;
    }
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
        const bridgeId = params.get("bridge");
        // If the link came from a PWA (the LoginPage attached a
        // bridgeId), publish a custom token under that id so the
        // PWA's poller can pick it up and sign in too. Fire-and-
        // log — if the bridge call fails for any reason, the
        // user's still signed in here in Safari, which is the
        // immediate goal.
        let bridged = false;
        if (bridgeId && /^[0-9a-f-]{36}$/i.test(bridgeId)) {
          try {
            const idToken = await user.getIdToken();
            const res = await fetch("/api/auth-bridge/create", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({ bridgeId }),
            });
            bridged = res.ok;
          } catch {
            bridged = false;
          }
        }
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
          bridged,
        });
        // Don't auto-redirect when we bridged a PWA sign-in — the
        // user needs to leave Safari and reopen the app, not be
        // shuffled around inside Safari.
        if (!bridged) {
          setTimeout(() => {
            if (!cancelled) window.location.href = redirectTo;
          }, 1200);
        }
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
    <main
      style={{
        maxWidth: 460,
        margin: "0 auto",
        padding: "48px 20px 64px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        minHeight: "60vh",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      {state.kind === "verifying" && (
        <>
          <div aria-hidden style={{ fontSize: 40 }}>
            🔑
          </div>
          <h1
            className="font-display"
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "var(--text-strong)",
              margin: 0,
            }}
          >
            Finishing sign-in…
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>
            Verifying your link.
          </p>
        </>
      )}

      {state.kind === "success" && !state.bridged && (
        <>
          <div aria-hidden style={{ fontSize: 40 }}>
            ✓
          </div>
          <h1
            className="font-display"
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "#047857",
              margin: 0,
            }}
          >
            Signed in
          </h1>
          <p
            style={{
              color: "var(--text-strong)",
              fontSize: 14,
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            Welcome back
            {state.email ? (
              <>
                ,{" "}
                <strong style={{ fontWeight: 700 }}>{state.email}</strong>
              </>
            ) : null}
            . Taking you to your dashboard now…
          </p>
        </>
      )}

      {state.kind === "success" && state.bridged && (
        <>
          <div aria-hidden style={{ fontSize: 40 }}>
            ✓
          </div>
          <h1
            className="font-display"
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "#047857",
              margin: 0,
            }}
          >
            Signed in
          </h1>
          <p
            style={{
              color: "var(--text-strong)",
              fontSize: 14,
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            Welcome back
            {state.email ? (
              <>
                ,{" "}
                <strong style={{ fontWeight: 700 }}>{state.email}</strong>
              </>
            ) : null}
            .
          </p>
          <p
            style={{
              color: "var(--text-strong)",
              fontSize: 14,
              lineHeight: 1.55,
              margin: 0,
              padding: "14px 16px",
              background: "rgba(0, 45, 114, 0.06)",
              border: "1px solid rgba(0, 45, 114, 0.18)",
              borderRadius: 12,
            }}
          >
            Now reopen the home-screen app — it&rsquo;s already
            picked up your sign-in.
          </p>
        </>
      )}

      {state.kind === "error" && (
        <>
          <div aria-hidden style={{ fontSize: 40 }}>
            ⚠️
          </div>
          <h1
            className="font-display"
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "#991b1b",
              margin: 0,
            }}
          >
            Couldn&rsquo;t finish sign-in
          </h1>
          <p
            style={{
              color: "var(--text-strong)",
              fontSize: 14,
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            {state.message}
          </p>
          <a
            href="/login"
            style={{
              display: "inline-block",
              alignSelf: "center",
              padding: "10px 22px",
              background: "var(--brand-primary)",
              color: "white",
              borderRadius: 10,
              fontWeight: 800,
              fontSize: 13,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              textDecoration: "none",
            }}
          >
            Send a new link
          </a>
        </>
      )}
    </main>
  );
}
