"use client";

// Sign-in page. Drop-in branded version of the auth flow — uses the
// league's primary color, banner, and copy. No password — Firebase
// magic-link only. Email goes in, the link arrives, the user clicks
// the link, /login/finish does the redirect to /admin or /captain
// or /profile based on their role claim.

import { useState } from "react";
import { sendMagicLink } from "@/lib/auth-client";
import { useTenant } from "@/lib/tenant-context";

export default function LoginPage() {
  const { tenantId, config } = useTenant();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const useEmulator =
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("sending");
    try {
      await sendMagicLink(email);
      setStatus("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
      setStatus("error");
    }
  }

  const leagueName = config?.name ?? "League";
  const logoUrl = config?.theme?.logo_url ?? null;

  return (
    <main
      style={{
        maxWidth: 460,
        margin: "0 auto",
        padding: "48px 20px 64px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        minHeight: "70vh",
        justifyContent: "center",
      }}
    >
      <header style={{ textAlign: "center" }}>
        {logoUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={logoUrl}
            alt={leagueName}
            style={{
              maxWidth: "70%",
              maxHeight: 96,
              margin: "0 auto 18px",
              display: "block",
              objectFit: "contain",
            }}
          />
        )}
        <h1
          className="font-display"
          style={{
            fontSize: 32,
            fontWeight: 900,
            color: "var(--text-strong)",
            margin: "0 0 6px",
            letterSpacing: "-0.01em",
          }}
        >
          Sign in
        </h1>
        <p
          style={{
            color: "var(--muted)",
            fontSize: 14,
            lineHeight: 1.55,
            margin: 0,
          }}
        >
          Captains and players sign in by email — no password. Enter
          your email, we&rsquo;ll send a one-tap link.
        </p>
      </header>

      {status !== "sent" ? (
        <form
          onSubmit={onSubmit}
          style={{
            background: "white",
            border: "1px solid rgba(0, 0, 0, 0.07)",
            borderRadius: 14,
            padding: "20px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                fontFamily: "inherit",
                fontSize: 16,
                padding: "10px 12px",
                border: "1px solid rgba(0, 0, 0, 0.15)",
                borderRadius: 8,
                background: "white",
                color: "var(--text-strong)",
                textTransform: "none",
                letterSpacing: 0,
                fontWeight: 400,
              }}
            />
          </label>
          <button
            type="submit"
            disabled={status === "sending"}
            style={{
              background: "var(--brand-primary)",
              color: "white",
              border: "none",
              padding: "12px 20px",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 800,
              fontFamily: "inherit",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              cursor: "pointer",
              opacity: status === "sending" ? 0.7 : 1,
              transition: "filter 0.15s ease",
            }}
          >
            {status === "sending" ? "Sending…" : "Send sign-in link"}
          </button>
          {error && (
            <p
              style={{
                fontSize: 13,
                color: "#991b1b",
                background: "rgba(220, 38, 38, 0.08)",
                border: "1px solid rgba(220, 38, 38, 0.25)",
                borderRadius: 8,
                padding: "8px 12px",
                margin: 0,
              }}
            >
              {error}
            </p>
          )}
        </form>
      ) : (
        <section
          style={{
            background: "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(0,45,114,0.06))",
            border: "1px solid rgba(16, 185, 129, 0.25)",
            borderRadius: 14,
            padding: "24px 22px",
            textAlign: "center",
          }}
        >
          <div aria-hidden style={{ fontSize: 40, marginBottom: 8 }}>
            ✉️
          </div>
          <h2
            style={{
              fontFamily: "var(--font-barlow), sans-serif",
              fontSize: 20,
              fontWeight: 800,
              color: "#047857",
              margin: "0 0 6px",
            }}
          >
            Check your email
          </h2>
          <p
            style={{
              color: "var(--text-strong)",
              fontSize: 14,
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            A sign-in link has been sent to{" "}
            <strong style={{ fontWeight: 700 }}>{email}</strong>. Tap it
            from your phone or laptop and you&rsquo;ll be signed in
            automatically.
          </p>
          {useEmulator && (
            <p
              style={{
                marginTop: 14,
                padding: "8px 12px",
                background: "rgba(217, 119, 6, 0.08)",
                border: "1px solid rgba(217, 119, 6, 0.3)",
                borderRadius: 8,
                fontSize: 11,
                color: "#92400e",
                lineHeight: 1.45,
              }}
            >
              <strong>Emulator mode:</strong> real email isn&rsquo;t
              sent. Open{" "}
              <a
                href="http://localhost:4000/auth"
                style={{
                  fontFamily: "ui-monospace, monospace",
                  textDecoration: "underline",
                  color: "inherit",
                }}
                target="_blank"
                rel="noreferrer"
              >
                localhost:4000/auth
              </a>{" "}
              and click the pending sign-in link.
            </p>
          )}
        </section>
      )}

      {tenantId && (
        <footer
          style={{
            textAlign: "center",
            fontSize: 11,
            color: "var(--muted)",
          }}
        >
          {leagueName}
        </footer>
      )}
    </main>
  );
}
