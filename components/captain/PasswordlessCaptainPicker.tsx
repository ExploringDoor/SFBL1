"use client";

// Captain landing for tenants with captain.passwordless = true
// (LBDC). Instead of the magic-link sign-in, captains type a simple
// password — by convention, the lowercased team name. The client
// POSTs to /api/public-captain-claim which scans the league's teams,
// matches by normalized id or name, mints a Firebase custom token
// with the corresponding `captain:<team_id>` claim, and signs in via
// signInWithCustomToken. Once signed in the existing captain portal
// renders normally.
//
// "Password" is intentionally a weak shared secret — Adam picked it
// so the URL alone isn't enough to manage a team, but he doesn't
// want the friction of real email/auth. Anyone who can guess the
// team name can sign in. Per-IP rate limit on the API caps brute-
// force attempts.

import { useState } from "react";
import { getAuth, signInWithCustomToken } from "firebase/auth";

export function PasswordlessCaptainPicker({
  leagueId,
}: {
  leagueId: string;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(e?: React.FormEvent) {
    e?.preventDefault();
    if (!password.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/public-captain-claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leagueId, teamPassword: password.trim() }),
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
      // Sign in. The captain page's useUser / useCaptainTeam /
      // useLeagueRole hooks pick up the new auth state and re-
      // render into the normal post-sign-in view.
      await signInWithCustomToken(getAuth(), data.customToken);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 460, margin: "0 auto", textAlign: "center" }}>
      <div aria-hidden style={{ fontSize: 48, marginBottom: 10 }}>
        ⚾
      </div>
      <h2
        style={{
          fontFamily: "var(--font-barlow), sans-serif",
          fontSize: 24,
          fontWeight: 800,
          color: "var(--text-strong)",
          margin: "0 0 8px",
        }}
      >
        Captain sign-in
      </h2>
      <p
        style={{
          color: "var(--muted)",
          fontSize: 14,
          lineHeight: 1.6,
          margin: "0 0 22px",
        }}
      >
        Enter your team password to manage your roster, submit
        scores, and chat with your players.
      </p>

      <form onSubmit={signIn}>
        <input
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          placeholder="Team password"
          aria-label="Team password"
          style={{
            width: "100%",
            maxWidth: 360,
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
            className="le-cap-btn-primary"
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

      <p
        style={{
          marginTop: 22,
          fontSize: 12,
          color: "var(--muted)",
          lineHeight: 1.55,
        }}
      >
        Don't know the password? Ask your commissioner.
      </p>
    </div>
  );
}
