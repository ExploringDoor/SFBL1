"use client";

// Admin landing for tenants with admin.passwordless = true (LBDC).
// One password field — on submit, POST to /api/public-admin-claim
// which validates against the stored admin password and (if it
// matches) mints a Firebase custom token with the admin claim.
// Once signed in, the rest of the AdminPage renders normally.

import { useState } from "react";
import { getAuth, signInWithCustomToken } from "firebase/auth";

export function AdminPasswordGate({ leagueId }: { leagueId: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!password.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/public-admin-claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leagueId, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        customToken?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.customToken) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      await signInWithCustomToken(getAuth(), data.customToken);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 py-12"
      style={{ minHeight: "60vh" }}
    >
      <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
        <div aria-hidden style={{ fontSize: 48, marginBottom: 10 }}>
          🔒
        </div>
        <h1
          style={{
            fontFamily: "var(--font-barlow), sans-serif",
            fontSize: 28,
            fontWeight: 900,
            color: "var(--text-strong)",
            margin: "0 0 8px",
            textTransform: "uppercase",
            letterSpacing: "0.02em",
          }}
        >
          Admin sign-in
        </h1>
        <p
          style={{
            color: "var(--muted)",
            fontSize: 14,
            lineHeight: 1.55,
            margin: "0 0 22px",
          }}
        >
          Enter the admin password to manage the league.
        </p>

        <form onSubmit={submit}>
          <input
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            placeholder="Admin password"
            aria-label="Admin password"
            style={{
              width: "100%",
              padding: "12px 14px",
              border: "1px solid var(--border, rgba(0,0,0,0.15))",
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 600,
              background: "white",
              color: "var(--text-strong)",
              textAlign: "center",
              letterSpacing: "0.06em",
            }}
          />
          <div style={{ marginTop: 14 }}>
            <button
              type="submit"
              disabled={!password.trim() || busy}
              style={{
                padding: "12px 28px",
                background: "var(--brand-primary)",
                color: "white",
                borderRadius: 10,
                fontWeight: 800,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                fontSize: 14,
                border: "none",
                cursor: !password.trim() || busy ? "not-allowed" : "pointer",
                opacity: !password.trim() || busy ? 0.6 : 1,
              }}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>

        {error && (
          <p
            style={{
              marginTop: 14,
              padding: "8px 12px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#991b1b",
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
